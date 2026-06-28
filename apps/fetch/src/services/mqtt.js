"use strict";
const mqtt = require("mqtt");
const { openDb } = require("../config/connection");

const DEFAULT_CONFIG = {
  host: process.env.MQTT_HOST || "14.225.252.85",
  port: process.env.MQTT_PORT || "1883",
  topic: process.env.MQTT_TOPIC || "telemetry",
  source: process.env.MQTT_SOURCE || "mqtt",
  FETCH_INTERVAL_SECONDS: Number(process.env.MQTT_FETCH_INTERVAL_SECONDS) || 60,
  SAVE_DB_INTERVAL_MINUTES: Number(process.env.MQTT_SAVE_DB_INTERVAL_MINUTES) || 5
};

const TAG_PARAMETER_MAP = { MUCNUOC: "level", LUULUONG: "flow", TONGLUULUONG: "totalIndex" };

const db = openDb();
let messageQueue = [];
let mqttHistoryQueue = [];

function buildStationId(source, rawId) { return `${source}_${String(rawId).toLowerCase()}`; }

function normalizeMetricValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  const cleaned = String(value).replace(/,/g, "").trim();
  const numericValue = Number(cleaned);
  return Number.isNaN(numericValue) ? null : numericValue;
}

// 🛠️ TỐI ƯU MÚI GIỜ: Kiểm tra cấu trúc chuỗi, tự động xử lý timezone
function parseTimestampToDate(ts) {
  if (!ts) return null;
  let tsStr = String(ts).trim();
  
  if (!tsStr.includes("Z") && !tsStr.match(/[+-]\d{2}:?\d{2}$/)) {
    tsStr += "+07:00";
  }
  
  const parsed = new Date(tsStr);
  if (Number.isNaN(parsed.getTime())) return null;
  
  parsed.setSeconds(0, 0);
  parsed.setMilliseconds(0);
  return parsed;
}

function getSystemDateRounded() {
  const now = new Date();
  now.setSeconds(0, 0);
  now.setMilliseconds(0);
  return now;
}

function parsePayloadTextSecure(text) {
  try {
    if (!text || typeof text !== "string") return null;
    const trimmed = text.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
    let cleanedMessage = trimmed
      .replace(/:\s*-?nan\b/gi, ':0').replace(/:\s*-?inf\b/gi, ':0')          
      .replace(/:\s*-\s*([,}\]])/g, ':0$1').replace(/:\s*-\s*$/g, ':0')             
      .replace(/:\s*\.\s*([,}\]])/g, ':0$1').replace(/:\s*-\.\s*([,}\]])/g, ':0$1'); 
    return JSON.parse(cleanedMessage);
  } catch (_) { return null; }
}

// CHU KỲ 1: FETCH MỖI 60 GIÂY - CẬP NHẬT LATEST
setInterval(async () => {
  if (messageQueue.length === 0) return;
  const processingBatch = [...messageQueue];
  messageQueue = []; 

  console.log(`[MQTT][FETCH] Thực thi chu kỳ xử lý ${processingBatch.length} gói tin.`);
  let client;
  try {
    client = await db.connect();
    const currentFetchTs = getSystemDateRounded(); 

    for (const payload of processingBatch) {
      if (!payload || !Array.isArray(payload.d)) continue;
      
      let formattedDataTs = parseTimestampToDate(payload.ts);
      if (!formattedDataTs) formattedDataTs = currentFetchTs;

      for (const item of payload.d) {
        let value = item.value;
        if (!item || !item.tag || value === undefined || value === null) continue;

        if (typeof value === 'string') {
          if (value.trim() === '' || value.trim() === '-' || value.trim() === '.') value = 0;
          else { const parsed = parseFloat(value); if (!isNaN(parsed) && isFinite(parsed)) value = parsed; }
        }
        const parsedValue = normalizeMetricValue(value);
        if (parsedValue === null) continue;

        const parts = String(item.tag).trim().split('_');
        if (parts.length < 2) continue;

        let deviceCode = parts[0];
        let parameterTypeRaw = parts.slice(1).join('_');
        if (parts.length > 2 && (parts[0] === 'GS1' || parts[0] === 'GS2' || parts[0] === 'QT1' || parts[0] === 'QT2')) {
          deviceCode = parts[0] + '_' + parts[1];
          parameterTypeRaw = parts.slice(2).join('_');
        }

        const parameter = TAG_PARAMETER_MAP[parameterTypeRaw.toUpperCase()];
        if (!parameter) continue;

        const rawId = deviceCode.replace(/[^a-zA-Z0-9]+/g, "").toLowerCase();
        const stationId = buildStationId(DEFAULT_CONFIG.source, rawId);

        mqttHistoryQueue.push({ 
          logger_id: stationId, 
          tag_key: parameter, 
          data_ts: formattedDataTs.toISOString(), 
          value: parsedValue 
        });

        try {
          const queryText = `
            INSERT INTO logger_latest (logger_id, tag_key, data_ts, value, current_ts)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (logger_id, tag_key) 
            DO UPDATE SET data_ts = EXCLUDED.data_ts, value = EXCLUDED.value, current_ts = EXCLUDED.current_ts;
          `;
          await client.query(queryText, [stationId, parameter, formattedDataTs, parsedValue, currentFetchTs]);
        } catch (err) { console.error(`❌ [MQTT] Lỗi lưu bảng logger_latest:`, err.message); }
      }
    }
  } catch (error) { console.error("❌ [MQTT][BATCH] Lỗi xử lý dữ liệu:", error.message); } 
  finally { if (client) client.release(); }
}, DEFAULT_CONFIG.FETCH_INTERVAL_SECONDS * 1000);

// CHU KỲ 2: LƯU DB MỖI 5 PHÚT - GHI LỊCH SỬ ĐỒNG LOẠT
setInterval(async () => {
  if (mqttHistoryQueue.length === 0) return;
  const cachedItems = [...mqttHistoryQueue];
  mqttHistoryQueue = [];
  
  const now = new Date();
  now.setSeconds(0, 0);
  now.setMilliseconds(0);
  const minutes = now.getMinutes();
  now.setMinutes(Math.floor(minutes / 5) * 5);
  const serverSavedTs = now;

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const insertText = `INSERT INTO logger_readings (logger_id, tag_key, data_ts, data_save, value) VALUES ($1, $2, $3, $4, $5)`;
    for (const item of cachedItems) {
      const finalDataTs = item.data_ts ? new Date(item.data_ts) : serverSavedTs;
      await client.query(insertText, [item.logger_id, item.tag_key, finalDataTs, serverSavedTs, item.value]);
    }
    await client.query("COMMIT");
    console.log(`[MQTT][DB] 💾 Ghi nhận thành công ${cachedItems.length} bản ghi lịch sử vào Postgres.`);
  } catch (err) { 
    await client.query("ROLLBACK"); 
    console.error("❌ [MQTT][DB] Thất bại khi thực thi transaction lịch sử:", err.message); 
  } finally { 
    client.release(); 
  }
}, DEFAULT_CONFIG.SAVE_DB_INTERVAL_MINUTES * 60 * 1000);

function connectMQTT() {
  const client = mqtt.connect(`mqtt://${DEFAULT_CONFIG.host}:${DEFAULT_CONFIG.port}`, { 
    clean: true, 
    connectTimeout: 10000, 
    reconnectPeriod: 3000 
  });

  client.on("connect", () => { 
    console.log(`[MQTT] Đã kết nối Broker thành công. Đang lắng nghe topic: ${DEFAULT_CONFIG.topic}`);
    client.subscribe(DEFAULT_CONFIG.topic); 
  });

  client.on("message", (topic, payload) => {
    const parsed = parsePayloadTextSecure(payload.toString("utf8"));
    if (parsed) messageQueue.push(parsed);
  });

  return client;
}

module.exports = { connectMQTT };
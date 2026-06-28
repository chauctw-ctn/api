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

// 🛠️ FIX TIMEZONE: Trả về thời gian hiện tại đúng múi giờ UTC+7, không phụ thuộc TZ hệ thống
function nowVN() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

// 🛠️ FIX TIMEZONE: Parse timestamp string từ thiết bị — giả định luôn là giờ VN (UTC+7)
// Không gắn timezone suffix, thay vào đó parse thô rồi cộng offset 7h vào epoch (giống MONRE)
function parseTimestampToDate(ts) {
  if (!ts) return null;
  const tsStr = String(ts).trim();

  // Thử parse trực tiếp (nếu thiết bị gửi epoch ms hoặc ISO với TZ)
  let epochMs = Number(tsStr);
  if (!Number.isNaN(epochMs) && epochMs > 1e12) {
    // epoch milliseconds từ thiết bị — coi như giờ địa phương VN, cộng offset 7h
    const OFFSET_MS = 7 * 60 * 60 * 1000;
    const date = new Date(epochMs + OFFSET_MS);
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCSeconds(0, 0);
    return date;
  }

  // Chuỗi datetime dạng "YYYY-MM-DD HH:mm:ss" hoặc "YYYY-MM-DDTHH:mm:ss" (không TZ)
  // Tách tay các thành phần để tránh JS tự gán UTC hay local timezone
  // Thiết bị gửi giờ VN → cộng thêm 7h offset để UTC field của Date object = giờ VN (giống nowVN)
  const match = tsStr.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    const [, year, month, day, hours, minutes, seconds = 0] = match;
    const OFFSET_MS = 7 * 60 * 60 * 1000;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds)) + OFFSET_MS);
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCSeconds(0, 0);
    return date;
  }

  return null;
}

// 🛠️ FIX: Thời gian hệ thống VN, làm tròn giây về :00
function getSystemDateRounded() {
  const vn = nowVN();
  vn.setUTCSeconds(0, 0);
  return vn;
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
          data_ts: formattedDataTs,
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
  
  // 🛠️ FIX: Dùng nowVN() để tránh lệch 7 giờ
  const serverSavedTs = (() => {
    const vn = nowVN();
    vn.setUTCSeconds(0, 0);
    vn.setUTCMinutes(Math.floor(vn.getUTCMinutes() / 5) * 5);
    return vn;
  })();

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const insertText = `INSERT INTO logger_readings (logger_id, tag_key, data_ts, data_save, value) VALUES ($1, $2, $3, $4, $5)`;
    for (const item of cachedItems) {
      const finalDataTs = item.data_ts instanceof Date ? item.data_ts : serverSavedTs;
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
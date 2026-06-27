"use strict";
// require("dotenv").config();
const mqtt = require("mqtt");
const { openDb } = require("../config/connection");

const DEFAULT_CONFIG = {
  host: process.env.MQTT_HOST || "14.225.252.85",
  port: process.env.MQTT_PORT || "1883",
  topic: process.env.MQTT_TOPIC || "telemetry",
  source: process.env.MQTT_SOURCE || "mqtt",
  tzOffsetMinutes: 0,
  FETCH_INTERVAL_SECONDS: Number(process.env.MQTT_FETCH_INTERVAL_SECONDS) || 60,
  SAVE_DB_INTERVAL_MINUTES: Number(process.env.MQTT_SAVE_DB_INTERVAL_MINUTES) || 5
};

// ====================================================================
// 🔍 KHỐI XÁC MINH CẤU HÌNH ENVIRONMENT (.ENV)
// ====================================================================
(() => {
  console.log("\n---------------------------------------------------------");
  console.log("🕵️ [VERIFY CONFIG] Kiểm tra nguồn nạp cấu hình MQTT:");
  
  if (process.env.MQTT_HOST) {
    console.log(`   🟢 HOST: Đang sử dụng giá trị từ file .env -> [${process.env.MQTT_HOST}]`);
  } else {
    console.log(`   ⚠️  HOST: Không tìm thấy biến trong .env! Đang dùng fallback mặc định -> [${DEFAULT_CONFIG.host}]`);
  }

  if (process.env.MQTT_PORT) {
    console.log(`   🟢 PORT: Đang sử dụng giá trị từ file .env -> [${process.env.MQTT_PORT}]`);
  } else {
    console.log(`   ⚠️  PORT: Không tìm thấy biến trong .env! Đang dùng fallback mặc định -> [${DEFAULT_CONFIG.port}]`);
  }
  
  console.log(`   🕒 Khoảng thời gian lưu DB định kỳ: ${DEFAULT_CONFIG.SAVE_DB_INTERVAL_MINUTES} phút.`);
  console.log("---------------------------------------------------------\n");
})();



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

function formatTimestampWithOffsetRounded(ts, offsetMinutes) {
  if (!ts) return null;
  const parsed = new Date(String(ts).trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  if (Number.isNaN(parsed.getTime())) return null;
  const adjusted = new Date(parsed.getTime() + offsetMinutes * 60 * 1000);
  const pad = (v) => String(v).padStart(2, "0");
  return `${adjusted.getFullYear()}-${pad(adjusted.getMonth() + 1)}-${pad(adjusted.getDate())} ${pad(adjusted.getHours())}:${pad(adjusted.getMinutes())}:00`;
}

function getCurrentSystemTimeRounded() {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
}

function getRounded5MinTimestamp() {
  const now = new Date();
  const minutes = now.getMinutes();
  const roundedMinutes = Math.floor(minutes / 5) * 5;
  const pad = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(roundedMinutes)}:00`;
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

  console.log(`[MQTT][FETCH] Đúng chu kỳ ${DEFAULT_CONFIG.FETCH_INTERVAL_SECONDS}s -> Xử lý ${processingBatch.length} gói tin.`);
  let client;
  try {
    client = await db.connect();
    const currentFetchTs = getCurrentSystemTimeRounded(); 

    for (const payload of processingBatch) {
      if (!payload || !Array.isArray(payload.d)) continue;
      const formattedDataTs = formatTimestampWithOffsetRounded(payload.ts, DEFAULT_CONFIG.tzOffsetMinutes) || payload.ts;

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

        mqttHistoryQueue.push({ logger_id: stationId, tag_key: parameter, data_ts: formattedDataTs, value: parsedValue });

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
  } catch (error) { console.error("❌ [MQTT][BATCH] Lỗi chu kỳ 1:", error.message); } 
  finally { if (client) client.release(); }
}, DEFAULT_CONFIG.FETCH_INTERVAL_SECONDS * 1000);

// CHU KỲ 2: LƯU DB MỖI 5 PHÚT - GHI LỊCH SỬ ĐỒNG LOẠT
setInterval(async () => {
  if (mqttHistoryQueue.length === 0) return;
  const cachedItems = [...mqttHistoryQueue];
  mqttHistoryQueue = [];
  const serverSavedTs = getRounded5MinTimestamp();

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const insertText = `INSERT INTO logger_readings (logger_id, tag_key, data_ts, data_save, value) VALUES ($1, $2, $3, $4, $5)`;
    for (const item of cachedItems) {
      await client.query(insertText, [item.logger_id, item.tag_key, item.data_ts || serverSavedTs, serverSavedTs, item.value]);
    }
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK"); console.error("❌ [MQTT][DB] Lỗi lịch sử:", err.message); } 
  finally { client.release(); }
}, DEFAULT_CONFIG.SAVE_DB_INTERVAL_MINUTES * 60 * 1000);

/**
 * 🛠️ ĐỒNG BỘ EXPORT: Bọc tiến trình khởi chạy kết nối Broker vào hàm hành động
 */
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

// Xuất bản hàm đồng bộ cấu trúc với 3 module kia
module.exports = { connectMQTT };
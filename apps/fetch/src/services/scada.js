"use strict";
// require("dotenv").config();
const axios = require("axios");
const cheerio = require("cheerio");
const { openDb } = require("../config/connection");

const DEFAULT_CONFIG = {
  baseUrl: process.env.SCADA_URL || "http://14.161.36.253:86",
  loginUrl: process.env.SCADA_LOGIN_URL || "http://14.161.36.253:86/Scada/Login.aspx",
  username: process.env.SCADA_USERNAME || "cncamau",
  password: process.env.SCADA_PASSWORD || "cm123456",
  viewId: Number(process.env.SCADA_VIEW_ID) || 16,
  timeoutMs: Number(process.env.SCADA_TIMEOUT_MS) || 15000,
  maxRetries: Number(process.env.SCADA_MAX_RETRIES) || 3,
  retryDelayMs: Number(process.env.SCADA_RETRY_DELAY_MS) || 5000,
  source: "scada",
  FETCH_INTERVAL_SECONDS: Number(process.env.SCADA_FETCH_INTERVAL_SECONDS) || 60,  
  SAVE_DB_INTERVAL_MINUTES: Number(process.env.SCADA_SAVE_DB_INTERVAL_MINUTES) || 5
};

// ====================================================================
// 🔍 KHỐI XÁC MINH CẤU HÌNH ENVIRONMENT (.ENV) CHO MODULE SCADA
// ====================================================================
(() => {
  console.log("\n---------------------------------------------------------");
  console.log("🕵️ [VERIFY CONFIG] Kiểm tra nguồn nạp cấu hình SCADA Nhà máy:");
  
  if (process.env.SCADA_USERNAME) {
    console.log(`   🟢 USERNAME: Đang sử dụng tài khoản từ file .env -> [${process.env.SCADA_USERNAME}]`);
  } else {
    console.log(`   ⚠️  USERNAME: Không tìm thấy! Đang dùng fallback mặc định -> [${DEFAULT_CONFIG.username}]`);
  }

  if (process.env.SCADA_PASSWORD) {
    console.log(`   🟢 PASSWORD: Đang sử dụng mật khẩu từ file .env -> [********]`);
  } else {
    console.log(`   ⚠️  PASSWORD: Không tìm thấy! Đang dùng fallback mặc định -> [********]`);
  }

  if (process.env.SCADA_URL) {
    console.log(`   🟢 BASE URL: Đã đồng bộ động từ file .env -> [${process.env.SCADA_URL}]`);
  } else {
    console.log(`   ⚠️  BASE URL: Đang dùng địa chỉ IP tĩnh mặc định -> [${DEFAULT_CONFIG.baseUrl}]`);
  }

  if (process.env.SCADA_VIEW_ID) {
    console.log(`   🟢 VIEW ID: Đã đồng bộ từ file .env -> [Màn hình ID: ${DEFAULT_CONFIG.viewId}]`);
  } else {
    console.log(`   ⚠️  VIEW ID: Không tìm thấy! Đang dùng fallback mặc định -> [Màn hình ID: ${DEFAULT_CONFIG.viewId}]`);
  }
  
  console.log(`   ⚙️  Cấu hình mạng: Giới hạn Timeout: ${DEFAULT_CONFIG.timeoutMs}ms, Thử lại tối đa: ${DEFAULT_CONFIG.maxRetries} lần.`);
  console.log("---------------------------------------------------------\n");
})();

// ... Toàn bộ các hàm xử lý cào dữ liệu Cheerio (Scraper), fetchScadaData() phía sau giữ nguyên ...

const cnlMapping = {
  2902: ["gs4nm2", "level"], 2904: ["gs4nm2", "flow"], 2905: ["gs4nm2", "totalIndex"],
  2907: ["gs5nm1", "level"], 2909: ["gs5nm1", "flow"], 2910: ["gs5nm1", "totalIndex"],
  2912: ["gs4nm1", "level"], 2914: ["gs4nm1", "flow"], 2915: ["gs4nm1", "totalIndex"],
  2917: ["tb1", "level"],    2919: ["tb1", "flow"],    2920: ["tb1", "totalIndex"],
  2922: ["tb24", "amino"],   2923: ["tb24", "level"],   2925: ["tb24", "nitrat"], 2926: ["tb24", "pH"], 2927: ["tb24", "TDS"],
  2928: ["gs5nm1", "amino"], 2929: ["gs5nm1", "nitrat"], 2930: ["gs5nm1", "pH"], 2931: ["gs5nm1", "TDS"],
  2932: ["gs4nm2", "amino"], 2933: ["gs4nm2", "nitrat"], 2934: ["gs4nm2", "pH"], 2935: ["gs4nm2", "TDS"]
};

const db = openDb();
let scadaHistoryQueue = [];

function buildStationId(source, rawId) { return `${source}_${String(rawId).toLowerCase()}`; }
function mapCnlToStationAndParameter(cnlNum) {
  const mapped = cnlMapping[cnlNum];
  if (!mapped) return { station: null, parameter: null };
  return { station: mapped[0], parameter: mapped[1] };
}

function createHttpClient(config) {
  return axios.create({ timeout: config.timeoutMs, maxRedirects: 5, headers: { "User-Agent": "Mozilla/5.0" } });
}

function collectCookies(existing, next) {
  const combined = [...existing, ...next];
  return Array.from(new Set(combined.map((c) => c.split(";")[0]))).join("; ");
}

function parseScadaValue(textValue) {
  if (textValue === null || textValue === undefined) return null;
  let cleaned = String(textValue).trim();
  if (cleaned === "" || cleaned === "-" || cleaned.toLowerCase() === "nan") return null;
  if (cleaned.includes(".") && cleaned.includes(",")) cleaned = cleaned.replace(/\./g, "").replace(/,/g, ".");
  else if (cleaned.includes(",")) cleaned = cleaned.replace(/,/g, ".");
  const num = Number(cleaned); return Number.isNaN(num) ? null : num;
}

async function loginScada(config) {
  const client = createHttpClient(config); const loginPage = await client.get(config.loginUrl);
  const initialCookies = loginPage.headers["set-cookie"] || []; const initialHeader = collectCookies([], initialCookies);
  const $ = cheerio.load(loginPage.data);
  const loginData = new URLSearchParams({
    __VIEWSTATE: $("input[name='__VIEWSTATE']").val(), __VIEWSTATEGENERATOR: $("input[name='__VIEWSTATEGENERATOR']").val() || "",
    __EVENTVALIDATION: $("input[name='__EVENTVALIDATION']").val() || "", txtUsername: config.username, txtPassword: config.password, btnLogin: "Login"
  });
  const loginResponse = await client.post(config.loginUrl, loginData.toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: initialHeader, Referer: config.loginUrl } });
  return { client, sessionCookie: collectCookies(initialCookies, loginResponse.headers["set-cookie"] || []) };
}

// Hàm lấy thời gian đo / thời gian hiện hành làm tròn giây về 00
function getFormattedTimestampRounded() {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
}

function getRounded5MinTimestamp() {
  const now = new Date(); const minutes = now.getMinutes(); const roundedMinutes = Math.floor(minutes / 5) * 5;
  const pad = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(roundedMinutes)}:00`;
}

async function fetchScadaData() {
  const config = DEFAULT_CONFIG; const source = config.source;
  const { client, sessionCookie } = await loginScada(config);
  let rawData = []; const timestamp = Date.now();
  const apiUrl = `${config.baseUrl}/Scada/ClientApiSvc.svc/GetCurCnlDataExt`;

  try {
    const response = await client.get(apiUrl, { params: { cnlNums: '', viewIDs: '', viewID: config.viewId, _: timestamp }, headers: { 'Cookie': sessionCookie } });
    if (response.data && response.data.d) { const parsedRes = JSON.parse(response.data.d); if (parsedRes.Success) rawData = parsedRes.Data; }
  } catch (err) {
    const channelNums = Object.keys(cnlMapping).map(k => parseInt(k, 10));
    const response = await client.get(apiUrl, { params: { cnlNums: JSON.stringify(channelNums), viewIDs: '[]', _: timestamp }, headers: { 'Cookie': sessionCookie } });
    if (response.data && response.data.d) { const parsedRes = JSON.parse(response.data.d); if (parsedRes.Success) rawData = parsedRes.Data; }
  }

  if (!rawData || rawData.length === 0) return;

  const currentFetchTs = getFormattedTimestampRounded(); // 🛠️ SCADA lấy mốc quét hiện hành làm tròn :00 cho cả 2 trường data_ts và current_ts
  let dbClient;

  try {
    dbClient = await db.connect();
    for (const item of rawData) {
      const { station, parameter } = mapCnlToStationAndParameter(item.CnlNum);
      if (!station || !parameter) continue;

      const stationId = buildStationId(source, String(station).toLowerCase());
      const parsedValue = item.Text ? parseScadaValue(item.Text) : null;
      if (parsedValue === null) continue;

      scadaHistoryQueue.push({ logger_id: stationId, tag_key: parameter, data_ts: currentFetchTs, value: parsedValue });

      try {
        const queryLatest = `
          INSERT INTO logger_latest (logger_id, tag_key, data_ts, value, current_ts)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (logger_id, tag_key) 
          DO UPDATE SET data_ts = EXCLUDED.data_ts, value = EXCLUDED.value, current_ts = EXCLUDED.current_ts;
        `;
        await dbClient.query(queryLatest, [stationId, parameter, currentFetchTs, parsedValue, currentFetchTs]);
      } catch (err) { console.error("[SCADA] Lỗi logger_latest:", err.message); }
    }
  } catch (err) { console.error("❌ [SCADA][DB] Lỗi kết nối:", err.message); } 
  finally { if (dbClient) dbClient.release(); }
}

let inFlight = false;
setInterval(async () => {
  if (inFlight) return; inFlight = true;
  for (let attempt = 1; attempt <= DEFAULT_CONFIG.maxRetries; attempt++) {
    try { await fetchScadaData(); break; } catch (e) { if (attempt < DEFAULT_CONFIG.maxRetries) await new Promise(r => setTimeout(r, DEFAULT_CONFIG.retryDelayMs)); }
  }
  inFlight = false;
}, DEFAULT_CONFIG.FETCH_INTERVAL_SECONDS * 1000);

setInterval(async () => {
  if (scadaHistoryQueue.length === 0) return;
  const cachedItems = [...scadaHistoryQueue]; scadaHistoryQueue = [];
  const serverSavedTs = getRounded5MinTimestamp();

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const insertText = `INSERT INTO logger_readings (logger_id, tag_key, data_ts, data_save, value) VALUES ($1, $2, $3, $4, $5)`;
    for (const item of cachedItems) { await client.query(insertText, [item.logger_id, item.tag_key, item.data_ts || serverSavedTs, serverSavedTs, item.value]); }
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK"); } 
  finally { client.release(); }
}, DEFAULT_CONFIG.SAVE_DB_INTERVAL_MINUTES * 60 * 1000);

module.exports = { fetchScadaData };
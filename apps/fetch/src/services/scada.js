"use strict";
const axios = require("axios");
const cheerio = require("cheerio");
const { openDb } = require("../config/connection");
const { checkAndAlert } = require("./alertService");

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
  return mapped ? { station: mapped[0], parameter: mapped[1] } : { station: null, parameter: null };
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
  const client = axios.create({ timeout: config.timeoutMs, maxRedirects: 5, headers: { "User-Agent": "Mozilla/5.0" } });
  const loginPage = await client.get(config.loginUrl);
  const initialCookies = loginPage.headers["set-cookie"] || [];
  const initialHeader = Array.from(new Set(initialCookies.map(c => c.split(";")[0]))).join("; ");
  
  const $ = cheerio.load(loginPage.data);
  const loginData = new URLSearchParams({
    __VIEWSTATE: $("input[name='__VIEWSTATE']").val(),
    __VIEWSTATEGENERATOR: $("input[name='__VIEWSTATEGENERATOR']").val() || "",
    __EVENTVALIDATION: $("input[name='__EVENTVALIDATION']").val() || "",
    txtUsername: config.username, txtPassword: config.password, btnLogin: "Login"
  });
  
  const loginResponse = await client.post(config.loginUrl, loginData.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: initialHeader, Referer: config.loginUrl }
  });
  const sessionCookie = Array.from(new Set([...initialCookies, ...(loginResponse.headers["set-cookie"] || [])].map(c => c.split(";")[0]))).join("; ");
  return { client, sessionCookie };
}

// 🛠️ FIX TIMEZONE: Trả về thời gian hiện tại đúng múi giờ UTC+7, không phụ thuộc TZ hệ thống
function nowVN() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

// 🛠️ FIX: Thời gian hệ thống VN, làm tròn giây về :00
function getVietnamTimeRounded() {
  const vn = nowVN();
  vn.setUTCSeconds(0, 0);
  return vn;
}

async function fetchScadaData() {
  const config = DEFAULT_CONFIG;
  const { client, sessionCookie } = await loginScada(config);
  let rawData = [];
  const timestamp = Date.now();
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

  const currentFetchTs = getVietnamTimeRounded(); 
  let dbClient;

  try {
    dbClient = await db.connect();
    for (const item of rawData) {
      const { station, parameter } = mapCnlToStationAndParameter(item.CnlNum);
      if (!station || !parameter) continue;

      const stationId = buildStationId(config.source, String(station).toLowerCase());
      const parsedValue = item.Text ? parseScadaValue(item.Text) : null;
      if (parsedValue === null) continue;

      // Đẩy mốc thời gian dạng ISO String vào hàng đợi lưu lịch sử nhằm tránh lỗi kiểu dữ liệu hỗn hợp
      scadaHistoryQueue.push({ 
        logger_id: stationId, 
        tag_key: parameter, 
        data_ts: currentFetchTs,
        value: parsedValue 
      });

      try {
        const queryLatest = `
          INSERT INTO logger_latest (logger_id, tag_key, data_ts, value, current_ts)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (logger_id, tag_key) 
          DO UPDATE SET data_ts = EXCLUDED.data_ts, value = EXCLUDED.value, current_ts = EXCLUDED.current_ts;
        `;
        await dbClient.query(queryLatest, [stationId, parameter, currentFetchTs, parsedValue, currentFetchTs]);

        // 🔴 THÊM DÒNG NÀY ĐỂ KIỂM TRA CẢNH BÁO:
        checkAndAlert(stationId, parameter, parsedValue);

        
      } catch (err) { console.error("[SCADA] Lỗi logger_latest:", err.message); }
    }
  } catch (err) { console.error("❌ [SCADA][DB] Lỗi kết nối:", err.message); } 
  finally { if (dbClient) dbClient.release(); }
}

module.exports = { fetchScadaData };

// Tiến trình lưu lịch sử chạy ngầm định kỳ
setInterval(async () => {
  if (scadaHistoryQueue.length === 0) return;
  const cachedItems = [...scadaHistoryQueue]; 
  scadaHistoryQueue = [];
  
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
    console.log(`[SCADA][DB] 💾 Ghi nhận thành công ${cachedItems.length} bản ghi lịch sử vào Postgres.`);
  } catch (err) { 
    await client.query("ROLLBACK"); 
    console.error("❌ [SCADA][DB] Thất bại khi thực thi transaction lịch sử:", err.message);
  } finally { 
    client.release(); 
  }
}, DEFAULT_CONFIG.SAVE_DB_INTERVAL_MINUTES * 60 * 1000);
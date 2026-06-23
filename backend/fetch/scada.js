"use strict";

require("dotenv").config();
const axios = require("axios");
const cheerio = require("cheerio");
const { openDb } = require("./connection");

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

function buildStationId(source, rawId) { 
  return `${source}_${String(rawId).toLowerCase()}`; 
}

function mapCnlToStationAndParameter(cnlNum) {
  const mapped = cnlMapping[cnlNum];
  if (!mapped) return { station: null, parameter: null };
  return { station: mapped[0], parameter: mapped[1] };
}

function createHttpClient(config) {
  return axios.create({
    timeout: config.timeoutMs,
    maxRedirects: 5,
    validateStatus: (s) => s < 400,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
  });
}

function collectCookies(existing, next) {
  const combined = [...existing, ...next];
  const cookieSet = new Set(combined.map((c) => c.split(";")[0]));
  return Array.from(cookieSet).join("; ");
}

function parseScadaValue(textValue) {
  if (textValue === null || textValue === undefined) return null;
  let cleaned = String(textValue).trim();
  if (cleaned === "" || cleaned === "-" || cleaned.toLowerCase() === "nan") return null;
  if (cleaned.includes(".") && cleaned.includes(",")) cleaned = cleaned.replace(/\./g, "").replace(/,/g, ".");
  else if (cleaned.includes(",")) cleaned = cleaned.replace(/,/g, ".");
  const num = Number(cleaned);
  return Number.isNaN(num) ? null : num;
}

async function loginScada(config) {
  const client = createHttpClient(config);
  const loginPage = await client.get(config.loginUrl);
  const initialCookies = loginPage.headers["set-cookie"] || [];
  const initialHeader = collectCookies([], initialCookies);

  const $ = cheerio.load(loginPage.data);
  const viewState = $("input[name='__VIEWSTATE']").val();
  const eventValidation = $("input[name='__EVENTVALIDATION']").val();
  const viewStateGen = $("input[name='__VIEWSTATEGENERATOR']").val();

  if (!viewState) throw new Error("SCADA login failed: missing __VIEWSTATE");

  const loginData = new URLSearchParams({
    __VIEWSTATE: viewState, __VIEWSTATEGENERATOR: viewStateGen || "", __EVENTVALIDATION: eventValidation || "",
    txtUsername: config.username, txtPassword: config.password, btnLogin: "Login"
  });

  const loginResponse = await client.post(config.loginUrl, loginData.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: initialHeader, Referer: config.loginUrl }
  });

  return { client, sessionCookie: collectCookies(initialCookies, loginResponse.headers["set-cookie"] || []) };
}

async function warmUpViewCache(config, client, sessionCookie) {
  try { await client.get(`${config.baseUrl}/Scada/View.aspx?viewID=${config.viewId}`, { headers: { Cookie: sessionCookie } }); } catch (_) {}
}

function getFormattedTimestamp() {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function getRounded5MinTimestamp() {
  const now = new Date();
  const minutes = now.getMinutes();
  const roundedMinutes = Math.floor(minutes / 5) * 5;
  const pad = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(roundedMinutes)}:00`;
}

// ------------------------------------------------------------------
// CHU KỲ 1: FETCH DỮ LIỆU SCADA MỖI 60 GIÂY -> UPDATE LATEST
// ------------------------------------------------------------------
async function fetchScadaData() {
  const config = DEFAULT_CONFIG;
  const source = config.source;

  const { client, sessionCookie } = await loginScada(config);
  await warmUpViewCache(config, client, sessionCookie);

  let rawData = [];
  const timestamp = Date.now();
  const apiUrl = `${config.baseUrl}/Scada/ClientApiSvc.svc/GetCurCnlDataExt`;

  try {
    // Luồng A: Thử gọi API dựa trên ViewID (Mặc định là 16)
    const response = await client.get(apiUrl, {
      params: { cnlNums: '', viewIDs: '', viewID: config.viewId, _: timestamp },
      headers: { 'Cookie': sessionCookie, 'Referer': `${config.baseUrl}/Scada/View.aspx` }
    });
    
    if (response.data && response.data.d) {
      const parsedRes = JSON.parse(response.data.d);
      if (parsedRes.Success) rawData = parsedRes.Data;
    }
  } catch (err) {
    console.log("⚠️ [SCADA API] Gọi API theo ViewID thất bại, thử sang luồng Channel-based...");
    
    // Luồng B Fallback: Gọi API trực tiếp bằng danh sách mảng số kênh (ChannelNums)
    const channelNums = Object.keys(cnlMapping).map(k => parseInt(k, 10));
    const response = await client.get(apiUrl, {
      params: { cnlNums: JSON.stringify(channelNums), viewIDs: '[]', _: timestamp },
      headers: { 'Cookie': sessionCookie, 'Referer': `${config.baseUrl}/Scada/View.aspx` }
    });

    if (response.data && response.data.d) {
      const parsedRes = JSON.parse(response.data.d);
      if (parsedRes.Success) rawData = parsedRes.Data;
    }
  }

  if (!rawData || rawData.length === 0) return;

  const currentTs = getFormattedTimestamp();

  for (const item of rawData) {
    const { station, parameter } = mapCnlToStationAndParameter(item.CnlNum);
    if (!station || !parameter) continue;

    const rawId = String(station).toLowerCase();
    const stationId = buildStationId(source, rawId);
    const parsedValue = item.Text ? parseScadaValue(item.Text) : null;
    if (parsedValue === null) continue;

    // Đẩy dữ liệu sạch vào mảng Queue lịch sử (Không lo bị đè)
    scadaHistoryQueue.push({ logger_id: stationId, tag_key: parameter, value: parsedValue });

    try {
      const queryText = `
        INSERT INTO logger_latest (logger_id, tag_key, data_ts, value)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (logger_id, tag_key) 
        DO UPDATE SET data_ts = EXCLUDED.data_ts, value = EXCLUDED.value, saved_ts = TO_CHAR(NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI:SS');
      `;
      await db.query(queryText, [stationId, parameter, currentTs, parsedValue]);
    } catch (err) {
      console.error("[SCADA] Lỗi cập nhật logger_latest:", err.message);
    }
  }
}

// ------------------------------------------------------------------
// KHỞI CHẠY CHU KỲ KIỂM SOÁT RETRY LOGIC AN TOÀN
// ------------------------------------------------------------------
let inFlight = false;
setInterval(async () => {
  if (inFlight) return;
  inFlight = true;
  console.log(`\n[SCADA][FETCH] Khởi động quét hệ thống nhà máy (${DEFAULT_CONFIG.FETCH_INTERVAL_SECONDS}s)...`);

  let success = false;
  for (let attempt = 1; attempt <= DEFAULT_CONFIG.maxRetries; attempt++) {
    try {
      await fetchScadaData();
      success = true;
      break;
    } catch (e) {
      console.error(`❌ [SCADA] Lần thử ${attempt}/${DEFAULT_CONFIG.maxRetries} thất bại:`, e.message);
      if (attempt < DEFAULT_CONFIG.maxRetries) {
        await new Promise(r => setTimeout(r, DEFAULT_CONFIG.retryDelayMs));
      }
    }
  }
  inFlight = false;
}, DEFAULT_CONFIG.FETCH_INTERVAL_SECONDS * 1000);

// ------------------------------------------------------------------
// CHU KỲ 2: LƯU BATCH LỊCH SỬ XUỐNG POSTGRES MỖI 5 PHÚT
// ------------------------------------------------------------------
setInterval(async () => {
  if (scadaHistoryQueue.length === 0) return;

  const cachedItems = [...scadaHistoryQueue];
  scadaHistoryQueue = [];

  const serverSavedTs = getRounded5MinTimestamp();
  console.log(`\n--- [SCADA][DB CHU KỲ ${DEFAULT_CONFIG.SAVE_DB_INTERVAL_MINUTES} PHÚT] Ghi Batch ${cachedItems.length} records -> Postgres. Mốc: ${serverSavedTs} ---`);

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const insertText = `INSERT INTO logger_readings (logger_id, tag_key, data_ts, value) VALUES ($1, $2, $3, $4)`;
    
    for (const item of cachedItems) {
      await client.query(insertText, [item.logger_id, item.tag_key, serverSavedTs, item.value]);
    }
    await client.query("COMMIT");
    console.log("✅ [SCADA][DB] Đã lưu lịch sử thành công.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ [SCADA][DB] Lỗi khi ghi Batch lịch sử:", err.message);
  } finally {
    client.release();
  }
}, DEFAULT_CONFIG.SAVE_DB_INTERVAL_MINUTES * 60 * 1000); // Đã đồng bộ cấu hình chạy theo phút

module.exports = { 
  fetchScadaData,
  fetchAndPrintScadaData: fetchScadaData
};
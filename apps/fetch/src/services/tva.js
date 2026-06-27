"use strict";
// require("dotenv").config();
const axios = require("axios");
const cheerio = require("cheerio");
const { openDb } = require("../config/connection");

const DEFAULT_TVA_CONFIG = {
  baseUrl: process.env.TVA_URL || "http://camau.dulieuquantrac.com:8906",
  loginUrl: process.env.TVA_LOGIN_URL || "http://camau.dulieuquantrac.com:8906/index.php?module=users&view=users&task=checklogin",
  username: process.env.TVA_USERNAME || "ctncamau@quantrac.net", password: process.env.TVA_PASSWORD || "123456789",
  loginPath: process.env.TVA_LOGIN_PATH || "/dang-nhap/", timeoutMs: Number(process.env.TVA_TIMEOUT_MS) || 15000,
  maxRetries: Number(process.env.TVA_MAX_RETRIES) || 3, retryDelayMs: Number(process.env.TVA_RETRY_DELAY_MS) || 5000,
  source: "tva", FETCH_INTERVAL_SECONDS: Number(process.env.TVA_FETCH_INTERVAL_SECONDS) || 60,
  SAVE_DB_INTERVAL_MINUTES: Number(process.env.TVA_SAVE_DB_INTERVAL_MINUTES) || 5
};

const TVA_PARAMETER_MAP = { mucnuoc: "level", luuluong: "flow", tongluuluong: "totalIndex" };
const db = openDb();
let tvaHistoryQueue = [];

function buildStationId(source, rawId) { return `${source}_${String(rawId).toLowerCase()}`; }
function createHttpClient(config) { return axios.create({ timeout: config.timeoutMs, headers: { "User-Agent": "Mozilla/5.0" } }); }

function buildCookieHeader(cookies) {
  const cookieMap = {};
  cookies.forEach((cookie) => {
    const [nameValue] = cookie.split(";"); const [name, value] = nameValue.split("=");
    if (name && value) cookieMap[name.trim()] = value.trim();
  });
  return Object.entries(cookieMap).map(([name, value]) => `${name}=${value}`).join("; ");
}

function normalizeNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  let cleaned = String(value).trim(); if (cleaned === "" || cleaned === "-" || cleaned.toLowerCase() === "nan") return null;
  if (cleaned.includes(".") && cleaned.includes(",")) cleaned = cleaned.replace(/\./g, "").replace(/,/g, ".");
  else if (cleaned.includes(",")) cleaned = cleaned.replace(/,/g, ".");
  const asNumber = Number(cleaned); return Number.isNaN(asNumber) ? null : asNumber;
}

// 🛠️ SỬA ĐỔI: Hàm parse thời gian đo thiết bị từ Text của Web bóp cứng phần giây về :00
function parseUpdateTimeRounded(value) {
  if (!value) return null;
  const cleaned = String(value).trim();
  const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;
  const [, day, month, year, hours = "0", minutes = "0"] = match;
  const pad = (v) => String(v).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)} ${pad(hours)}:${pad(minutes)}:00`;
}

// 🛠️ SỬA ĐỔI: Hàm format dự phòng / lấy thời gian hiện tại lúc fetch hệ thống bóp cứng giây về :00
function getCurrentSystemTimeRounded(date = new Date()) {
  const pad = (v) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

function getRounded5MinTimestamp() {
  const now = new Date(); const minutes = now.getMinutes(); const roundedMinutes = Math.floor(minutes / 5) * 5;
  const pad = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(roundedMinutes)}:00`;
}

function normalizeStationId(name) {
  const normalized = String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const compactKey = normalized.replace(/[^a-z0-9]+/g, "");
  const explicitOverrides = { qt3182gpbtnmt: "qt3", qt1nm12186gpbtnmt: "qt1nm1", qt2nm12186gpbtnmt: "qt2nm1" };
  if (explicitOverrides[compactKey]) return explicitOverrides[compactKey];
  const compact = normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const tramBomMatch = compact.match(/^tram_bom_(\d+)$/); if (tramBomMatch) return `tb${tramBomMatch[1]}`;
  const nhaMayMatch = compact.match(/^nha_may_so_(\d+)_gieng_so_(\d+)$/); if (nhaMayMatch) return `gs${nhaMayMatch[2]}nm${nhaMayMatch[1]}`;
  return compact.replace(/_/g, "");
}

async function loginTVA(config) {
  const client = createHttpClient(config); const loginPageRes = await client.get(config.baseUrl);
  let cookies = loginPageRes.headers["set-cookie"] || [];
  const loginData = new URLSearchParams({ "fields[email]": config.username, "fields[password]": config.password, remember_account: "on", is_dtool_form: cheerio.load(loginPageRes.data)("input[name='is_dtool_form']").val() || "" });
  const loginRes = await client.post(`${config.baseUrl}${config.loginPath}`, loginData.toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: buildCookieHeader(cookies) } });
  if (loginRes.headers["set-cookie"]) cookies = [...cookies, ...loginRes.headers["set-cookie"]];
  return { client, cookieHeader: buildCookieHeader(cookies) };
}

async function fetchTVAData() {
  const config = DEFAULT_TVA_CONFIG; const source = config.source;
  const { client, cookieHeader } = await loginTVA(config);
  const res = await client.get(config.baseUrl, { headers: { Cookie: cookieHeader } });
  const $ = cheerio.load(res.data);
  
  const currentFetchTs = getCurrentSystemTimeRounded(); // 🛠️ Mốc thời gian lúc quét Web TVA (:00)
  const segments = $(".segmentData").toArray();
  let dbClient;

  try {
    dbClient = await db.connect();
    for (const segment of segments) {
      const stationName = $(segment).find(".headerChart").first().text().trim();
      const updateTime = $(segment).find(".headerNow").first().text().replace(/Thoi\s*diem:|Thời\s*điểm:/gi, "").trim();

      const stationId = buildStationId(source, normalizeStationId(stationName));
      const ts = parseUpdateTimeRounded(updateTime) || currentFetchTs; // 🛠️ Mốc thời gian đo thiết bị thô thọc (:00)

      const rows = $(segment).find(".left .table .row").toArray();
      for (const row of rows) {
        if ($(row).hasClass("header")) continue;
        const cols = $(row).find(".col"); if (cols.length < 4) continue;

        const parameter = TVA_PARAMETER_MAP[normalizeStationId($(cols[1]).text().trim())];
        const parsedValue = normalizeNumber($(cols[3]).text().trim());
        if (!parameter || parsedValue === null) continue;

        tvaHistoryQueue.push({ logger_id: stationId, tag_key: parameter, data_ts: ts, value: parsedValue });

        try {
          const queryText = `
            INSERT INTO logger_latest (logger_id, tag_key, data_ts, value, current_ts)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (logger_id, tag_key) 
            DO UPDATE SET data_ts = EXCLUDED.data_ts, value = EXCLUDED.value, current_ts = EXCLUDED.current_ts;
          `;
          await dbClient.query(queryText, [stationId, parameter, ts, parsedValue, currentFetchTs]);
        } catch (err) { console.error(`❌ [TVA] Lỗi ghi logger_latest:`, err.message); }
      }
    }
  } catch (err) { console.error("❌ [TVA][DB] Lỗi kết nối:", err.message); } 
  finally { if (dbClient) dbClient.release(); }
}

let inFlight = false;
setInterval(async () => {
  if (inFlight) return; inFlight = true;
  for (let attempt = 1; attempt <= DEFAULT_TVA_CONFIG.maxRetries; attempt++) {
    try { await fetchTVAData(); break; } catch (error) { if (attempt < DEFAULT_TVA_CONFIG.maxRetries) await new Promise(r => setTimeout(r, DEFAULT_TVA_CONFIG.retryDelayMs)); }
  }
  inFlight = false;
}, DEFAULT_TVA_CONFIG.FETCH_INTERVAL_SECONDS * 1000);

setInterval(async () => {
  if (tvaHistoryQueue.length === 0) return;
  const cachedItems = [...tvaHistoryQueue]; tvaHistoryQueue = [];
  const serverSavedTs = getRounded5MinTimestamp();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const insertText = `INSERT INTO logger_readings (logger_id, tag_key, data_ts, data_save, value) VALUES ($1, $2, $3, $4, $5)`;
    for (const item of cachedItems) { await client.query(insertText, [item.logger_id, item.tag_key, item.data_ts || serverSavedTs, serverSavedTs, item.value]); }
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK"); } 
  finally { client.release(); }
}, DEFAULT_TVA_CONFIG.SAVE_DB_INTERVAL_MINUTES * 60 * 1000);

module.exports = { fetchTVAData };
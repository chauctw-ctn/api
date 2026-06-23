"use strict";

require("dotenv").config();
const axios = require("axios");
const cheerio = require("cheerio");
const { openDb } = require("./connection");

const DEFAULT_TVA_CONFIG = {
  baseUrl: process.env.TVA_URL || "http://camau.dulieuquantrac.com:8906",
  loginUrl: process.env.TVA_LOGIN_URL || "http://camau.dulieuquantrac.com:8906/index.php?module=users&view=users&task=checklogin",
  username: process.env.TVA_USERNAME || "ctncamau@quantrac.net",
  password: process.env.TVA_PASSWORD || "123456789",
  loginPath: process.env.TVA_LOGIN_PATH || "/dang-nhap/",
  timeoutMs: Number(process.env.TVA_TIMEOUT_MS) || 15000,
  maxRetries: Number(process.env.TVA_MAX_RETRIES) || 3,
  retryDelayMs: Number(process.env.TVA_RETRY_DELAY_MS) || 5000,
  source: "tva",

  FETCH_INTERVAL_SECONDS: Number(process.env.TVA_FETCH_INTERVAL_SECONDS) || 60,
  SAVE_DB_INTERVAL_MINUTES: Number(process.env.TVA_SAVE_DB_INTERVAL_MINUTES) || 5
};

const TVA_PARAMETER_MAP = {
  mucnuoc: "level",
  luuluong: "flow",
  tongluuluong: "totalIndex"
};

const db = openDb();
let tvaHistoryQueue = [];

function buildStationId(source, rawId) {
  return `${source}_${String(rawId).toLowerCase()}`;
}

function createHttpClient(config) {
  return axios.create({
    timeout: config.timeoutMs,
    maxRedirects: 5,
    validateStatus: (status) => status < 400,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8"
    }
  });
}

function buildCookieHeader(cookies) {
  const cookieMap = {};
  cookies.forEach((cookie) => {
    const [nameValue] = cookie.split(";");
    const [name, value] = nameValue.split("=");
    if (name && value) cookieMap[name.trim()] = value.trim();
  });
  return Object.entries(cookieMap).map(([name, value]) => `${name}=${value}`).join("; ");
}

function normalizeNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  if (typeof value !== "string") return value;

  let cleaned = value.trim();
  if (cleaned === "" || cleaned === "-" || cleaned.toLowerCase() === "nan") return null;

  if (cleaned.includes(".") && cleaned.includes(",")) {
    cleaned = cleaned.replace(/\./g, "").replace(/,/g, ".");
  } else if (cleaned.includes(",")) {
    cleaned = cleaned.replace(/,/g, ".");
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }
  const asNumber = Number(cleaned);
  return Number.isNaN(asNumber) ? null : asNumber;
}

function parseUpdateTime(value) {
  if (!value) return null;
  const cleaned = String(value).trim();
  const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;

  const [, day, month, year, hours = "0", minutes = "0", seconds = "0"] = match;
  const pad = (v) => String(v).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function normalizeStationId(name) {
  const normalized = String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const compactKey = normalized.replace(/[^a-z0-9]+/g, "");

  const explicitOverrides = { qt3182gpbtnmt: "qt3", qt1nm12186gpbtnmt: "qt1nm1", qt2nm12186gpbtnmt: "qt2nm1" };
  if (explicitOverrides[compactKey]) return explicitOverrides[compactKey];

  const compact = normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const tramBomMatch = compact.match(/^tram_bom_(\d+)$/);
  if (tramBomMatch) return `tb${tramBomMatch[1]}`;

  const nhaMayMatch = compact.match(/^nha_may_so_(\d+)_gieng_so_(\d+)$/);
  if (nhaMayMatch) return `gs${nhaMayMatch[2]}nm${nhaMayMatch[1]}`;

  const qtNmMatch = compact.match(/^qt(\d+)_nm(\d+)$/);
  if (qtNmMatch) return `qt${qtNmMatch[1]}nm${qtNmMatch[2]}`;

  const qtMatch = compact.match(/^qt(\d+)$/);
  if (qtMatch) return `qt${qtMatch[1]}`;

  return compact.replace(/_/g, "");
}

function normalizeParameterName(name) {
  const normalized = normalizeStationId(name);
  return TVA_PARAMETER_MAP[normalized] || null;
}

function formatCustomTimestamp(date) {
  const pad = (v) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getRounded5MinTimestamp() {
  const now = new Date();
  const minutes = now.getMinutes();
  const roundedMinutes = Math.floor(minutes / 5) * 5;
  const pad = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(roundedMinutes)}:00`;
}

async function loginTVA(config) {
  const client = createHttpClient(config);
  const loginPageRes = await client.get(config.baseUrl);
  let cookies = loginPageRes.headers["set-cookie"] || [];

  const $login = cheerio.load(loginPageRes.data);
  const formToken = $login("input[name='is_dtool_form']").val();

  const loginData = new URLSearchParams({
    "fields[email]": config.username, "fields[password]": config.password,
    remember_account: "on", is_dtool_form: formToken || ""
  });

  const loginRes = await client.post(`${config.baseUrl}${config.loginPath}`, loginData.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: buildCookieHeader(cookies), Referer: config.baseUrl }
  });

  if (loginRes.headers["set-cookie"]) cookies = [...cookies, ...loginRes.headers["set-cookie"]];
  return { client, cookieHeader: buildCookieHeader(cookies) };
}

// ------------------------------------------------------------------
// CHU KỲ 1: FETCH DỮ LIỆU TỪ WEB TVA MỖI 60 GIÂY -> UPDATE LATEST
// ------------------------------------------------------------------
async function fetchTVAData() {
  const config = DEFAULT_TVA_CONFIG;
  const source = config.source;
  const { client, cookieHeader } = await loginTVA(config);

  const res = await client.get(config.baseUrl, { headers: { Cookie: cookieHeader, Referer: config.baseUrl } });
  const $ = cheerio.load(res.data);
  const fetchedAt = new Date();

  const segments = $(".segmentData").toArray();

  for (const segment of segments) {
    const $segment = $(segment);
    const stationName = $segment.find(".headerChart").first().text().trim();
    const updateTime = $segment.find(".headerNow").first().text().replace(/Thoi\s*diem:|Thời\s*điểm:/gi, "").trim();

    const rawId = normalizeStationId(stationName);
    const stationId = buildStationId(source, rawId);
    const ts = parseUpdateTime(updateTime) || formatCustomTimestamp(fetchedAt);

    const rows = $segment.find(".left .table .row").toArray();

    for (const row of rows) {
      const $row = $(row);
      if ($row.hasClass("header")) continue;

      const cols = $row.find(".col");
      if (cols.length < 4) continue;

      const name = $(cols[1]).text().trim();
      const valueText = $(cols[3]).text().trim();
      const parameter = normalizeParameterName(name);
      const parsedValue = normalizeNumber(valueText);

      if (!parameter || parsedValue === null) continue;

      // Nạp vào Queue lưu lịch sử (Chống mất mát)
      tvaHistoryQueue.push({ logger_id: stationId, tag_key: parameter, value: parsedValue });

      // Lưu bảng tức thời phục vụ tính Latency công thức
      try {
        const queryText = `
          INSERT INTO logger_latest (logger_id, tag_key, data_ts, value)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (logger_id, tag_key) 
          DO UPDATE SET data_ts = EXCLUDED.data_ts, value = EXCLUDED.value, saved_ts = TO_CHAR(NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI:SS');
        `;
        await db.query(queryText, [stationId, parameter, ts, parsedValue]);
      } catch (err) {
        console.error(`❌ [TVA] Lỗi ghi logger_latest của trạm ${stationId}:`, err.message);
      }
    }
  }
}

// Kích hoạt chu kỳ fetch với cơ chế Retry an toàn cô lập luồng
let inFlight = false;
setInterval(async () => {
  if (inFlight) return;
  inFlight = true;
  console.log(`\n[TVA][FETCH] Khởi động chu kỳ fetch dữ liệu sau mỗi ${DEFAULT_TVA_CONFIG.FETCH_INTERVAL_SECONDS}s...`);
  
  let success = false;
  for (let attempt = 1; attempt <= DEFAULT_TVA_CONFIG.maxRetries; attempt++) {
    try {
      await fetchTVAData();
      success = true;
      break;
    } catch (error) {
      console.error(`❌ [TVA] Lần thử ${attempt}/${DEFAULT_TVA_CONFIG.maxRetries} thất bại:`, error.message);
      if (attempt < DEFAULT_TVA_CONFIG.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, DEFAULT_TVA_CONFIG.retryDelayMs));
      }
    }
  }
  inFlight = false;
}, DEFAULT_TVA_CONFIG.FETCH_INTERVAL_SECONDS * 1000);

// ------------------------------------------------------------------
// CHU KỲ 2: GHI BATCH LỊCH SỬ XUỐNG POSTGRESQL MỖI 5 PHÚT (MỐC CHU KỲ TRÒN)
// ------------------------------------------------------------------
setInterval(async () => {
  if (tvaHistoryQueue.length === 0) return;

  const cachedItems = [...tvaHistoryQueue];
  tvaHistoryQueue = [];

  const serverSavedTs = getRounded5MinTimestamp();
  console.log(`\n--- [TVA][DB CHU KỲ 5 PHÚT] Ghi Batch ${cachedItems.length} records lịch sử -> Postgres. Mốc: ${serverSavedTs} ---`);

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const insertText = `INSERT INTO logger_readings (logger_id, tag_key, data_ts, value) VALUES ($1, $2, $3, $4)`;

    for (const item of cachedItems) {
      await client.query(insertText, [item.logger_id, item.tag_key, serverSavedTs, item.value]);
    }

    await client.query("COMMIT");
    console.log("✅ [TVA][DB] Đã commit dữ liệu lịch sử thành công.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ [TVA][DB] Lỗi Transaction lịch sử, đã rollback:", err.message);
  } finally {
    client.release();
  }
}, DEFAULT_TVA_CONFIG.SAVE_DB_INTERVAL_MINUTES * 60 * 1000);

module.exports = { 
  fetchTVAData,
  fetchAndPrintScadaData: fetchTVAData // Cấp bí danh đồng bộ gọi tức thời cho app.js
};
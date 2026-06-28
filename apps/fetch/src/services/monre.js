"use strict";
const axios = require('axios');
const { openDb } = require("../config/connection");
const { checkAndAlert } = require("./alertService");

// --- CẤU HÌNH ĐỘNG ĐỌC TỪ HỆ THỐNG MÔI TRƯỜNG ---
const CONFIG = {
    USERNAME: process.env.MONRE_USERNAME || 'capnuoccamau',
    PASSWORD: process.env.MONRE_PASSWORD || 'Qu@nTr@c2121',
    PORTAL_URL: process.env.MONRE_PORTAL_URL || "https://iot.monre.gov.vn/portal/sharing/rest/generateToken",
    DATA_URL: process.env.MONRE_DATA_URL || "https://iot.monre.gov.vn/server/rest/services/Hosted/TNN_BIGDATA_EVENT_NEW/FeatureServer/0/query",
    SOURCE: "monre", 
    FETCH_INTERVAL_SECONDS: Number(process.env.MONRE_FETCH_INTERVAL_SECONDS) || 60, 
    SAVE_DB_INTERVAL_MINUTES: Number(process.env.MONRE_SAVE_DB_INTERVAL_MINUTES) || 5 
};

// ====================================================================
// 🔍 KHỐI XÁC MINH CẤU HÌNH ENVIRONMENT (.ENV) CHO MODULE MONRE
// ====================================================================
(() => {
  console.log("\n---------------------------------------------------------");
  console.log("🕵️ [VERIFY CONFIG] Kiểm tra nguồn nạp cấu hình Portal MONRE:");
  
  if (process.env.MONRE_USERNAME) {
    console.log(`   🟢 USERNAME: Đang sử dụng tài khoản từ file .env -> [${process.env.MONRE_USERNAME}]`);
  } else {
    console.log(`   ⚠️  USERNAME: Không tìm thấy! Đang dùng fallback mặc định -> [${CONFIG.USERNAME}]`);
  }

  if (process.env.MONRE_PASSWORD) {
    console.log(`   🟢 PASSWORD: Đang sử dụng mật khẩu mã hóa từ file .env -> [********]`);
  } else {
    console.log(`   ⚠️  PASSWORD: Không tìm thấy! Đang dùng fallback mặc định -> [********]`);
  }

  if (process.env.MONRE_PORTAL_URL) {
    console.log(`   🟢 PORTAL URL: Đã đồng bộ động từ file .env`);
  } else {
    console.log(`   ⚠️  PORTAL URL: Đang dùng chuỗi cấu hình cứng (Hardcoded)`);
  }
  
  console.log(`   🕒 Chu kỳ quét API: ${CONFIG.FETCH_INTERVAL_SECONDS} giây/lần.`);
  console.log("---------------------------------------------------------\n");
})();

const PROJECT_FILTER = "(congtrinh='CAPNUOCCAMAU1' OR congtrinh='CONGTYCOPHANCAPNUOCC' OR congtrinh='NHAMAYCAPNUOCSO1' OR congtrinh='CAPNUOCCAMAUSO2')";

const PERMIT_MAPPING = {
    "393/gp-bnnmt 22/09/2025": ["NHAMAYCAPNUOCSO1"],
    "391/gp-bnnmt 19/09/2025": ["CONGTYCOPHANCAPNUOCC"],
    "35/gp-btnmt 15/01/2025": ["CAPNUOCCAMAU1"],
    "36/gp-btnmt 15/01/2025": ["CAPNUOCCAMAUSO2"]
};

const PARAMETER_MAP = {
    "MUCNUOC": "level", "H": "level", "LUULUONG": "flow", "Q": "flow", "TONGLUULUONG": "totalIndex", "V": "totalIndex",
    "PH": "ph", "TDS": "tds", "NO3": "no3", "NH4+": "nh4", "NH4": "nh4", "AMONI": "nh4"  
};

const db = openDb();
let monreHistoryQueue = []; 
let cachedToken = null;
let tokenExpiry = null;

function getCleanPermitNumber(projectName) {
    if (!projectName) return "UNKNOWN";
    const targetProject = projectName.trim().toUpperCase();
    for (const [permit, projects] of Object.entries(PERMIT_MAPPING)) {
        if (projects.some(p => p.trim().toUpperCase() === targetProject)) {
            const match = permit.split(' ')[0].match(/^(\d+)/);
            return match ? match[1] : "UNKNOWN";
        }
    }
    return "UNKNOWN";
}

// 🛠️ TỐI ƯU: Hàm parse và làm tròn giây về 00 trả về một đối tượng Date chuẩn cho TIMESTAMPTZ
function parseTimestampToDateRounded(ts) {
    if (!ts) return null;
    // ArcGIS MONRE trả epoch milliseconds theo giờ địa phương (UTC+7), không phải UTC chuẩn
    // → Phải cộng thêm 7h (25200000ms) để bù lại khi new Date() interpret sai thành UTC
    const OFFSET_MS = 7 * 60 * 60 * 1000;
    const date = new Date(Number(ts) + OFFSET_MS);
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCSeconds(0, 0);
    return date;
}

// 🛠️ current_ts: thời gian hệ thống Node.js → cộng offset +7h vì server chạy UTC
function nowVN() {
    return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

function getSystemDateRounded() {
    const vn = nowVN();
    vn.setUTCSeconds(0, 0);
    return vn;
}

// 🛠️ TỐI ƯU: Hàm lấy thời gian làm tròn chu kỳ 5 phút trả về Date
function getRounded5MinDate() {
    const vn = nowVN();
    vn.setUTCSeconds(0, 0);
    vn.setUTCMinutes(Math.floor(vn.getUTCMinutes() / 5) * 5);
    return vn;
}

function normalizeMetricValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isNaN(value) ? null : value;
    let cleaned = String(value).trim();
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return 0;
    cleaned = cleaned.replace(/,/g, "");
    const numericValue = Number(cleaned);
    return Number.isNaN(numericValue) ? null : numericValue;
}

async function getToken() {
    if (cachedToken && tokenExpiry && Date.now() < (tokenExpiry - 5 * 60 * 1000)) return cachedToken;
    try {
        const params = new URLSearchParams({ username: CONFIG.USERNAME, password: CONFIG.PASSWORD, referer: 'https://iot.monre.gov.vn', f: 'json', expiration: 60 });
        const response = await axios.post(CONFIG.PORTAL_URL, params.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 });
        if (response.data && response.data.token) {
            cachedToken = response.data.token;
            tokenExpiry = response.data.expires ? response.data.expires : (Date.now() + 60 * 60 * 1000);
            return cachedToken;
        }
        throw new Error(response.data?.error?.message || 'Invalid token response');
    } catch (error) {
        console.error("❌ [MONRE] Không thể thiết lập Token bảo mật:", error.message);
        throw error;
    }
}

async function fetchMonreData() {
    console.log(`\n[MONRE][FETCH] Bắt đầu chu kỳ quét API (${CONFIG.FETCH_INTERVAL_SECONDS}s)...`);
    let client;
    try {
        const token = await getToken();
        const currentFetchTs = getSystemDateRounded(); 
        
        const params = { f: 'json', where: PROJECT_FILTER, outFields: '*', orderByFields: 'thoigiannhan DESC', resultRecordCount: 5000, token: token };
        const response = await axios.get(CONFIG.DATA_URL, { params, timeout: 25000 });
        if (response.data && response.data.error) throw new Error(response.data.error.message);

        const features = response.data.features || [];
        if (features.length === 0) return;

        const rawLatestMap = {};
        features.forEach(f => {
            const attr = f.attributes;
            if (!attr || !attr.tram || !attr.chiso) return;
            if (!rawLatestMap[attr.tram]) rawLatestMap[attr.tram] = {};
            if (!rawLatestMap[attr.tram][attr.chiso]) rawLatestMap[attr.tram][attr.chiso] = attr;
        });

        const permitCounters = {};
        const finalizedDataBatch = [];

        for (const rawStationName in rawLatestMap) {
            const firstParamKey = Object.keys(rawLatestMap[rawStationName])[0];
            const sampleAttr = rawLatestMap[rawStationName][firstParamKey];
            const cleanPermit = getCleanPermitNumber(sampleAttr.congtrinh);

            if (!permitCounters[cleanPermit]) permitCounters[cleanPermit] = 0;
            permitCounters[cleanPermit]++;

            const stationCode = String(permitCounters[cleanPermit]).padStart(2, '0');
            const mappedStationName = `${CONFIG.SOURCE}_${cleanPermit}_gs${stationCode}`;

            for (const paramName in rawLatestMap[rawStationName]) {
                const targetAttr = rawLatestMap[rawStationName][paramName];
                const standardParam = PARAMETER_MAP[targetAttr.chiso.toUpperCase().trim()];
                if (!standardParam) continue; 

                const parsedValue = normalizeMetricValue(targetAttr.giatri);
                if (parsedValue === null) continue;

                const formattedDataTs = parseTimestampToDateRounded(targetAttr.thoigiando); 

                finalizedDataBatch.push({ stationId: mappedStationName, tagKey: standardParam, dataTs: formattedDataTs, value: parsedValue });
            }
        }

        client = await db.connect();
        for (const record of finalizedDataBatch) {
            monreHistoryQueue.push({ logger_id: record.stationId, tag_key: record.tagKey, value: record.value });

            try {
                const queryLatest = `
                    INSERT INTO logger_latest (logger_id, tag_key, data_ts, value, current_ts)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (logger_id, tag_key) 
                    DO UPDATE SET data_ts = EXCLUDED.data_ts, value = EXCLUDED.value, current_ts = EXCLUDED.current_ts;
                `;
                await client.query(queryLatest, [record.stationId, record.tagKey, record.dataTs, record.value, currentFetchTs]);
                
                // 🔴 THÊM DÒNG NÀY ĐỂ KIỂM TRA CẢNH BÁO:
                checkAndAlert(record.stationId, record.tagKey, record.value);
            } catch (err) {
                console.error(`❌ [MONRE] Lỗi lưu bảng logger_latest của trạm ${record.stationId}:`, err.message);
            }
        }
    } catch (error) {
        console.error('❌ [MONRE][FETCH] Lỗi thực thi chu kỳ fetch dữ liệu:', error.message);
    } finally {
        if (client) client.release();
    }
}

// CHU KỲ 2: Lưu DB lịch sử đồng loạt mỗi 5 phút
setInterval(async () => {
    if (monreHistoryQueue.length === 0) return;
    const cachedItems = [...monreHistoryQueue];
    monreHistoryQueue = [];
    const serverSavedTs = getRounded5MinDate();

    const client = await db.connect();
    try {
        await client.query("BEGIN");
        const insertText = `INSERT INTO logger_readings (logger_id, tag_key, data_ts, data_save, value) VALUES ($1, $2, $3, $4, $5)`;
        for (const item of cachedItems) {
            await client.query(insertText, [item.logger_id, item.tag_key, serverSavedTs, serverSavedTs, item.value]);
        }
        await client.query("COMMIT");
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ [MONRE][DB] Lỗi Transaction lịch sử:", err.message);
    } finally {
        client.release();
    }
}, CONFIG.SAVE_DB_INTERVAL_MINUTES * 60 * 1000);

module.exports = { fetchMonreData };
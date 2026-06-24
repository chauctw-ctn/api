require("dotenv").config();
const axios = require('axios');
const { openDb } = require("./connection"); 

// --- CẤU HÌNH ---
const CONFIG = {
    USERNAME: process.env.MONRE_USERNAME || 'capnuoccamau',
    PASSWORD: process.env.MONRE_PASSWORD || 'Qu@nTr@c2121',
    PORTAL_URL: "https://iot.monre.gov.vn/portal/sharing/rest/generateToken",
    DATA_URL: "https://iot.monre.gov.vn/server/rest/services/Hosted/TNN_BIGDATA_EVENT_NEW/FeatureServer/0/query",
    SOURCE: "monre", 
    FETCH_INTERVAL_SECONDS: 60, 
    SAVE_DB_INTERVAL_MINUTES: 5 
};

// Bộ lọc đơn vị quản lý trên API MONRE
const PROJECT_FILTER = "(congtrinh='CAPNUOCCAMAU1' OR congtrinh='CONGTYCOPHANCAPNUOCC' OR congtrinh='NHAMAYCAPNUOCSO1' OR congtrinh='CAPNUOCCAMAUSO2')";

// Ánh xạ công trình theo giấy phép để chuẩn hóa tên trạm
const PERMIT_MAPPING = {
    "393/gp-bnnmt 22/09/2025": ["NHAMAYCAPNUOCSO1"],
    "391/gp-bnnmt 19/09/2025": ["CONGTYCOPHANCAPNUOCC"],
    "35/gp-btnmt 15/01/2025": ["CAPNUOCCAMAU1"],
    "36/gp-btnmt 15/01/2025": ["CAPNUOCCAMAUSO2"]
};

// 🗺️ BỘ ĐỐI CHIẾU THAM SỐ
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

// Hàm format và làm tròn giây về 00 cho thời gian đo của thiết bị
function formatTimestampRounded(ts) {
    if (!ts) return null;
    const date = new Date(Number(ts));
    if (Number.isNaN(date.getTime())) return null;
    const pad = (v) => String(v).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

// Hàm lấy thời gian hiện tại của hệ thống làm tròn giây về 00
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

/**
 * 🛠️ ĐỊNH NGHĨA HÀM FETCH ĐỘC LẬP ĐỂ SỬA LỖI ReferenceError
 */
async function fetchMonreData() {
    console.log(`\n[MONRE][FETCH] Bắt đầu chu kỳ quét API (${CONFIG.FETCH_INTERVAL_SECONDS}s)...`);
    let client;
    try {
        const token = await getToken();
        const currentFetchTs = getCurrentSystemTimeRounded(); 
        
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

                const formattedDataTs = formatTimestampRounded(targetAttr.thoigiando); 

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

// CHU KỲ 1: Gọi lại hàm fetch định kỳ mỗi 60 giây
setInterval(async () => {
    await fetchMonreData();
}, CONFIG.FETCH_INTERVAL_SECONDS * 1000);

// CHU KỲ 2: Lưu DB lịch sử đồng loạt mỗi 5 phút
setInterval(async () => {
    if (monreHistoryQueue.length === 0) return;
    const cachedItems = [...monreHistoryQueue];
    monreHistoryQueue = [];
    const serverSavedTs = getRounded5MinTimestamp();

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

// Xuất bản hàm ra ngoài một cách hợp lệ
module.exports = { fetchMonreData };
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

// 🗺️ BỘ ĐỐI CHIẾU THAM SỐ (Chỉ giữ lại Lưu lượng, Mực nước và đúng 4 thông số Chất lượng nước yêu cầu)
const PARAMETER_MAP = {
    // --- LƯỢNG & MỰC NƯỚC ---
    "MUCNUOC": "level",
    "H": "level",
    "LUULUONG": "flow",
    "Q": "flow",
    "TONGLUULUONG": "totalIndex",
    "V": "totalIndex",

    // --- ĐÚNG 4 THÔNG SỐ CHẤT LƯỢNG NƯỚC THEO YÊU CẦU ---
    "PH": "ph",
    "TDS": "tds",
    "NO3": "no3",
    "NH4+": "nh4",
    "NH4": "nh4",   // Dự phòng API trả về chuỗi không có dấu cộng
    "AMONI": "nh4"  // Dự phòng trường hợp API trả về dạng chữ tiếng Việt viết liền
};

// Khởi tạo hàng đợi lưu trữ tạm trên RAM
const db = openDb();
let monreHistoryQueue = []; 

// Cache Token quản lý
let cachedToken = null;
let tokenExpiry = null;

/**
 * Helper: Trích xuất mã số giấy phép viết gọn
 */
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

/**
 * Helper: Định dạng timestamp dạng số (miligiây) thành chuỗi YYYY-MM-DD HH:mm:ss
 */
function formatTimestamp(ts) {
    if (!ts) return null;
    const date = new Date(Number(ts));
    if (Number.isNaN(date.getTime())) return null;
    const pad = (v) => String(v).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Helper: Lấy thời gian làm tròn chu kỳ 5 phút phục vụ trường data_save và data_ts của readings
 */
function getRounded5MinTimestamp() {
    const now = new Date();
    const minutes = now.getMinutes();
    const roundedMinutes = Math.floor(minutes / 5) * 5;
    const pad = (v) => String(v).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(roundedMinutes)}:00`;
}

/**
 * Helper: Làm sạch và ép kiểu dữ liệu đo lường an toàn
 */
function normalizeMetricValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isNaN(value) ? null : value;
    
    let cleaned = String(value).trim();
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return 0;
    
    cleaned = cleaned.replace(/,/g, "");
    const numericValue = Number(cleaned);
    return Number.isNaN(numericValue) ? null : numericValue;
}

/**
 * Lấy Token xác thực cổng kết nối MONRE Portal
 */
async function getToken() {
    if (cachedToken && tokenExpiry && Date.now() < (tokenExpiry - 5 * 60 * 1000)) {
        return cachedToken;
    }
    
    try {
        const params = new URLSearchParams({
            username: CONFIG.USERNAME,
            password: CONFIG.PASSWORD,
            referer: 'https://iot.monre.gov.vn',
            f: 'json',
            expiration: 60
        });
        
        const response = await axios.post(CONFIG.PORTAL_URL, params.toString(), { 
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000
        });
        
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

// ------------------------------------------------------------------
// CHU KỲ 1: ĐỒNG BỘ DỮ LIỆU TỪ MONRE & CẬP NHẬT BẢNG LATEST (MỖI 60s)
// ------------------------------------------------------------------
setInterval(async () => {
    console.log(`\n[MONRE][FETCH] Bắt đầu chu kỳ quét API (${CONFIG.FETCH_INTERVAL_SECONDS}s)...`);
    try {
        const token = await getToken();
        const params = {
            f: 'json',
            where: PROJECT_FILTER,
            outFields: '*',
            orderByFields: 'thoigiannhan DESC',
            resultRecordCount: 5000, 
            token: token
        };
        
        const response = await axios.get(CONFIG.DATA_URL, { params, timeout: 25000 });
        if (response.data && response.data.error) {
            throw new Error(response.data.error.message);
        }

        const features = response.data.features || [];
        if (features.length === 0) return;

        const rawLatestMap = {};
        
        // Bước 1: Trích lọc các bản ghi mới nhất theo cấu trúc Trạm -> Chỉ Số
        features.forEach(f => {
            const attr = f.attributes;
            if (!attr || !attr.tram || !attr.chiso) return;

            const sName = attr.tram;
            const iName = attr.chiso;

            if (!rawLatestMap[sName]) rawLatestMap[sName] = {};
            if (!rawLatestMap[sName][iName]) {
                rawLatestMap[sName][iName] = attr;
            }
        });

        // Bước 2: Định danh số thứ tự nội bộ và ánh xạ tên trạm theo giấy phép
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
                
                // Chuẩn hóa bộ lọc qua PARAMETER_MAP (Chỉ chấp nhận 4 thông số chất lượng yêu cầu + lưu lượng/mực nước)
                const standardParam = PARAMETER_MAP[targetAttr.chiso.toUpperCase().trim()];
                if (!standardParam) continue; 

                const parsedValue = normalizeMetricValue(targetAttr.giatri);
                if (parsedValue === null) continue;

                const formattedDataTs = formatTimestamp(targetAttr.thoigiando);

                finalizedDataBatch.push({
                    stationId: mappedStationName,
                    tagKey: standardParam,
                    dataTs: formattedDataTs,
                    value: parsedValue
                });
            }
        }

        // Bước 3: Đẩy dữ liệu vào DB và tích lũy hàng đợi lịch sử
        console.log(`[MONRE][PROCESS] Chuẩn hóa thành công ${finalizedDataBatch.length} chỉ số đo lường. Tiến hành cập nhật logger_latest...`);
        
        for (const record of finalizedDataBatch) {
            monreHistoryQueue.push({
                logger_id: record.stationId,
                tag_key: record.tagKey,
                value: record.value
            });

            try {
                const queryLatest = `
                    INSERT INTO logger_latest (logger_id, tag_key, data_ts, value)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (logger_id, tag_key) 
                    DO UPDATE SET 
                        data_ts = EXCLUDED.data_ts, 
                        value = EXCLUDED.value, 
                        saved_ts = TO_CHAR(NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI:SS');
                `;
                await db.query(queryLatest, [record.stationId, record.tagKey, record.dataTs, record.value]);
            } catch (err) {
                console.error(`❌ [MONRE] Lỗi lưu bảng logger_latest của trạm ${record.stationId}:`, err.message);
            }
        }

    } catch (error) {
        console.error('❌ [MONRE][FETCH] Lỗi thực thi chu kỳ fetch dữ liệu:', error.message);
    }
}, CONFIG.FETCH_INTERVAL_SECONDS * 1000);

// ------------------------------------------------------------------
// CHU KỲ 2: LƯU DB LỊCH SỬ ĐỒNG LOẠT TRONG TRANSACTION (MỖI 5 PHÚT)
// ------------------------------------------------------------------
setInterval(async () => {
    if (monreHistoryQueue.length === 0) return;

    const cachedItems = [...monreHistoryQueue];
    monreHistoryQueue = [];

    const serverSavedTs = getRounded5MinTimestamp();
    console.log(`\n--- [MONRE][DB CHU KỲ ${CONFIG.SAVE_DB_INTERVAL_MINUTES} PHÚT] Ghi đồng loạt ${cachedItems.length} records lịch sử xuống Postgres với mốc data_ts và data_save: ${serverSavedTs} ---`);

    const client = await db.connect();
    try {
        await client.query("BEGIN");
        
        const insertText = `
            INSERT INTO logger_readings (logger_id, tag_key, data_ts, data_save, value) 
            VALUES ($1, $2, $3, $4, $5)
        `;
        
        for (const item of cachedItems) {
            await client.query(insertText, [item.logger_id, item.tag_key, serverSavedTs, serverSavedTs, item.value]);
        }

        await client.query("COMMIT");
        console.log("✅ [MONRE][DB] Đã commit dữ liệu lịch sử thành công.");
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ [MONRE][DB] Lỗi Transaction lịch sử, tiến trình đã được rollback hoàn toàn:", err.message);
    } finally {
        client.release();
    }
}, CONFIG.SAVE_DB_INTERVAL_MINUTES * 60 * 1000);
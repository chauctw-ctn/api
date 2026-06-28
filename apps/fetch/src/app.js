"use strict";
process.env.TZ = "Asia/Ho_Chi_Minh";

// ====================================================================
// ⚙️ 1. CẤU HÌNH ĐỌC FILE .ENV TẬP TRUNG TỪ THƯ MỤC GỐC DỰ ÁN
// ====================================================================
if (process.env.NODE_ENV !== "production") {
  const path = require("path");
  require("dotenv").config({ path: path.join(__dirname, "../../../.env") });
}

const http = require("http");

// 🟢 Trỏ đúng vào cấu hình Pool kết nối PostgreSQL
const { openDb } = require("./config/connection");

// 🟢 Trỏ đúng vào các luồng Worker thu thập dữ liệu chuyên biệt
const mqttClient = require("./services/mqtt");
const scadaClient = require("./services/scada");
const monreClient = require("./services/monre");
const tvaClient = require("./services/tva");

/**
 * Hàm helper trả về chuỗi thời gian hiện tại định dạng: [HH:MM:SS DD/MM/YYYY] phục vụ console.log
 */
function getTimestamp() {
  const now = new Date();
  const time = now.toTimeString().split(" ")[0];
  const date = now.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  return `[${time} ${date}]`;
}

/**
 * 📊 HÀM WRAPPER TRUNG GIAN: Biến đổi thành vòng lặp đệ quy thực thụ để kiểm soát chu kỳ tập trung
 * @param {string} taskName - Tên dịch vụ
 * @param {Function} actionFunc - Hàm thực thi tác vụ fetch gốc từ module dịch vụ
 * @param {number} intervalSeconds - Số giây chu kỳ đọc từ CONFIG môi trường
 */
async function runTaskWithLog(taskName, actionFunc, intervalSeconds) {
  const executeCycle = async () => {
    console.log(`${getTimestamp()} 🔄 [${taskName}] Bắt đầu chu kỳ nạp/fetch dữ liệu...`);
    const startTime = Date.now();
    
    try {
      // Kích hoạt hàm cào/fetch dữ liệu gốc bất đồng bộ
      await actionFunc();
      
      // Tính toán chính xác thời gian chu kỳ tiếp theo dựa vào số giây interval
      const nextRunTime = new Date(Date.now() + (intervalSeconds * 1000));
      const nextTimeString = nextRunTime.toTimeString().split(" ")[0];
      const nextDateString = nextRunTime.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });

      console.log(`${getTimestamp()} 🔌 [${taskName}] Hoàn thành fetch dữ liệu thành công.`);
      console.log(`               ➔ ⏱️ Chu kỳ tiếp theo dự kiến: [${nextTimeString} ${nextDateString}] (Chạy sau ${intervalSeconds} giây nữa)\n`);
    } catch (err) {
      console.error(`${getTimestamp()} ❌ [${taskName}] Gặp lỗi khi fetch dữ liệu:`, err.message || err);
    }
    
    // 🛠️ FIX CỐT LÕI: Sử dụng setTimeout đệ quy để tự động lặp lại chu kỳ mới liên tục.
    // Dùng cơ chế này an toàn hơn setInterval vì tránh được việc các request "gối đầu/chồng chéo" lên nhau nếu mạng bị nghẽn.
    setTimeout(executeCycle, intervalSeconds * 1000);
  };

  // Kích hoạt chu kỳ đầu tiên ngay lập tức khi khởi động hệ thống
  await executeCycle();
}

// ====================================================================
// 🚀 2. KHỞI ĐỘNG HỆ THỐNG VÀ ĐỒNG BỘ CÁC WORKER CHẠY NỀN
// ====================================================================
async function bootstrapBackend() {
  console.log("======================================================================");
  console.log(`🚀 KHỞI ĐỘNG HỆ THỐNG BACKEND FETCH DATA - ĐỒNG BỘ POSTGRESQL`);
  console.log("======================================================================");

  // Kiểm tra sức khỏe kết nối Database PostgreSQL trước khi nạp tài nguyên mạng
  const db = openDb();
  try {
    const res = await db.query("SELECT NOW() AS current_time");
    console.log(`${getTimestamp()} ✅ Kết nối thành công tới PostgreSQL.`);
    console.log(`               Thời gian Server DB hiện tại: ${res.rows[0].current_time}\n`);
  } catch (err) {
    console.error(`${getTimestamp()} ❌ KHÔNG THỂ KẾT NỐI ĐẾN DATABASE POSTGRESQL. Tiến trình bị chặn!`);
    console.error(err.message);
    process.exit(1);
  }

  console.log("----------------------------------------------------------------------");
  console.log(`🛠️  Kích hoạt các luồng Worker lấy dữ liệu định kỳ...`);
  console.log("----------------------------------------------------------------------");

  // Kích hoạt luồng Socket Realtime: MQTT Broker kết nối lắng nghe liên tục qua cổng TCP
  console.log(`${getTimestamp()} [WORKER ACTIVE] -> Module MQTT Client đang lắng nghe...`);

  if (typeof mqttClient.connectMQTT === "function") {
    // MQTT chạy lắng nghe sự kiện push chủ động nên không bọc qua chu kỳ kéo (pull) cố định
    mqttClient.connectMQTT();
    console.log(`${getTimestamp()}    ✅ [MQTT Broker Listener] Khởi động tiến trình lắng nghe thành công.`);
  }
  
  // Kiểm tra cấu hình môi trường & Kích hoạt vòng lặp SCADA Nhà máy
  const scadaFunc = scadaClient.fetchScadaData || scadaClient.fetchAndPrintScadaData;
  if (typeof scadaFunc === "function") {
    const scadaInterval = Number(process.env.SCADA_FETCH_INTERVAL_SECONDS) || 60;
    runTaskWithLog("SCADA Nhà máy", scadaFunc, scadaInterval);
  } else {
    console.warn(`${getTimestamp()} ⚠️ [SCADA WARNING]: Không tìm thấy hàm fetch dữ liệu trong module scada.js`);
  }

  // Kiểm tra cấu hình môi trường & Kích hoạt vòng lặp TVA Web Scraper
  const tvaFunc = tvaClient.fetchTVAData;
  if (typeof tvaFunc === "function") {
    const tvaInterval = Number(process.env.TVA_FETCH_INTERVAL_SECONDS) || 60;
    runTaskWithLog("TVA Web Scraper", tvaFunc, tvaInterval);
  } else {
    console.warn(`${getTimestamp()} ⚠️ [TVA WARNING]: Không tìm thấy hàm fetchTVAData trong module tva.js`);
  }

  // Kiểm tra cấu hình môi trường & Kích hoạt vòng lặp Portal IoT MONRE
  const monreFunc = monreClient.fetchMonreData;
  if (typeof monreFunc === "function") {
    const monreInterval = Number(process.env.MONRE_FETCH_INTERVAL_SECONDS) || 60;
    runTaskWithLog("Portal IoT MONRE", monreFunc, monreInterval);
  } else {
    console.warn(`${getTimestamp()} ⚠️ [MONRE WARNING]: Không tìm thấy hàm fetchMonreData trong module monre.js`);
  }

  console.log("\n======================================================================");
  console.log(`🎉 HỆ THỐNG BACKEND ĐANG CHẠY ỔN ĐỊNH Ở CHẾ ĐỘ NỀN (BACKGROUND WORKERS)`);
  console.log("======================================================================\n");
}

// ====================================================================
// 🚨 3. KHỐI BẢO VỆ CHỐNG SẬP ỨNG DỤNG (CRASH PROTECTION)
// ====================================================================
process.on("unhandledRejection", (reason, promise) => {
  console.error(`${getTimestamp()} 🚨 Phát hiện tác vụ Bất đồng bộ bị lỗi chưa được bắt (Unhandled Rejection):`, reason);
});

process.on("uncaughtException", (error) => {
  console.error(`${getTimestamp()} 🚨 Lỗi nghiêm trọng chưa được xử lý (Uncaught Exception):`, error.message);
});

// Kích hoạt tiến trình khởi tạo chính
bootstrapBackend();

// ====================================================================
// 📡 4. HEALTH CHECK SERVER (TỰ ĐỘNG CHUYỂN CỔNG TRÁNH XUNG ĐỘT)
// ====================================================================
const PORT = process.env.PORT || 3001; 

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json", "Connection": "keep-alive" });
    res.end(JSON.stringify({ status: "UP", worker: "Active", timestamp: new Date().toISOString() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`📡 [CLOUD PORT] Health Check Server đang lắng nghe tại cổng: ${PORT}`);
});
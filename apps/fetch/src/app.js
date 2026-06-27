"use strict";

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
 * Hàm helper trả về chuỗi thời gian hiện tại định dạng: [HH:MM:SS DD/MM/YYYY]
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
 * 📊 HÀM WRAPPER TRUNG GIAN: Kiểm tra, log thời gian fetch và tính toán chu kỳ tiếp theo
 * @param {string} taskName - Tên dịch vụ (SCADA Nhà máy, TVA Web Scraper, Portal IoT MONRE...)
 * @param {Function} actionFunc - Hàm thực thi tác vụ fetch gốc từ module dịch vụ
 * @param {number} intervalSeconds - Số giây chu kỳ đọc trực tiếp từ CONFIG môi trường
 */
async function runTaskWithLog(taskName, actionFunc, intervalSeconds) {
  console.log(`${getTimestamp()} 🔄 [${taskName}] Bắt đầu chu kỳ nạp/fetch dữ liệu...`);
  
  const startTime = Date.now();
  try {
    // Kích hoạt hàm cào/fetch dữ liệu gốc bất đồng bộ
    await actionFunc();
    
    // Tính toán chính xác thời gian chu kỳ tiếp theo sẽ diễn ra dựa vào số giây interval
    const nextRunTime = new Date(startTime + (intervalSeconds * 1000));
    const nextTimeString = nextRunTime.toTimeString().split(" ")[0];
    const nextDateString = nextRunTime.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });

    console.log(`${getTimestamp()} 🔌 [${taskName}] Hoàn thành fetch dữ liệu thành công.`);
    console.log(`               ➔ ⏱️ Chu kỳ tiếp theo dự kiến: [${nextTimeString} ${nextDateString}] (Chạy sau ${intervalSeconds} giây nữa)\n`);
  } catch (err) {
    console.error(`${getTimestamp()} ❌ [${taskName}] Gặp lỗi khi fetch dữ liệu:`, err.message || err);
  }
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

  const tasks = [];

  if (typeof mqttClient.connectMQTT === "function") {
    // MQTT lắng nghe dữ liệu đẩy (Push) liên tục, không tính theo chu kỳ cào bốc nên đẩy chạy trực tiếp
    tasks.push({ name: "MQTT Broker Listener", action: async () => mqttClient.connectMQTT() });
  }
  
  // Kiểm tra cấu hình môi trường & Bọc luồng SCADA Nhà máy
  const scadaFunc = scadaClient.fetchScadaData || scadaClient.fetchAndPrintScadaData;
  if (typeof scadaFunc === "function") {
    // 🔍 Xác minh nhận diện cấu hình: Ưu tiên lấy biến từ .env tổng
    const scadaInterval = Number(process.env.SCADA_FETCH_INTERVAL_SECONDS) || 60;
    tasks.push({ 
      name: "SCADA Nhà máy", 
      action: () => runTaskWithLog("SCADA Nhà máy", scadaFunc, scadaInterval) 
    });
  } else {
    console.warn(`${getTimestamp()} ⚠️ [SCADA WARNING]: Không tìm thấy hàm fetch dữ liệu trong module scada.js`);
  }

  // Kiểm tra cấu hình môi trường & Bọc luồng TVA Web Scraper
  const tvaFunc = tvaClient.fetchTVAData;
  if (typeof tvaFunc === "function") {
    // 🔍 Xác minh nhận diện cấu hình: Ưu tiên lấy biến từ .env tổng
    const tvaInterval = Number(process.env.TVA_FETCH_INTERVAL_SECONDS) || 60;
    tasks.push({ 
      name: "TVA Web Scraper", 
      action: () => runTaskWithLog("TVA Web Scraper", tvaFunc, tvaInterval) 
    });
  } else {
    console.warn(`${getTimestamp()} ⚠️ [TVA WARNING]: Không tìm thấy hàm fetchTVAData trong module tva.js`);
  }

  // Kiểm tra cấu hình môi trường & Bọc luồng Portal IoT MONRE
  const monreFunc = monreClient.fetchMonreData;
  if (typeof monreFunc === "function") {
    // 🔍 Xác minh nhận diện cấu hình: Ưu tiên lấy biến từ .env tổng
    const monreInterval = Number(process.env.MONRE_FETCH_INTERVAL_SECONDS) || 60;
    tasks.push({ 
      name: "Portal IoT MONRE", 
      action: () => runTaskWithLog("Portal IoT MONRE", monreFunc, monreInterval) 
    });
  } else {
    console.warn(`${getTimestamp()} ⚠️ [MONRE WARNING]: Không tìm thấy hàm fetchMonreData trong module monre.js`);
  }

  // Thực thi kích hoạt đồng loạt song song các luồng cào dữ liệu qua Promise.allSettled
  if (tasks.length > 0) {
    console.log(`${getTimestamp()} ⚡ Kích hoạt đồng loạt song song ${tasks.length} module hệ thống...`);
    
    const results = await Promise.allSettled(tasks.map(task => task.action()));
    
    results.forEach((result, idx) => {
      const taskName = tasks[idx].name;
      if (result.status === "fulfilled") {
        console.log(`${getTimestamp()}    ✅ [${taskName}] Khởi động và gán tiến trình chạy nền thành công.`);
      } else {
        console.error(`${getTimestamp()}    ❌ [${taskName}] Khởi động thất bại:`, result.reason?.message || result.reason);
      }
    });
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
// Nếu chạy Local (chưa cấu hình biến PORT môi trường Cloud), tự động đẩy sang cổng 3001 
// để tránh đè lên cổng 3000 của REST API Dashboard Server.
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
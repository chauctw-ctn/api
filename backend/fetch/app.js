"use strict";

require("dotenv").config();
const http = require("http");
const { openDb } = require("./connection");

// Import tiến trình xử lý từ các file module thành phần
const mqttClient = require("./mqtt");
const scadaClient = require("./scada");
const monreClient = require("./monre");
const tvaClient = require("./tva");

async function bootstrapBackend() {
  console.log("======================================================================");
  console.log("🚀 KHỞI ĐỘNG HỆ THỐNG BACKEND FETCH DATA - ĐỒNG BỘ POSTGRESQL");
  console.log("======================================================================");

  // 1. Kiểm tra trạng thái kết nối tới Pool PostgreSQL trước khi kích hoạt worker
  const db = openDb();
  try {
    const res = await db.query("SELECT NOW() AS current_time");
    console.log(`✅ Kết nối thành công tới PostgreSQL Supabase Pooler.`);
    console.log(`   Thời gian Server DB hiện tại: ${res.rows[0].current_time}\n`);
  } catch (err) {
    console.error("❌ KHÔNG THỂ KẾT NỐI ĐẾN DATABASE POSTGRESQL. Tiến trình bị chặn!");
    console.error("Chi tiết lỗi:", err.message);
    process.exit(1);
  }

  console.log("----------------------------------------------------------------------");
  console.log("🛠️  Kích hoạt các luồng Worker lấy dữ liệu định kỳ (60s/lần)...");
  console.log("----------------------------------------------------------------------");

  // 2. Kích hoạt Worker 1: MQTT Broker (Chạy độc lập theo sự kiện phát ra từ Broker)
  console.log("[WORKER ACTIVE] -> Module MQTT Client đang lắng nghe...");

  // 3. Gom các hàm kích hoạt lần đầu để chuẩn bị thực thi song song
  const tasks = [];
  
  // Trích xuất hàm SCADA Nhà máy
  const scadaFunc = scadaClient.fetchScadaData || scadaClient.fetchAndPrintScadaData;
  if (typeof scadaFunc === "function") {
    tasks.push({ name: "SCADA Nhà máy", action: scadaFunc });
  } else {
    console.warn("⚠️ [SCADA WARNING]: Không tìm thấy hàm fetch dữ liệu trong module scada.js");
  }

  // Trích xuất hàm TVA Web Scraper
  const tvaFunc = tvaClient.fetchTVAData;
  if (typeof tvaFunc === "function") {
    tasks.push({ name: "TVA Web Scraper", action: tvaFunc });
  } else {
    console.warn("⚠️ [TVA WARNING]: Không tìm thấy hàm fetchTVAData trong module tva.js");
  }

  // Trích xuất hàm Portal IoT MONRE
  const monreFunc = monreClient.fetchMonreData;
  if (typeof monreFunc === "function") {
    tasks.push({ name: "Portal IoT MONRE", action: monreFunc });
  } else {
    console.warn("⚠️ [MONRE WARNING]: Không tìm thấy hàm fetchMonreData trong module monre.js");
  }

  // Kích hoạt song song bất đồng bộ chống nghẽn I/O khởi động ứng dụng
  if (tasks.length > 0) {
    console.log(`⚡ Kích hoạt song song ${tasks.length} Worker thực thi luồng cào lần đầu...`);
    
    const results = await Promise.allSettled(tasks.map(task => task.action()));
    
    results.forEach((result, idx) => {
      const taskName = tasks[idx].name;
      if (result.status === "fulfilled") {
        console.log(`   ✅ [${taskName}] Đồng bộ dữ liệu lần đầu hoàn tất.`);
      } else {
        console.error(`   ❌ [${taskName}] Khởi động lỗi:`, result.reason?.message || result.reason);
      }
    });
  }

  console.log("\n======================================================================");
  console.log("🎉 HỆ THỐNG BACKEND ĐANG CHẠY ỔN ĐỊNH Ở CHẾ ĐỘ NỀN (BACKGROUND WORKERS)");
  console.log("-> Các gói tin Latest sẽ cập nhật liên tục sau mỗi 60 giây.");
  console.log("-> Dữ liệu Lịch sử sẽ ghi đồng loạt xuống Postgres mỗi mốc 5 phút tròn.");
  console.log("======================================================================\n");
}

// Bắt lỗi toàn cục không mong muốn để ứng dụng không bị sập bất ngờ (Crash Protection)
process.on("unhandledRejection", (reason, promise) => {
  console.error("🚨 Phát hiện một tác vụ Bất đồng bộ bị lỗi chưa được catch (Unhandled Rejection):", reason);
});

process.on("uncaughtException", (error) => {
  console.error("🚨 Lỗi nghiêm trọng chưa được bắt (Uncaught Exception):", error.message);
});

// Khởi chạy hệ thống thu thập ngầm
bootstrapBackend();

// ======================================================================
// 📡 FIX LỖI RENDER DEPLOY: HEALTH CHECK WEB SERVER TỰ ĐỘNG
// ======================================================================
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { 
      "Content-Type": "application/json",
      "Connection": "keep-alive" 
    });
    res.end(JSON.stringify({ 
      status: "UP", 
      worker: "Active",
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`📡 [CLOUD PORT] Health Check Server đang lắng nghe tại cổng: ${PORT}`);
});
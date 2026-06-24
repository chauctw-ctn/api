"use strict";

require("dotenv").config();
const { openDb } = require("./connection");

// Import tiến trình xử lý
const mqttClient = require("./mqtt");
const scadaClient = require("./scada");
const monreClient = require("./monre");
const tvaClient = require("./tva");

async function bootstrapBackend() {
  console.log("======================================================================");
  console.log("🚀 KHỞI ĐỘNG HỆ THỐNG BACKEND FETCH DATA - ĐỒNG BỘ POSTGRESQL");
  console.log("======================================================================");

  // 1. Kiểm tra database trước
  const db = openDb();
  try {
    const res = await db.query("SELECT NOW() AS current_time");
    console.log(`✅ Kết nối thành công tới PostgreSQL.`);
    console.log(`   Thời gian Server DB hiện tại: ${res.rows[0].current_time}\n`);
  } catch (err) {
    console.error("❌ KHÔNG THỂ KẾT NỐI ĐẾN DATABASE POSTGRESQL. Tiến trình bị chặn!");
    process.exit(1);
  }

  // 2. Gom tất cả các hàm kích hoạt thành phần của 4 module vào mảng để chạy đồng bộ
  const tasks = [];

  if (typeof mqttClient.connectMQTT === "function") {
    tasks.push({ name: "MQTT Broker Listener", action: async () => mqttClient.connectMQTT() });
  }
  
  if (typeof scadaClient.fetchScadaData === "function") {
    tasks.push({ name: "SCADA Nhà máy", action: scadaClient.fetchScadaData });
  }

  if (typeof tvaClient.fetchTVAData === "function") {
    tasks.push({ name: "TVA Web Scraper", action: tvaClient.fetchTVAData });
  }

  if (typeof monreClient.fetchMonreData === "function") {
    tasks.push({ name: "Portal IoT MONRE", action: monreClient.fetchMonreData });
  }

  // 3. Kích hoạt song song tuyệt đối 4 module cùng một lúc
  if (tasks.length > 0) {
    console.log(`⚡ Kích hoạt đồng loạt song song ${tasks.length} module hệ thống...`);
    
    const results = await Promise.allSettled(tasks.map(task => task.action()));
    
    results.forEach((result, idx) => {
      const taskName = tasks[idx].name;
      if (result.status === "fulfilled") {
        console.log(`   ✅ [${taskName}] Khởi động thành công.`);
      } else {
        console.error(`   ❌ [${taskName}] Khởi động thất bại:`, result.reason?.message || result.reason);
      }
    });
  }

  console.log("\n======================================================================");
  console.log("🎉 HỆ THỐNG BACKEND ĐANG CHẠY ỔN ĐỊNH Ở CHẾ ĐỘ NỀN (BACKGROUND WORKERS)");
  console.log("======================================================================\n");
}

bootstrapBackend();
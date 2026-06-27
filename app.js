"use strict";

const { fork } = require("child_process");
const path = require("path");

console.log("======================================================================");
console.log("2026🚀 TRÌNH KHỞI CHẠY HỆ THỐNG TRUNG TÂM IOT (API & WORKERS)");
console.log("======================================================================");

// Định nghĩa đường dẫn vật lý tới 2 file chạy chính của các module con
const API_SERVER_PATH = path.join(__dirname, "apps/api/src/server.js");
const FETCH_WORKER_PATH = path.join(__dirname, "apps/fetch/src/app.js");

/**
 * Hàm khởi chạy luồng con (Child Process) an toàn, có cơ chế tự khởi động lại nếu sập
 * @param {string} name - Tên tiến trình (Dùng để hiển thị log phân biệt)
 * @param {string} scriptPath - Đường dẫn tới file script cần chạy
 */
function startProcess(name, scriptPath) {
  console.log(`[SYSTEM] Đang kích hoạt luồng: ${name}...`);
  
  // Tạo luồng độc lập bằng fork()
  const child = fork(scriptPath, [], {
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "development" }
  });

  // Lắng nghe sự kiện luồng con bị tắt/lỗi
  child.on("exit", (code, signal) => {
    console.error(`❌ [SYSTEM] Luồng [${name}] đã dừng! (Mã thoát: ${code}, Tín hiệu: ${signal})`);
    console.log(`🔄 [SYSTEM] Đang tự động khởi động lại luồng [${name}] sau 5 giây...`);
    
    setTimeout(() => {
      startProcess(name, scriptPath);
    }, 5000);
  });

  return child;
}

// 🟢 KÍCH HOẠT SONG SONG CẢ 2 TIẾN TRÌNH CỐT LÕI
const apiProcess = startProcess("REST-API SERVER", API_SERVER_PATH);
const fetchProcess = startProcess("BACKGROUND WORKERS", FETCH_WORKER_PATH);

// Đảm bảo khi tắt ứng dụng gốc (Ctrl + C), các luồng con cũng được giải phóng sạch sẽ
process.on("SIGINT", () => {
  console.log("\n[SYSTEM] Đang dừng toàn bộ hệ thống trung tâm an toàn...");
  apiProcess.kill();
  fetchProcess.kill();
  process.exit(0);
});
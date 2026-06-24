"use strict";

console.log("=== BẮT ĐẦU KHỞI CHẠY DỰ ÁN TRÊN RENDER ===");

// 1. Kích hoạt Server API hoạt động
try {
  console.log("⏳ Thử nghiệm khởi chạy Server API...");
  require("./backend/api/server.js");
} catch (err) {
  console.error("❌ Không thể kích hoạt Server API:", err.message);
}

// 2. Kích hoạt cụm Fetch dữ liệu nền (Ví dụ chạy file quản lý chung hoặc scada)
// Nếu cụm fetch của bạn có file quản lý tổng (như app.js hoặc index.js), hãy require file đó.
// Ở đây ví dụ require file chạy nền scada:
try {
  console.log("⏳ Thử nghiệm khởi chạy luồng cào dữ liệu nền (Fetch)...");
  // require("./fetch/scada.js"); 
  // Bạn có thể require thêm các module fetch khác nếu muốn chạy song song
} catch (err) {
  console.error("❌ Không thể kích hoạt luồng Fetch dữ liệu:", err.message);
}
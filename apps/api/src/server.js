"use strict";

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config({ path: require("path").join(__dirname, "../../../.env") });
}

const express = require("express");
const cors = require("cors");
const path = require("path"); // 🟢 Bổ sung module path nếu chưa có
const router = require("./routes");

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

app.use(cors()); 
app.use(express.json()); 

// 🟢 1. CẤU HÌNH QUAN TRỌNG NHẤT: Trả file index.html tĩnh ra trang chủ
// Đoạn này ép Express đọc thư mục public (ngang hàng src) làm Static Hosting
app.use(express.static(path.join(__dirname, "../public")));

// Gắn các tuyến API
app.use("/api", router);

// 🟢 2. SỬA LẠI TUYẾN TRANG CHỦ "/" 
// Nếu người dùng vào đường dẫn gốc, tự động gửi file index.html về trình duyệt thay vì trả JSON thô
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Khởi động server
app.listen(PORT, () => {
  console.log(`🚀 SERVER API CHUẨN RESTFUL ĐANG CHẠY TRÊN CỔNG: ${PORT}`);
});
"use strict";

// 1. Đọc file cấu hình môi trường .env từ gốc dự án
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config({ path: require("path").join(__dirname, "../../../.env") });
}

const express = require("express");
const cors = require("cors");
const router = require("./routes"); // Tự động tìm đến thư mục routes/index.js

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

app.use(express.static(require("path").join(__dirname, "../public")));

// ====================================================================
// 🛠️ CẤU HÌNH MIDDLEWARE & ROUTERS
// ====================================================================
// ⚠️ BẮT BUỘC: cors() giúp file index.html bên ngoài gọi API không bị trình duyệt chặn
app.use(cors()); 
app.use(express.json()); 

// Gắn các tuyến API định nghĩa từ routes vào tiền tố /api
app.use("/api", router);

// Tuyến kiểm tra trạng thái sức khỏe (Health Check) thay thế giao diện cũ
app.get("/", (req, res) => {
  res.json({
    status: "healthy",
    message: "IoT Central API Gateway đang hoạt động ổn định.",
    endpoints: {
      latest_grouped: `http://localhost:${PORT}/api/logger/latest/grouped`,
      latest_raw: `http://localhost:${PORT}/api/logger/latest/raw`
    },
    timestamp: new Date()
  });
});

// ====================================================================
// 🚀 KHỞI ĐỘNG SERVER LẮNG NGHE
// ====================================================================
app.listen(PORT, () => {
  console.log("====================================================================");
  console.log(`🚀 SERVER API CHUẨN RESTFUL ĐANG CHẠY ỔN ĐỊNH TRÊN CỔNG: ${PORT}`);
  console.log(`🔗 API dữ liệu nhóm: http://localhost:${PORT}/api/logger/latest/grouped`);
  console.log(`🔗 API dữ liệu thô:  http://localhost:${PORT}/api/logger/latest/raw`);
  console.log("====================================================================");
});
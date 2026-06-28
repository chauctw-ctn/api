"use strict";

require("dotenv").config();
const { Pool } = require("pg");

// Tạo connection pool dựa trên DATABASE_URL từ .env
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Cấu hình Pool kết nối tối ưu cho background worker
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: {
    rejectUnauthorized: false
  }
});

// 🔥 FIX TẬN GỐC MÚI GIỜ: Lắng nghe sự kiện kết nối của Client
// Ép mọi Session làm việc của Postgres với Node.js tự động chuyển dịch về múi giờ Việt Nam (+07)
pool.on("connect", async (client) => {
  try {
    await client.query("SET TIME ZONE 'Asia/Ho_Chi_Minh';");
  } catch (err) {
    console.error("🚨 Không thể cấu hình SET TIME ZONE cho Session kết nối Postgres:", err.message);
  }
});

function openDb() {
  // Trả về pool để dùng chung cho việc truy vấn
  return pool;
}

module.exports = { openDb };
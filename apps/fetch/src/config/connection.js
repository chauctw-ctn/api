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

function openDb() {
  // Trả về pool để dùng chung cho việc truy vấn
  return pool;
}

module.exports = { openDb };
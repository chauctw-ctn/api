const { Pool } = require("pg");

function openDb() {
  return new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || "5432"),
    // 🛠️ BẮT BUỘC: Thêm cấu hình ssl này để chạy mượt mà trên Render với Supabase Pooler
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
  });
}

module.exports = { openDb };
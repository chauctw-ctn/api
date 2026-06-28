"use strict";

require("dotenv").config();
const { Pool } = require("pg");

function buildConnectionString(baseUrl) {
  if (!baseUrl) throw new Error("DATABASE_URL chưa được cấu hình trong file .env");
  try {
    const url = new URL(baseUrl);
    // Ghi đè hoặc thêm mới tham số options vào query string của URL
    url.searchParams.set("options", "-c timezone=Asia/Ho_Chi_Minh");
    return url.toString();
  } catch {
    // Fallback nếu DATABASE_URL không parse được dạng URL chuẩn
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}options=-c%20timezone%3DAsia%2FHo_Chi_Minh`;
  }
}

const pool = new Pool({
  connectionString: buildConnectionString(process.env.DATABASE_URL),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: {
    rejectUnauthorized: false
  }
});

// Lớp bảo vệ thứ 2: đảm bảo connection mới luôn đúng timezone
pool.on("connect", async (client) => {
  try {
    await client.query("SET TIME ZONE 'Asia/Ho_Chi_Minh';");
  } catch (err) {
    console.error("🚨 Không thể cấu hình SET TIME ZONE cho Session:", err.message);
  }
});

function openDb() {
  return pool;
}

module.exports = { openDb };
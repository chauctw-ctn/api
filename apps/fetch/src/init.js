"use strict";

// Trỏ đúng vào cấu hình kết nối từ thư mục config
const { openDb } = require("./config/connection");
const db = openDb();

async function initDatabase() {
  console.log("🛠 Khởi động quá trình dọn sạch và làm mới Database trên PostgreSQL...");

  try {
    // Xóa theo thứ tự để tránh xung đột ràng buộc khóa ngoại (Foreign Key)
    await db.query("DROP TABLE IF EXISTS alert_thresholds CASCADE");
    await db.query("DROP TABLE IF EXISTS logger_tag_mappings CASCADE");
    await db.query("DROP TABLE IF EXISTS logger_stations CASCADE");
    await db.query("DROP TABLE IF EXISTS logger_latest CASCADE");
    await db.query("DROP TABLE IF EXISTS logger_readings CASCADE");
    await db.query("DROP TABLE IF EXISTS telegram_configs CASCADE");
    await db.query("DROP TABLE IF EXISTS users CASCADE");

    console.log("🗑 Đã xóa sạch cấu trúc dữ liệu và các bảng cũ.");

    // 1. Tạo bảng TRẠM HIỂN THỊ
    await db.query(`
      CREATE TABLE logger_stations (
        station_id VARCHAR(100) PRIMARY KEY,
        display_name VARCHAR(255) NOT NULL,
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        description TEXT
      )
    `);

    // 2. Tạo bảng MAPPING TAG
    await db.query(`
      CREATE TABLE logger_tag_mappings (
        id SERIAL PRIMARY KEY,
        source VARCHAR(50) NOT NULL,
        source_logger_id VARCHAR(100) NOT NULL,
        source_tag_key VARCHAR(100) NOT NULL,
        target_station_id VARCHAR(100) NOT NULL,
        FOREIGN KEY (target_station_id) REFERENCES logger_stations(station_id) ON DELETE CASCADE,
        UNIQUE(source_logger_id, source_tag_key, target_station_id)
      )
    `);

    // 3. Tạo bảng DỮ LIỆU GẦN NHẤT
    await db.query(`
      CREATE TABLE logger_latest (
        logger_id VARCHAR(100) NOT NULL,
        tag_key VARCHAR(100) NOT NULL,
        data_ts TIMESTAMPTZ NOT NULL,
        value DOUBLE PRECISION,
        current_ts TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, 
        PRIMARY KEY (logger_id, tag_key)
      )
    `);

    // 4. Tạo bảng DỮ LIỆU LỊCH SỬ
    await db.query(`
      CREATE TABLE logger_readings (
        id BIGSERIAL PRIMARY KEY,
        logger_id VARCHAR(100) NOT NULL,
        tag_key VARCHAR(100) NOT NULL,
        data_ts TIMESTAMPTZ NOT NULL,
        data_save TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        value DOUBLE PRECISION
      )
    `);

    // 5. Cấu hình ngưỡng Min/Max (Đã thêm last_alerted_ts để tracking chu kỳ gửi tin)
    await db.query(`
      CREATE TABLE alert_thresholds (
        id SERIAL PRIMARY KEY,
        station_id VARCHAR(100) NOT NULL,
        tag_key VARCHAR(100) NOT NULL,
        min_value DOUBLE PRECISION,
        max_value DOUBLE PRECISION,
        enabled INTEGER DEFAULT 1,
        last_alerted_ts TIMESTAMPTZ,
        UNIQUE(station_id, tag_key)
      )
    `);

    // 6. Cấu hình Telegram (Đã thêm alert_interval_minutes quản lý thời gian cooldown)
    await db.query(`
      CREATE TABLE telegram_configs (
        id SERIAL PRIMARY KEY,
        bot_token TEXT,
        chat_id TEXT,
        enabled INTEGER DEFAULT 1,
        alert_interval_minutes INTEGER DEFAULT 15
      )
    `);
    await db.query("INSERT INTO telegram_configs (id, bot_token, chat_id, enabled, alert_interval_minutes) VALUES (1, '', '', 0, 15)");

    // 7. Quản lý tài khoản User
    await db.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name VARCHAR(255),
        role VARCHAR(50) DEFAULT 'operator',
        created_ts TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== KHỞI TẠO CHỈ MỤC (INDEXES) CHIẾN LƯỢC ====================
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_readings_query 
      ON logger_readings (logger_id, tag_key, data_ts DESC);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_mappings_lookup 
      ON logger_tag_mappings (target_station_id);
    `);

    console.log("✅ Cấu trúc DB Postgres hoàn toàn trống rỗng và Chỉ mục đã khởi tạo thành công!");
  } catch (err) {
    console.error("❌ Lỗi khởi tạo Database:", err.message);
  } finally {
    await db.end();
    console.log("🏁 Đã ngắt kết nối an toàn.");
  }
}

initDatabase();
"use strict";

const { openDb } = require("./connection");

const db = openDb();

async function initDatabase() {
  console.log("🛠 Khởi động quá trình dọn sạch và làm mới Database trên PostgreSQL...");

  try {
    await db.query("DROP TABLE IF EXISTS alert_thresholds CASCADE");
    await db.query("DROP TABLE IF EXISTS logger_tag_mappings CASCADE");
    await db.query("DROP TABLE IF EXISTS logger_stations CASCADE");
    await db.query("DROP TABLE IF EXISTS logger_latest CASCADE");
    await db.query("DROP TABLE IF EXISTS logger_readings CASCADE");
    await db.query("DROP TABLE IF EXISTS telegram_configs CASCADE");
    await db.query("DROP TABLE IF EXISTS users CASCADE");

    console.log("🗑 Đã xóa sạch cấu trúc dữ liệu và các bảng cũ.");

    // Tạo bảng TRẠM HIỂN THỊ
    await db.query(`
      CREATE TABLE logger_stations (
        station_id VARCHAR(255) PRIMARY KEY,
        display_name VARCHAR(255) NOT NULL,
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        description TEXT
      )
    `);

    // Tạo bảng MAPPING TAG
    await db.query(`
      CREATE TABLE logger_tag_mappings (
        id SERIAL PRIMARY KEY,
        source VARCHAR(100) NOT NULL,
        hardware_tag VARCHAR(255) NOT NULL,
        parameter_key VARCHAR(100) NOT NULL,
        target_station_id VARCHAR(255) NOT NULL,
        FOREIGN KEY (target_station_id) REFERENCES logger_stations(station_id) ON DELETE CASCADE,
        UNIQUE(source, hardware_tag, parameter_key)
      )
    `);

    // Tạo bảng DỮ LIỆU GẦN NHẤT    
    await db.query(`
      CREATE TABLE logger_latest (
        logger_id VARCHAR(255) NOT NULL,
        tag_key VARCHAR(100) NOT NULL,
        data_ts VARCHAR(50) NOT NULL,
        value DOUBLE PRECISION,
        current_ts VARCHAR(50) NOT NULL, 
        PRIMARY KEY (logger_id, tag_key)
      )
    `);

    // 🛠️ SỬA LỖI TẠI ĐÂY: Thêm cột data_save vào bảng DỮ LIỆU LỊCH SỬ
    await db.query(`
      CREATE TABLE logger_readings (
        id SERIAL PRIMARY KEY,
        logger_id VARCHAR(255) NOT NULL,
        tag_key VARCHAR(100) NOT NULL,
        data_ts VARCHAR(50) NOT NULL,
        data_save VARCHAR(50) NOT NULL,
        value DOUBLE PRECISION
      )
    `);

    // Cấu hình ngưỡng Min/Max
    await db.query(`
      CREATE TABLE alert_thresholds (
        id SERIAL PRIMARY KEY,
        station_id VARCHAR(255) NOT NULL,
        tag_key VARCHAR(100) NOT NULL,
        min_value DOUBLE PRECISION,
        max_value DOUBLE PRECISION,
        enabled INTEGER DEFAULT 1,
        FOREIGN KEY(station_id) REFERENCES logger_stations(station_id) ON DELETE CASCADE,
        UNIQUE(station_id, tag_key)
      )
    `);

    // Cấu hình Telegram
    await db.query(`
      CREATE TABLE telegram_configs (
        id SERIAL PRIMARY KEY,
        bot_token TEXT,
        chat_id TEXT,
        enabled INTEGER DEFAULT 1
      )
    `);
    await db.query("INSERT INTO telegram_configs (id, bot_token, chat_id, enabled) VALUES (1, '', '', 0)");

    // Quản lý tài khoản User
    await db.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name VARCHAR(255),
        role VARCHAR(50) DEFAULT 'operator',
        created_ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== KHỞI TẠO CHỈ MỤC (INDEXES) ====================
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_logger_latest_lookup 
      ON logger_latest (logger_id, tag_key, current_ts);
    `);

    // 🛠️ SỬA LỖI TẠI ĐÂY: Cập nhật chỉ mục chứa cả data_save để tăng tốc tìm kiếm lịch sử chu kỳ
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_history_lookup 
      ON logger_readings (logger_id, tag_key, data_ts, data_save);
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
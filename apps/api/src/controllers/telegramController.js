"use strict";

const { openDb } = require("../config/connection");
const db = openDb();

/**
 * API: Lấy cấu hình Telegram hiện tại (row id = 1).
 */
async function getTelegramConfig(req, res) {
  try {
    const result = await db.query(
      `SELECT bot_token, chat_id, enabled, alert_interval_minutes, offline_delay_minutes FROM telegram_configs WHERE id = 1 LIMIT 1;`
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Chưa có cấu hình Telegram." });
    }

    const row = result.rows[0];
    return res.status(200).json({
      success: true,
      data: {
        bot_token: row.bot_token || "",
        chat_id:   row.chat_id   || "",
        enabled:   row.enabled === 1 || row.enabled === true,
        alert_interval_minutes: row.alert_interval_minutes || 15,
        offline_delay_minutes:  row.offline_delay_minutes  || 30
      }
    });
  } catch (error) {
    console.error("❌ [Telegram] getTelegramConfig:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * API: Lưu cấu hình Telegram (UPDATE row id = 1).
 */
async function saveTelegramConfig(req, res) {
  try {
    const { bot_token, chat_id, enabled, alert_interval_minutes, offline_delay_minutes } = req.body;

    if (!bot_token || String(bot_token).trim() === "") {
      return res.status(400).json({ success: false, message: "Thiếu Bot Token." });
    }

    if (!chat_id || String(chat_id).trim() === "") {
      return res.status(400).json({ success: false, message: "Thiếu Chat ID." });
    }

    const enabledInt = enabled ? 1 : 0;
    const intervalInt = parseInt(alert_interval_minutes, 10) || 15;
    const offlineDelayInt = parseInt(offline_delay_minutes, 10) || 30;

    await db.query(
      `UPDATE telegram_configs 
       SET bot_token = $1, chat_id = $2, enabled = $3, alert_interval_minutes = $4, offline_delay_minutes = $5 
       WHERE id = 1;`,
      [String(bot_token).trim(), String(chat_id).trim(), enabledInt, intervalInt, offlineDelayInt]
    );

    return res.status(200).json({ success: true, message: "Lưu cấu hình Telegram thành công!" });
  } catch (error) {
    console.error("❌ [Telegram] saveTelegramConfig:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * API: Gửi tin nhắn test để kiểm tra cấu hình Telegram.
 */
async function testTelegramConfig(req, res) {
  try {
    const result = await db.query(
      `SELECT bot_token, chat_id FROM telegram_configs WHERE id = 1 LIMIT 1;`
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Chưa có cấu hình Telegram." });
    }

    const { bot_token, chat_id } = result.rows[0];

    if (!bot_token || !chat_id) {
      return res.status(400).json({
        success: false,
        message: "Bot Token hoặc Chat ID chưa được cấu hình."
      });
    }

    const message = `✅ Kiểm tra kết nối thành công!\n🕐 Thời gian: ${new Date().toLocaleString("vi-VN")}\n🤖 Hệ thống cảnh báo đã sẵn sàng.`;

    const telegramUrl = `https://api.telegram.org/bot${bot_token}/sendMessage`;
    const response = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id, text: message })
    });

    const telegramResult = await response.json();

    if (!telegramResult.ok) {
      return res.status(400).json({
        success: false,
        message: `Telegram từ chối: ${telegramResult.description || "Lỗi không xác định"}`
      });
    }

    return res.status(200).json({ success: true, message: "Đã gửi tin nhắn test thành công!" });
  } catch (error) {
    console.error("❌ [Telegram] testTelegramConfig:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = {
  getTelegramConfig,
  saveTelegramConfig,
  testTelegramConfig
};
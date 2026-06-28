"use strict";

const { openDb } = require("../config/connection");
const db = openDb();

const PARAMETER_NAME_MAP = {
  level:      "Mực nước",
  flow:       "Lưu lượng",
  totalIndex: "Tổng lưu lượng",
  ph:         "Độ pH",
  tds:        "Tổng chất rắn hòa tan (TDS)",
  no3:        "Hàm lượng Nitrat (NO₃)",
  nh4:        "Hàm lượng Amoni (NH₄⁺)",
  amino:      "Hàm lượng Amino"
};

const TAG_ALIAS_MAP = {
  "ph": "ph", "tds": "tds", "nitrat": "no3", "no3": "no3", "nh4+": "nh4", "nh4": "nh4", 
  "amoni": "nh4", "mucnuoc": "level", "h": "level", "level": "level", "luuluong": "flow", 
  "q": "flow", "flow": "flow", "tongluuluong": "totalIndex", "v": "totalIndex", 
  "totalindex": "totalIndex", "amino": "amino"
};

// Bộ nhớ đệm quản lý Cooldown tránh spam tin nhắn offline và phát hiện phục hồi tín hiệu
const offlineCooldowns = new Map();
const currentlyOfflineLoggers = new Set();

// ====================================================================
// 🛡️ KHỐI TỰ ĐỘNG PHỤC HỒI CẤU TRÚC DB (SELF-HEALING)
// ====================================================================
(async () => {
  try {
    await db.query(`ALTER TABLE telegram_configs ADD COLUMN IF NOT EXISTS offline_delay_minutes INTEGER DEFAULT 30;`);
  } catch (_) {}
})();

/**
 * LỰC LƯỢNG QUÉT NGẦM (BACKGROUND WORKER) - Chạy mỗi 60 giây một lần
 * So sánh trực tiếp giữa data_ts và current_ts để phát hiện đơ tín hiệu, 
 * kết hợp so sánh với giờ hệ thống thực đề phòng luồng fetch bị sập hoàn toàn.
 */
setInterval(async () => {
  try {
    const telRes = await db.query(
      `SELECT bot_token, chat_id, enabled, alert_interval_minutes, offline_delay_minutes FROM telegram_configs WHERE id = 1 LIMIT 1;`
    );
    if (!telRes.rows || telRes.rows.length === 0) return;
    const telConfig = telRes.rows[0];
    if (telConfig.enabled !== 1 && telConfig.enabled !== true) return;
    if (!telConfig.bot_token || !telConfig.chat_id) return;

    const offlineDelay = telConfig.offline_delay_minutes || 30;
    const intervalMinutes = telConfig.alert_interval_minutes || 15;
    const now = new Date();

    // Nhóm và lấy mốc thời gian mới nhất của từng thiết bị đo
    const latestRes = await db.query(`
      SELECT logger_id, MAX(data_ts) as last_data_ts, MAX(current_ts) as last_current_ts
      FROM logger_latest
      GROUP BY logger_id;
    `);

    for (const row of latestRes.rows) {
      const { logger_id, last_data_ts, last_current_ts } = row;
      if (!last_data_ts || !last_current_ts) continue;

      const dataTs = new Date(last_data_ts);
      const currentTs = new Date(last_current_ts);

      // Tính toán độ trễ (minutes)
      const lagMinutes = (currentTs - dataTs) / (1000 * 60); // Độ lệch giữa trạm và tool cào
      const deadMinutes = (now - currentTs) / (1000 * 60);   // Độ lệch giữa tool cào và thời gian thực hiện tại

      if (lagMinutes > offlineDelay || deadMinutes > offlineDelay) {
        // Phát hiện thiết bị mất kết nối (Offline)
        const lastAlertTime = offlineCooldowns.get(logger_id);
        
        if (!lastAlertTime || (now - lastAlertTime) / (1000 * 60) >= intervalMinutes) {
          let reason = "";
          if (lagMinutes > offlineDelay) {
            reason = `Cổng nhận API vẫn chạy nhưng dữ liệu cảm biến bị đóng băng (Trễ: ${Math.round(lagMinutes)} phút)`;
          } else {
            reason = `Hệ thống ngừng nhận hoàn toàn mọi gói tin mới của thiết bị này (Trễ: ${Math.round(deadMinutes)} phút)`;
          }

          const message = `🚨 [CẢNH BÁO THIẾT BỊ OFFLINE]\n` +
                          `📍 Thiết bị (Logger): ${logger_id}\n` +
                          `⚠️ Trạng thái: MẤT KẾT NỐI ❌\n` +
                          `🔍 Nguyên nhân: ${reason}\n` +
                          `🕒 Lần cuối cập nhật: ${dataTs.toLocaleString("vi-VN")}\n` +
                          `🕐 Thời điểm phát hiện: ${now.toLocaleString("vi-VN")}`;

          await sendTelegramMessage(telConfig.bot_token, telConfig.chat_id, message);
          offlineCooldowns.set(logger_id, now);
          currentlyOfflineLoggers.add(logger_id);
        }
      } else {
        // Thiết bị bình thường (Online) -> Kiểm tra xem trước đó nó có từng bị offline không
        if (currentlyOfflineLoggers.has(logger_id)) {
          const message = `🟢 [THIẾT BỊ ĐÃ ONLINE TRỞ LẠI]\n` +
                          `📍 Thiết bị (Logger): ${logger_id}\n` +
                          `✅ Trạng thái: ĐÃ KHÔI PHỤC KẾT NỐI ✔️\n` +
                          `📊 Dữ liệu mới nhất đồng bộ lúc: ${dataTs.toLocaleString("vi-VN")}\n` +
                          `🕐 Thời điểm ghi nhận: ${now.toLocaleString("vi-VN")}`;
          
          await sendTelegramMessage(telConfig.bot_token, telConfig.chat_id, message);
          currentlyOfflineLoggers.delete(logger_id);
          offlineCooldowns.delete(logger_id); // Giải phóng bộ nhớ cooldown
        }
      }
    }
  } catch (err) {
    console.error("❌ [AlertService][OfflineCheck] Gặp lỗi khi quét trạng thái offline:", err.message);
  }
}, 60 * 1000);

/**
 * Hàm phụ trợ gửi tin nhắn ẩn danh không gây nghẽn luồng chính
 */
async function sendTelegramMessage(botToken, chatId, text) {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    });
  } catch (e) {
    console.error("❌ [AlertService] Thất bại khi bắn tin nhắn khẩn cấp lên Telegram:", e.message);
  }
}

/**
 * Kiểm tra ngưỡng cảnh báo giá trị chỉ số vượt ngưỡng (Hàm cũ giữ nguyên logic)
 */
async function checkAndAlert(loggerId, tagKey, value) {
  try {
    const lookupKey = String(tagKey).trim().toLowerCase();
    const normalizedTagKey = TAG_ALIAS_MAP[lookupKey];
    if (!normalizedTagKey) return; 

    const telRes = await db.query(
      `SELECT bot_token, chat_id, enabled, alert_interval_minutes FROM telegram_configs WHERE id = 1 LIMIT 1;`
    );
    if (!telRes.rows || telRes.rows.length === 0) return;
    const telConfig = telRes.rows[0];
    if (telConfig.enabled !== 1 && telConfig.enabled !== true) return;
    if (!telConfig.bot_token || !telConfig.chat_id) return;

    const thresholdRes = await db.query(
      `SELECT min_value, max_value, enabled, last_alerted_ts 
       FROM alert_thresholds 
       WHERE station_id = $1 AND tag_key = $2 LIMIT 1;`,
      [loggerId, normalizedTagKey]
    );

    if (!thresholdRes.rows || thresholdRes.rows.length === 0) return;
    const threshold = thresholdRes.rows[0];
    if (threshold.enabled !== 1 && threshold.enabled !== true) return;

    const { min_value, max_value, last_alerted_ts } = threshold;
    let isViolation = false;
    let violationType = "";
    let limitValue = null;

    if (min_value !== null && value < min_value) {
      isViolation = true;
      violationType = "Thấp hơn ngưỡng tối thiểu (Min)";
      limitValue = min_value;
    } else if (max_value !== null && value > max_value) {
      isViolation = true;
      violationType = "Vượt ngưỡng tối đa (Max)";
      limitValue = max_value;
    }

    if (!isViolation) {
      if (last_alerted_ts !== null) {
        await db.query(
          `UPDATE alert_thresholds SET last_alerted_ts = NULL WHERE station_id = $1 AND tag_key = $2;`,
          [loggerId, normalizedTagKey]
        );
      }
      return;
    }

    const now = new Date();
    const intervalMinutes = telConfig.alert_interval_minutes || 15;

    if (last_alerted_ts) {
      const lastAlertTime = new Date(last_alerted_ts);
      const diffMinutes = (now - lastAlertTime) / (1000 * 60);
      if (diffMinutes < intervalMinutes) return;
    }

    const paramName = PARAMETER_NAME_MAP[normalizedTagKey] || normalizedTagKey;
    const message = `🚨 [CẢNH BÁO VƯỢT NGƯỠNG]\n` +
                    `📍 Thiết bị (Logger): ${loggerId}\n` +
                    `🏷️ Chỉ số: ${paramName} (${normalizedTagKey})\n` +
                    `⚠️ Trạng thái: ${violationType}\n` +
                    `📊 Giá trị hiện tại: ${value}\n` +
                    `📉 Ngưỡng quy định: ${limitValue}\n` +
                    `🕐 Thời điểm ghi nhận: ${now.toLocaleString("vi-VN")}`;

    const response = await fetch(`https://api.telegram.org/bot${telConfig.bot_token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telConfig.chat_id, text: message })
    });

    const telegramResult = await response.json();
    if (telegramResult.ok) {
      await db.query(
        `UPDATE alert_thresholds SET last_alerted_ts = $1 WHERE station_id = $2 AND tag_key = $3;`,
        [now, loggerId, normalizedTagKey]
      );
    }
  } catch (error) {
    console.error("❌ [AlertService] Gặp lỗi khi phân tích cảnh báo chỉ số:", error.message);
  }
}

module.exports = { checkAndAlert };
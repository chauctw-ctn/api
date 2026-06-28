"use strict";

const { openDb } = require("../config/connection");
const db = openDb();

const VALID_TAG_KEYS = new Set([
  "level", "flow", "totalIndex", "ph", "tds", "no3", "nh4", "amino"
]);

/**
 * API: Lấy danh sách tag của một logger kèm cấu hình alert hiện tại.
 * Không yêu cầu mapping — alert lưu trực tiếp theo logger_id + tag_key.
 */
async function getTagsByLogger(req, res) {
  try {
    const { logger_id } = req.params;

    if (!logger_id) {
      return res.status(400).json({ success: false, message: "Thiếu logger_id." });
    }

    const queryText = `
      SELECT
        l.logger_id,
        l.tag_key,
        l.value                AS latest_value,
        t.min_value,
        t.max_value,
        COALESCE(t.enabled, 0) AS enabled
      FROM logger_latest l
      LEFT JOIN alert_thresholds t
        ON l.logger_id = t.station_id
       AND l.tag_key   = t.tag_key
      WHERE l.logger_id = $1
      ORDER BY l.tag_key;
    `;

    const result = await db.query(queryText, [logger_id]);

    const rows = (result.rows || []).map(row => ({
      ...row,
      enabled: row.enabled === 1 || row.enabled === true
    }));

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("❌ [Alert] getTagsByLogger:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * API: Tạo mới hoặc cập nhật ngưỡng cảnh báo.
 * station_id = logger_id — không cần mapping, không cần FK.
 */
async function saveAlertThreshold(req, res) {
  try {
    const { station_id, tag_key, min_value, max_value, enabled } = req.body;

    if (!station_id || String(station_id).trim() === "") {
      return res.status(400).json({ success: false, message: "Thiếu station_id / logger_id." });
    }

    if (!tag_key || String(tag_key).trim() === "") {
      return res.status(400).json({ success: false, message: "Thiếu tag_key." });
    }

    if (!VALID_TAG_KEYS.has(tag_key)) {
      return res.status(400).json({
        success: false,
        message: `tag_key không hợp lệ: "${tag_key}". Hợp lệ: ${[...VALID_TAG_KEYS].join(", ")}.`
      });
    }

    const stationIdParam = String(station_id).trim();
    const minVal = (min_value !== undefined && min_value !== null && min_value !== "")
      ? parseFloat(min_value) : null;
    const maxVal = (max_value !== undefined && max_value !== null && max_value !== "")
      ? parseFloat(max_value) : null;
    const enabledInt = enabled ? 1 : 0;

    if (minVal !== null && isNaN(minVal)) {
      return res.status(400).json({ success: false, message: "min_value không hợp lệ." });
    }
    if (maxVal !== null && isNaN(maxVal)) {
      return res.status(400).json({ success: false, message: "max_value không hợp lệ." });
    }
    if (minVal !== null && maxVal !== null && minVal > maxVal) {
      return res.status(400).json({
        success: false,
        message: "Ngưỡng dưới (min) không được lớn hơn ngưỡng trên (max)."
      });
    }

    const upsertQuery = `
      INSERT INTO alert_thresholds (station_id, tag_key, min_value, max_value, enabled)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (station_id, tag_key)
      DO UPDATE SET
        min_value = EXCLUDED.min_value,
        max_value = EXCLUDED.max_value,
        enabled   = EXCLUDED.enabled;
    `;

    await db.query(upsertQuery, [stationIdParam, tag_key, minVal, maxVal, enabledInt]);

    return res.status(200).json({ success: true, message: "Lưu cấu hình cảnh báo thành công!" });
  } catch (error) {
    console.error("❌ [Alert] saveAlertThreshold:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = {
  getTagsByLogger,
  saveAlertThreshold
};
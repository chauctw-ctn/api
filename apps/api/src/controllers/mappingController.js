"use strict";
const { openDb } = require("../config/connection");
const db = openDb();

async function getMappingHelpers(req, res) {
  try {
    const allStationsQuery = `
      SELECT station_id, display_name FROM logger_stations
      UNION
      SELECT DISTINCT logger_id AS station_id, logger_id AS display_name FROM logger_latest
      ORDER BY display_name ASC;
    `;
    const stationsResult = await db.query(allStationsQuery);
    
    const rawDataResult = await db.query("SELECT DISTINCT logger_id, tag_key FROM logger_latest ORDER BY tag_key ASC;");
    const sourcesMap = {};
    rawDataResult.rows.forEach(row => {
      if (!sourcesMap[row.logger_id]) sourcesMap[row.logger_id] = [];
      sourcesMap[row.logger_id].push(row.tag_key);
    });

    // Tối ưu hóa: Tạo lại chuỗi hardware_tag bằng SQL để khớp với UI cũ
    const currentMappings = await db.query(`
      SELECT 
        id, 
        source, 
        CONCAT(source_logger_id, ':', source_tag_key) AS hardware_tag, 
        source_tag_key AS parameter_key, 
        target_station_id 
      FROM logger_tag_mappings 
      ORDER BY id DESC;
    `);

    return res.status(200).json({
      success: true,
      target_stations: stationsResult.rows,
      source_stations: sourcesMap,
      active_mappings: currentMappings.rows 
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function getStationTags(req, res) {
  const { station_id } = req.params;
  try {
    const r1 = await db.query("SELECT tag_key FROM logger_latest WHERE logger_id = $1;", [station_id]);
    const nativeTags = r1.rows.map(r => ({ tag_key: r.tag_key, is_native: true, origin_info: station_id }));

    // Tối ưu hóa: Tạo lại chuỗi hardware_tag để hàm r.hardware_tag.split(":") trong index.html không bị lỗi
    const r2 = await db.query(`
      SELECT 
        source_tag_key AS tag_key, 
        CONCAT(source_logger_id, ':', source_tag_key) AS hardware_tag 
      FROM logger_tag_mappings 
      WHERE target_station_id = $1;
    `, [station_id]);
    
    const mappedTags = r2.rows.map(r => {
      const originStation = r.hardware_tag.split(":")[0] || "Không rõ";
      return { tag_key: r.tag_key, is_native: false, origin_info: originStation };
    });

    return res.status(200).json({ success: true, tags: [...nativeTags, ...mappedTags] });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function createMapping(req, res) {
  const { source_logger_id, tag_key, target_station_id } = req.body;
  if (!source_logger_id || !tag_key || !target_station_id) {
    return res.status(400).json({ success: false, message: "Thiếu thông tin cấu hình." });
  }
  try {
    const sourcePrefix = source_logger_id.split("_")[0] || "unknown";

    await db.query("INSERT INTO logger_stations (station_id, display_name) VALUES ($1, $2) ON CONFLICT (station_id) DO NOTHING;", [target_station_id, target_station_id]);

    // Lưu vào cấu trúc bảng mới đã chuẩn hóa phân rã
    const queryText = `
      INSERT INTO logger_tag_mappings (source, source_logger_id, source_tag_key, target_station_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (source_logger_id, source_tag_key, target_station_id)
      DO NOTHING;
    `;
    await db.query(queryText, [sourcePrefix, source_logger_id, tag_key, target_station_id]);
    return res.status(200).json({ success: true, message: "Đã gán ánh xạ chuẩn xác!" });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function deleteMapping(req, res) {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM logger_tag_mappings WHERE id = $1;", [id]);
    return res.status(200).json({ success: true, message: "Đã hủy bỏ ánh xạ ảo thành công." });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = { getMappingHelpers, getStationTags, createMapping, deleteMapping };
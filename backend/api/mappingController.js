"use strict";

const { openDb } = require("./connection");
const db = openDb();

/**
 * 🚀 API: Lấy các danh sách phục vụ đổ vào Dropdown & Quản lý danh sách ánh xạ hiện có
 * GET /api/mappings/helpers
 */
async function getMappingHelpers(req, res) {
  try {
    // 1. Lấy tất cả các trạm
    const allStationsQuery = `
      SELECT station_id, display_name FROM logger_stations
      UNION
      SELECT DISTINCT logger_id AS station_id, logger_id AS display_name FROM logger_latest
      ORDER BY display_name ASC;
    `;
    const stationsResult = await db.query(allStationsQuery);
    
    // 2. Lấy danh sách gốc của tầng fetch (Tag vật lý)
    const rawDataResult = await db.query("SELECT DISTINCT logger_id, tag_key FROM logger_latest ORDER BY tag_key ASC;");
    const sourcesMap = {};
    rawDataResult.rows.forEach(row => {
      if (!sourcesMap[row.logger_id]) sourcesMap[row.logger_id] = [];
      sourcesMap[row.logger_id].push(row.tag_key);
    });

    // 3. Lấy danh sách các bản ghi ĐANG ÁNH XẠ ẢO hiện tại trong hệ thống
    const currentMappings = await db.query(`
      SELECT id, source, hardware_tag, parameter_key, target_station_id 
      FROM logger_tag_mappings 
      ORDER BY id DESC;
    `);

    return res.status(200).json({
      success: true,
      target_stations: stationsResult.rows,
      source_stations: sourcesMap,
      active_mappings: currentMappings.rows // Danh sách cấu hình ảo để Xóa/Sửa
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

    // 🛠️ CẢI TIẾN: Lấy thêm thông tin Trạm gốc ban đầu sinh ra nó để hiển thị lên UI trạm nhận
    const r2 = await db.query(`
      SELECT parameter_key AS tag_key, hardware_tag 
      FROM logger_tag_mappings 
      WHERE target_station_id = $1;
    `, [station_id]);
    
    const mappedTags = r2.rows.map(r => {
      // hardware_tag lưu dạng "tva_gs01:flow", bẻ chuỗi lấy "tva_gs01" làm thông tin nguồn
      const originStation = r.hardware_tag.split(":")[0] || "Không rõ";
      return {
        tag_key: r.tag_key,
        is_native: false,
        origin_info: originStation
      };
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
    const sourcePrefix = source_logger_id.split("_")[0];
    // 🛠️ FIX CHUẨN: hardware_tag lưu chính xác "tva_gs01:flow"
    const uniqueHardwareTag = `${source_logger_id}:${tag_key}`;

    await db.query("INSERT INTO logger_stations (station_id, display_name) VALUES ($1, $2) ON CONFLICT (station_id) DO NOTHING;", [target_station_id, target_station_id]);

    const queryText = `
      INSERT INTO logger_tag_mappings (source, hardware_tag, parameter_key, target_station_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (source, hardware_tag, parameter_key)
      DO UPDATE SET target_station_id = EXCLUDED.target_station_id;
    `;
    await db.query(queryText, [sourcePrefix, uniqueHardwareTag, tag_key, target_station_id]);
    return res.status(200).json({ success: true, message: "Đã gán ánh xạ chuẩn xác!" });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * 🚀 API: Xóa bản ghi ánh xạ ảo (Tuyệt đối không ảnh hưởng tới dữ liệu gốc)
 * DELETE /api/mappings/:id
 */
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
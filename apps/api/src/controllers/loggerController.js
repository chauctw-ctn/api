"use strict";

const { openDb } = require("../config/connection");
const db = openDb();

const PARAMETER_NAME_MAP = {
  level: "Mực nước",
  flow: "Lưu lượng",
  totalIndex: "Tổng lưu lượng",
  ph: "Độ pH",
  tds: "Tổng chất rắn hòa tan (TDS)",
  no3: "Hàm lượng Nitrat (NO3)",
  nh4: "Hàm lượng Amoni (NH4+)",
  amino: "Hàm lượng Amino"
};

async function getLatestDataGrouped(req, res) {
  try {
    // 🛠️ FIX CHUẨN 100%: Khớp trực tiếp mã trạm và mã tag bằng liên kết chuỗi (CONCAT)
    const queryText = `
      SELECT 
        l.logger_id AS original_logger_id, 
        l.tag_key, 
        l.data_ts, 
        l.value, 
        l.current_ts,
        m.target_station_id,
        s_orig.display_name AS orig_display_name,
        s_orig.lat AS orig_lat,
        s_orig.lng AS orig_lng,
        s_orig.description AS orig_desc,
        s_target.display_name AS target_display_name,
        s_target.lat AS target_lat,
        s_target.lng AS target_lng,
        s_target.description AS target_desc
      FROM logger_latest l
      -- Khớp chính xác Tuyệt đối 1-1: hardware_tag = 'tva_gs01:flow'
      LEFT JOIN logger_tag_mappings m ON 
        m.hardware_tag = CONCAT(l.logger_id, ':', l.tag_key)
        AND m.parameter_key = l.tag_key
      LEFT JOIN logger_stations s_orig ON s_orig.station_id = l.logger_id
      LEFT JOIN logger_stations s_target ON s_target.station_id = m.target_station_id;
    `;
    
    const result = await db.query(queryText);
    const groupedData = {};

    function ensureStationExists(stationId, rowData, isTarget = false) {
      if (!groupedData[stationId]) {
        groupedData[stationId] = {
          station_id: stationId,
          display_name: isTarget ? (rowData.target_display_name || stationId) : (rowData.orig_display_name || stationId),
          lat: isTarget ? (rowData.target_lat || null) : (rowData.orig_lat || null),
          lng: isTarget ? (rowData.target_lng || null) : (rowData.orig_lng || null),
          description: isTarget ? (rowData.target_desc || "") : (rowData.orig_desc || ""),
          source: stationId.split("_")[0] || "unknown",
          metrics: {}
        };
      }
    }

    result.rows.forEach((row) => {
      const { 
        original_logger_id, tag_key, data_ts, value, current_ts, target_station_id 
      } = row;

      const metricPayload = {
        parameter_key: tag_key,
        parameter_name: PARAMETER_NAME_MAP[tag_key] || tag_key,
        value: value,
        data_ts: data_ts,
        current_ts: current_ts
      };

      ensureStationExists(original_logger_id, row, false);
      groupedData[original_logger_id].metrics[tag_key] = metricPayload;

      if (target_station_id) {
        ensureStationExists(target_station_id, row, true);
        groupedData[target_station_id].metrics[tag_key] = {
          ...metricPayload,
          _mapped_from: original_logger_id 
        };
      }
    });

    return res.status(200).json({
      success: true,
      total_stations: Object.keys(groupedData).length,
      data: Object.values(groupedData)
    });
  } catch (error) {
    console.error("❌ [API] Lỗi:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}


/**
 * 🚀 API 3: Lấy dữ liệu lịch sử phục vụ vẽ biểu đồ (Chart) - ĐÃ FIX KHỚP BẢNG logger_readings
 * GET /api/logger/history?station_id=...&from_date=...&to_date=...
 */
async function getHistoryData(req, res) {
  const { station_id, from_date, to_date } = req.query;

  if (!station_id) {
    return res.status(400).json({ success: false, message: "Vui lòng cung cấp station_id (Mã trạm)." });
  }

  try {
    // 1. Lấy danh sách tag vật lý và tag ánh xạ thuộc về trạm này
    const mappingQuery = `
      SELECT DISTINCT 
        SPLIT_PART(hardware_tag, ':', 1) AS source_logger_id,
        parameter_key AS tag_key
      FROM logger_tag_mappings 
      WHERE target_station_id = $1
      UNION
      SELECT DISTINCT logger_id AS source_logger_id, tag_key 
      FROM logger_latest 
      WHERE logger_id = $1;
    `;
    const mappingResult = await db.query(mappingQuery, [station_id]);

    const chartData = {};
    if (mappingResult.rows.length === 0) {
      return res.status(200).json({ success: true, chart_data: {} });
    }

    // Khởi tạo khung mảng trống cho từng tag
    mappingResult.rows.forEach(r => {
      chartData[r.tag_key] = [];
    });

    // 2. Xây dựng điều kiện lọc theo Trạm nguồn và Tag tương ứng
    let whereClauses = [];
    let queryParams = [];
    let paramIndex = 1;

    mappingResult.rows.forEach(row => {
      whereClauses.push(`(logger_id = $${paramIndex} AND tag_key = $${paramIndex + 1})`);
      queryParams.push(row.source_logger_id, row.tag_key);
      paramIndex += 2;
    });

    // 🛠️ FIX CHÍNH: Đổi tên bảng thành 'logger_readings' theo cấu trúc thực tế của bạn
    // Nếu có truyền from_date/to_date thì lọc theo thời gian, nếu không truyền thì lấy 100 bản ghi mới nhất để vẽ chart
    let historyQueryText = "";
    
    if (from_date || to_date) {
      const startTs = from_date ? new Date(from_date) : new Date(Date.now() - 24 * 60 * 60 * 1000);
      const endTs = to_date ? new Date(to_date) : new Date();
      
      queryParams.unshift(startTs, endTs); // Đẩy vào đầu mảng param ($1, $2)
      
      // Dịch chuyển index của các tham số sau tăng lên 2 đơn vị
      whereClauses = whereClauses.map(clause => {
        return clause.replace(/\$(\d+)/g, (match, num) => `$${parseInt(num) + 2}`);
      });

      historyQueryText = `
        SELECT logger_id, tag_key, value, data_ts 
        FROM logger_readings 
        WHERE data_ts BETWEEN $1 AND $2 AND (${whereClauses.join(" OR ")})
        ORDER BY data_ts ASC;
      `;
    } else {
      // Trường hợp xem nhanh mặc định: Lấy 100 bản ghi lịch sử gần đây nhất của các tag thuộc trạm này
      historyQueryText = `
        SELECT logger_id, tag_key, value, data_ts 
        FROM logger_readings 
        WHERE ${whereClauses.join(" OR ")}
        ORDER BY data_ts DESC
        LIMIT 100;
      `;
    }

    const historyResult = await db.query(historyQueryText, queryParams);
    
    // Nếu lấy mặc định LIMIT, ta đảo ngược mảng lại cho đúng thứ tự thời gian tăng dần từ trái qua phải để vẽ Chart
    const rows = from_date || to_date ? historyResult.rows : historyResult.rows.reverse();

    rows.forEach(row => {
      if (chartData[row.tag_key]) {
        chartData[row.tag_key].push({
          x: row.data_ts,
          y: parseFloat(row.value)
        });
      }
    });

    return res.status(200).json({
      success: true,
      station_id: station_id,
      chart_data: chartData
    });

  } catch (error) {
    console.error("❌ [API Lịch sử] Lỗi:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * 🚀 API 4: Lấy dữ liệu tức thời và cấu hình dải đo phục vụ đồng hồ Gauge
 * GET /api/logger/gauge/:station_id
 */
async function getGaugeData(req, res) {
  const { station_id } = req.params;
  try {
    // 1. Gọi lại hàm gom nhóm logic có sẵn để lấy thông số metric mới nhất của trạm hiện tại
    // (Bao gồm cả tag gốc phần cứng lẫn tag ảo bốc từ trạm khác sang)
    const mockRes = {
      status: function() { return this; },
      json: function(data) { this.data = data; return this; }
    };
    
    await getLatestDataGrouped(req, mockRes);
    const stationData = mockRes.data?.data?.find(s => s.station_id === station_id);

    if (!stationData) {
      return res.status(404).json({ success: false, message: "Không tìm thấy dữ liệu tức thời của trạm này." });
    }

    // 2. Định nghĩa cấu hình giới hạn (Min/Max/Warning) cho từng loại thông số đo để hiển thị vòng Gauge
    // Bạn có thể tùy chỉnh dải thông số này hoặc lưu nó vào bảng cấu hình database riêng
    const GAUGE_CONFIGS = {
      level: { min: 0, max: 15, unit: "m", warning_high: 12 },
      flow: { min: 0, max: 500, unit: "m³/h", warning_high: 400 },
      totalIndex: { min: 0, max: 999999, unit: "m³", warning_high: null },
      ph: { min: 0, max: 14, unit: "pH", warning_low: 6, warning_high: 8.5 },
      tds: { min: 0, max: 2000, unit: "mg/L", warning_high: 1500 },
      amino: { min: 0, max: 100, unit: "ppm", warning_high: 80 }
    };

    const gaugeMetrics = {};
    Object.keys(stationData.metrics).forEach(tagKey => {
      const metric = stationData.metrics[tagKey];
      const config = GAUGE_CONFIGS[tagKey] || { min: 0, max: 100, unit: "", warning_high: null };

      gaugeMetrics[tagKey] = {
        parameter_name: metric.parameter_name,
        current_value: parseFloat(metric.value),
        data_ts: metric.data_ts,
        ...config // Gộp dải đo Min, Max, Đơn vị vào để UI tự tính tỷ lệ phần trăm xoay kim đồng hồ
      };
    });

    return res.status(200).json({
      success: true,
      station_id: station_id,
      display_name: stationData.display_name,
      gauges: gaugeMetrics
    });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
module.exports = {
  getLatestDataGrouped,
  getLatestDataRaw: async (req, res) => res.status(200).json({ success: true, note: "Sử dụng API grouped để xem cấu trúc chuẩn." }),
  getHistoryData,  
  getGaugeData     
};
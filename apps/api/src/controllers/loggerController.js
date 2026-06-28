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
      LEFT JOIN logger_tag_mappings m ON 
        m.source_logger_id = l.logger_id
        AND m.source_tag_key = l.tag_key
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
 * 🚀 API 3: Lấy dữ liệu lịch sử cho bảng dữ liệu TIMESTAMPTZ (+00) - FIX LỖI KHÔNG TRẢ VỀ DỮ LIỆU
 * GET /api/logger/history?station_id=...&from_date=...&to_date=...
 */
async function getHistoryData(req, res) {
  const { station_id, from_date, to_date } = req.query;

  if (!station_id) {
    return res.status(400).json({ success: false, message: "Vui lòng cung cấp station_id (Mã trạm)." });
  }

  try {
    // 1. Lấy danh sách toàn bộ các tag hiển thị thuộc trạm này
    const mappingQuery = `
      SELECT DISTINCT 
        source_logger_id AS search_logger_id,
        source_tag_key AS search_tag_key,
        source_tag_key AS client_tag_key
      FROM logger_tag_mappings 
      WHERE target_station_id = $1
      UNION
      SELECT DISTINCT 
        logger_id AS search_logger_id, 
        tag_key AS search_tag_key,
        tag_key AS client_tag_key
      FROM logger_latest 
      WHERE logger_id = $1;
    `;
    const mappingResult = await db.query(mappingQuery, [station_id]);

    const chartData = {};
    if (mappingResult.rows.length === 0) {
      return res.status(200).json({ success: true, chart_data: {} });
    }

    // Khởi tạo mảng trống cho client
    mappingResult.rows.forEach(r => {
      chartData[r.client_tag_key] = [];
    });

    // 2. Thiết lập tham số thời gian (Đưa về chuỗi timestamp thô, không kèm dấu múi giờ)
    let whereClauses = [];
    let queryParams = [];
    let paramIndex = 1;

    if (from_date || to_date) {
      // Ép về định dạng chuỗi thô YYYY-MM-DD HH:mm:ss
      const startTs = from_date ? from_date.replace("T", " ") : "1970-01-01 00:00:00";
      const endTs = to_date ? to_date.replace("T", " ") : "2030-12-31 23:59:59";
      
      queryParams.push(startTs, endTs); // $1 và $2
      paramIndex = 3;
    }

    mappingResult.rows.forEach(row => {
      whereClauses.push(`(logger_id = $${paramIndex} AND tag_key = $${paramIndex + 1})`);
      queryParams.push(row.search_logger_id, row.search_tag_key);
      paramIndex += 2;
    });

    let historyQueryText = "";
    
    if (from_date || to_date) {
      // Dùng (data_ts AT TIME ZONE 'UTC') để đưa mốc thời gian lưu trong DB về dạng thô (TIMESTAMP)
      // Điều này giúp loại bỏ hoàn toàn sự tự động quy đổi múi giờ của Postgres khi so sánh BETWEEN
      historyQueryText = `
        SELECT 
          logger_id, 
          tag_key, 
          value, 
          TO_CHAR(data_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as data_ts 
        FROM logger_readings 
        WHERE (data_ts AT TIME ZONE 'UTC') BETWEEN $1::timestamp AND $2::timestamp AND (${whereClauses.join(" OR ")})
        ORDER BY data_ts ASC;
      `;
    } else {
      historyQueryText = `
        SELECT 
          logger_id, 
          tag_key, 
          value, 
          TO_CHAR(data_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as data_ts 
        FROM logger_readings 
        WHERE ${whereClauses.join(" OR ")}
        ORDER BY data_ts DESC
        LIMIT 500;
      `;
    }

    const historyResult = await db.query(historyQueryText, queryParams);
    const rows = from_date || to_date ? historyResult.rows : historyResult.rows.reverse();

    // 3. Khớp nối dữ liệu đẩy về mảng chartData
    rows.forEach(row => {
      const matchConfig = mappingResult.rows.find(m => 
        m.search_logger_id === row.logger_id && m.search_tag_key === row.tag_key
      );

      if (matchConfig && chartData[matchConfig.client_tag_key]) {
        chartData[matchConfig.client_tag_key].push({
          x: row.data_ts, // Trả ra chuỗi "2026-06-28T15:35:00" khớp 100% giao diện
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

/**
 * 🚀 API NÂNG CẤP: Tính tổng lượng flow theo nhóm Giấy phép hỗ trợ tra cứu lịch sử linh hoạt
 * GET /api/analytics/flow-by-license?mode=default|by_day|by_month&date=YYYY-MM-DD&month=YYYY-MM
 */
async function getFlowAnalyticsByLicense(req, res) {
  const { mode, date, month } = req.query;
  const currentMode = mode || 'default';

  try {
    const LICENSE_PREFIXES = {
      "393/gp-bnnmt 22/09/2025": "monre_393",
      "391/gp-bnnmt 19/09/2025": "monre_391",
      "35/gp-btnmt 15/01/2025":  "monre_35",
      "36/gp-btnmt 15/01/2025":  "monre_36"
    };

    let queryText = "";
    let queryParams = [];
    let periodLabel = "Tổng quan chu kỳ hiện tại";

    // XÂY DỰNG SQL ĐỘNG THEO CHẾ ĐỘ XEM
    if (currentMode === 'by_day') {
      // 1. Chế độ xem theo 1 ngày lịch sử cụ thể
      const targetDay = date || new Date().toISOString().slice(0, 10);
      periodLabel = `Báo cáo chi tiết ngày: ${targetDay}`;
      queryParams.push(`${targetDay} 00:00:00 +07`, `${targetDay} 23:59:59 +07`);

      queryText = `
        SELECT logger_id, COALESCE(SUM(value), 0) AS total_value
        FROM logger_readings
        WHERE tag_key = 'flow' AND value IS NOT NULL 
          AND data_ts BETWEEN $1::timestamptz AND $2::timestamptz
        GROUP BY logger_id;
      `;
    } 
    else if (currentMode === 'by_month') {
      // 2. Chế độ xem theo 1 tháng lịch sử cụ thể
      const targetMonth = month || new Date().toISOString().slice(0, 7);
      periodLabel = `Báo cáo chi tiết tháng: ${targetMonth}`;
      
      const [year, mId] = targetMonth.split('-');
      const lastDay = new Date(year, mId, 0).getDate();
      
      queryParams.push(`${targetMonth}-01 00:00:00 +07`, `${targetMonth}-${lastDay} 23:59:59 +07`);

      queryText = `
        SELECT logger_id, COALESCE(SUM(value), 0) AS total_value
        FROM logger_readings
        WHERE tag_key = 'flow' AND value IS NOT NULL 
          AND data_ts BETWEEN $1::timestamptz AND $2::timestamptz
        GROUP BY logger_id;
      `;
    } 
    else {
      // 3. Chế độ mặc định: Thống kê tổ hợp 4 mốc (Hôm nay, Hôm qua, Tháng này, Tháng trước)
      queryText = `
        WITH local_readings AS (
          SELECT logger_id, value, (data_ts AT TIME ZONE 'Asia/Ho_Chi_Minh') AS local_ts
          FROM logger_readings WHERE tag_key = 'flow' AND value IS NOT NULL
        ),
        time_flags AS (
          SELECT logger_id, value,
            (DATE_TRUNC('day', local_ts) = DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')) AS is_today,
            (DATE_TRUNC('day', local_ts) = DATE_TRUNC('day', (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') - INTERVAL '1 day')) AS is_yesterday,
            (DATE_TRUNC('month', local_ts) = DATE_TRUNC('month', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')) AS is_this_month,
            (DATE_TRUNC('month', local_ts) = DATE_TRUNC('month', (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') - INTERVAL '1 month')) AS is_last_month
          FROM local_readings
        )
        SELECT logger_id,
          COALESCE(SUM(CASE WHEN is_today THEN value END), 0) AS total_today,
          COALESCE(SUM(CASE WHEN is_yesterday THEN value END), 0) AS total_yesterday,
          COALESCE(SUM(CASE WHEN is_this_month THEN value END), 0) AS total_this_month,
          COALESCE(SUM(CASE WHEN is_last_month THEN value END), 0) AS total_last_month
        FROM time_flags GROUP BY logger_id;
      `;
    }

    const result = await db.query(queryText, queryParams);
    
    // Khởi tạo cấu trúc lưu trữ dựa theo chế độ
    const reportStructure = {};
    Object.keys(LICENSE_PREFIXES).forEach(groupName => {
      reportStructure[groupName] = currentMode === 'default' 
        ? { today: 0, yesterday: 0, this_month: 0, last_month: 0, stations: [] }
        : { total_value: 0, stations: [] };
    });
    const fallbackKey = "Khác (Không thuộc nhóm trên)";
    reportStructure[fallbackKey] = currentMode === 'default'
      ? { today: 0, yesterday: 0, this_month: 0, last_month: 0, stations: [] }
      : { total_value: 0, stations: [] };

    // Phân nhóm gom cộng dồn dữ liệu từ DB
    result.rows.forEach(row => {
      let targetGroup = fallbackKey;
      for (const [groupName, prefix] of Object.entries(LICENSE_PREFIXES)) {
        if (row.logger_id.toLowerCase().startsWith(prefix.toLowerCase())) {
          targetGroup = groupName;
          break;
        }
      }

      if (currentMode === 'default') {
        reportStructure[targetGroup].today += parseFloat(row.total_today || 0);
        reportStructure[targetGroup].yesterday += parseFloat(row.total_yesterday || 0);
        reportStructure[targetGroup].this_month += parseFloat(row.total_this_month || 0);
        reportStructure[targetGroup].last_month += parseFloat(row.total_last_month || 0);
      } else {
        reportStructure[targetGroup].total_value += parseFloat(row.total_value || 0);
      }
      reportStructure[targetGroup].stations.push(row.logger_id);
    });

    // Làm tròn dữ liệu số
    Object.keys(reportStructure).forEach(g => {
      if (currentMode === 'default') {
        ['today', 'yesterday', 'this_month', 'last_month'].forEach(k => reportStructure[g][k] = Math.round(reportStructure[g][k] * 100) / 100);
      } else {
        reportStructure[g].total_value = Math.round(reportStructure[g].total_value * 100) / 100;
      }
    });

    return res.status(200).json({
      success: true,
      period_label: periodLabel,
      timestamp: new Date().toISOString(),
      analytics: reportStructure
    });

  } catch (error) {
    console.error("❌ [API Thống kê Phân tích] Lỗi:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}


module.exports = {
  getLatestDataGrouped,
  getLatestDataRaw: async (req, res) => res.status(200).json({ success: true, note: "Sử dụng API grouped để xem cấu trúc chuẩn." }),
  getHistoryData,  
  getGaugeData,
  getFlowAnalyticsByLicense     
};
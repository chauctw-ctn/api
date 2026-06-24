"use strict";

// 🛠️ Đọc file .env nằm ở thư mục fetch kề bên
require("dotenv").config({ path: "../fetch/.env" }); 

const express = require("express");
const cors = require("cors");
const router = require("./routes");

const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình Middleware
app.use(cors()); 
app.use(express.json()); 

// Gắn các tuyến API định nghĩa từ routes.js vào tiền tố /api
app.use("/api", router);

// Khởi chạy server lắng nghe cổng
app.listen(PORT, () => {
  console.log("====================================================================");
  console.log(`🚀 SERVER API ĐANG CHẠY ỔN ĐỊNH TRÊN CỔNG: ${PORT}`);
  console.log(`🔗 URL dữ liệu trạm (mới nhất): http://localhost:${PORT}/api/logger/latest/grouped`);
  console.log(`🔗 URL dữ liệu thô (mới nhất):  http://localhost:${PORT}/api/logger/latest/raw`);
  console.log("====================================================================");
});
// app.get("/", (req, res) => {
//   res.send(`
//     <!DOCTYPE html>
//     <html lang="vi">
//     <head>
//         <meta charset="UTF-8">
//         <title>Quản lý Ánh xạ Tag IoT</title>
//         <style>
//             body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background-color: #f0f2f5; padding: 30px; margin: 0; }
//             .grid-container { display: grid; grid-template-columns: 1fr 1fr; gap: 25px; max-width: 1200px; margin: 0 auto; }
//             .card { background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
//             h3 { color: #2c3e50; margin-top: 0; border-bottom: 2px solid #3498db; padding-bottom: 10px; margin-bottom: 20px; }
//             label { font-weight: bold; color: #34495e; display: block; margin-bottom: 8px; }
//             select, button { width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #cccccc; font-size: 14px; box-sizing: border-box; }
            
//             .btn-add { background-color: #2ecc71; color: white; border: none; font-weight: bold; cursor: pointer; margin-top: 15px; }
//             .btn-add:hover { background-color: #27ae60; }
//             .btn-delete { background-color: #e74c3c; color: white; border: none; font-weight: bold; cursor: pointer; margin-top: 15px; }
//             .btn-delete:hover { background-color: #c0392b; }

//             .tag-list-box { background: #f8f9fa; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; min-height: 180px; max-height: 300px; overflow-y: auto; margin-top: 10px; }
//             .tag-item { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; margin-bottom: 6px; background: white; border-radius: 4px; border: 1px solid #edf2f7; }
//             .tag-info { display: flex; align-items: center; gap: 10px; }
            
//             .badge { font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: bold; }
//             .badge-native { background: #e8f8f5; color: #117a65; }
//             .badge-mapped { background: #fef9e7; color: #b7950b; }
//             .origin-text { font-size: 11px; color: #7f8c8d; font-style: italic; margin-left: 5px; }
            
//             input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; }
//             .disabled-text { color: #a0aec0; text-align: center; padding-top: 70px; font-style: italic; }
//         </style>
//     </head>
//     <body>

//         <div class="grid-container">
//             <div class="card">
//                 <h3>📥 Trạm đích hiển thị</h3>
//                 <div style="margin-bottom: 15px;">
//                     <label>Chọn trạm cần cấu hình dữ liệu:</label>
//                     <select id="target_station_id" onchange="loadTargetStationTags()">
//                         <option value="">-- Tải danh sách trạm... --</option>
//                     </select>
//                 </div>
                
//                 <label>Danh sách các Tag hiện tại và nguồn trạm gốc:</label>
//                 <div id="target_tags_container" class="tag-list-box">
//                     <div class="disabled-text">Vui lòng chọn trạm đích để kiểm tra thẻ tag...</div>
//                 </div>
                
//                 <button id="btn_delete_mapped" class="btn-delete" onclick="deleteSelectedMappings()" style="display:none;">🗑️ Xóa các Tag ánh xạ đã chọn</button>
//             </div>

//             <div class="card">
//                 <h3>🔀 Chọn trạm nguồn cấp dữ liệu</h3>
//                 <div style="margin-bottom: 15px;">
//                     <label>Chọn trạm nguồn chứa dữ liệu gốc:</label>
//                     <select id="source_logger_id" onchange="loadSourceStationTags()">
//                         <option value="">-- Chọn trạm nguồn --</option>
//                     </select>
//                 </div>
                
//                 <label>Tích chọn các Tag gốc muốn sao chép sang:</label>
//                 <div id="source_tags_container" class="tag-list-box">
//                     <div class="disabled-text">Vui lòng chọn trạm nguồn để bóc tách tag...</div>
//                 </div>
                
//                 <button id="btn_add_mapped" class="btn-add" onclick="addSelectedTagsToTarget()" style="display:none;">⚡ Thêm tag vào trạm đích đã chọn</button>
//             </div>
//         </div>

//         <script>
//             let helpersCache = null;

//             window.onload = function() { fetchInitialHelpers(); };

//             async function fetchInitialHelpers() {
//                 const res = await fetch('/api/mappings/helpers');
//                 const json = await res.json();
//                 if(!json.success) return;
//                 helpersCache = json;

//                 // Giữ cấu hình trạm đích
//                 const tgtSel = document.getElementById('target_station_id');
//                 const currentTgt = tgtSel.value;
//                 tgtSel.innerHTML = '<option value="">-- Chọn trạm đích hiển thị --</option>';
//                 json.target_stations.forEach(s => {
//                     tgtSel.innerHTML += \`<option value="\${s.station_id}">\${s.display_name}</option>\`;
//                 });
//                 if(currentTgt) tgtSel.value = currentTgt;

//                 // 🛠️ FIX TẠI ĐÂY: Lưu lại trạm nguồn đang chọn trước khi render lại
//                 const srcSel = document.getElementById('source_logger_id');
//                 const currentSrc = srcSel.value; 
                
//                 srcSel.innerHTML = '<option value="">-- Chọn trạm nguồn --</option>';
//                 Object.keys(json.source_stations).forEach(id => {
//                     srcSel.innerHTML += \`<option value="\${id}">\${id}</option>\`;
//                 });
                
//                 // Nếu trước đó đang chọn một trạm nguồn cụ thể, gán lại giá trị để dropdown không bị nhảy về mặc định
//                 if(currentSrc) {
//                     srcSel.value = currentSrc;
//                 }
//             }

//             async function loadTargetStationTags() {
//                 const stationId = document.getElementById('target_station_id').value;
//                 const container = document.getElementById('target_tags_container');
//                 const deleteBtn = document.getElementById('btn_delete_mapped');
                
//                 if(!stationId) {
//                     container.innerHTML = '<div class="disabled-text">Vui lòng chọn trạm đích để kiểm tra thẻ tag...</div>';
//                     deleteBtn.style.display = 'none';
//                     return;
//                 }

//                 const res = await fetch('/api/mappings/station-tags/' + stationId);
//                 const json = await res.json();
//                 container.innerHTML = '';
//                 let hasMappedTag = false;

//                 if (json.tags.length === 0) {
//                     container.innerHTML = '<div class="disabled-text">Trạm chưa có dữ liệu chỉ số nào.</div>';
//                     deleteBtn.style.display = 'none';
//                     return;
//                 }

//                 json.tags.forEach(t => {
//                     if(!t.is_native) hasMappedTag = true;
//                     // 🛠️ CẢI TIẾN UI: Hiển thị kèm text nguồn gốc trạm lấy từ đâu sang
//                     const originLabel = t.is_native ? '' : \`<span class="origin-text">(Nguồn: \${t.origin_info})</span>\`;

//                     container.innerHTML += \`
//                         <div class="tag-item">
//                             <div class="tag-info">
//                                 <span class="badge \${t.is_native ? 'badge-native' : 'badge-mapped'}">
//                                     \${t.is_native ? '🔒 Gốc' : '🔀 Ánh xạ'}
//                                 </span>
//                                 <strong>\${t.tag_key}</strong>
//                                 \${originLabel}
//                             </div>
//                             <div>
//                                 \${t.is_native ? '' : \`<input type="checkbox" class="chk-target-delete" value="\${t.tag_key}">\`}
//                             </div>
//                         </div>
//                     \`;
//                 });
//                 deleteBtn.style.display = hasMappedTag ? 'block' : 'none';
//             }

//             function loadSourceStationTags() {
//                 const srcId = document.getElementById('source_logger_id').value;
//                 const container = document.getElementById('source_tags_container');
//                 const addBtn = document.getElementById('btn_add_mapped');

//                 if(!srcId || !helpersCache) {
//                     container.innerHTML = '<div class="disabled-text">Vui lòng chọn trạm nguồn để bóc tách tag...</div>';
//                     addBtn.style.display = 'none';
//                     return;
//                 }

//                 const nativeTags = helpersCache.source_stations[srcId] || [];
//                 container.innerHTML = '';
//                 nativeTags.forEach(tag => {
//                     container.innerHTML += \`
//                         <div class="tag-item">
//                             <div class="tag-info">
//                                 <span class="badge badge-native">🔒 Gốc</span>
//                                 <strong>\${tag}</strong>
//                             </div>
//                             <div>
//                                 <input type="checkbox" class="chk-source-add" value="\${tag}">
//                             </div>
//                         </div>
//                     \`;
//                 });
//                 addBtn.style.display = 'block';
//             }

//             async function addSelectedTagsToTarget() {
//                 const targetStationId = document.getElementById('target_station_id').value;
//                 const sourceLoggerId = document.getElementById('source_logger_id').value;
//                 const checkedBoxes = document.querySelectorAll('.chk-source-add:checked');
                
//                 if(!targetStationId || checkedBoxes.length === 0) {
//                     alert('Vui lòng chọn đủ trạm đích và tích tag nguồn!'); return;
//                 }

//                 for (let box of checkedBoxes) {
//                     await fetch('/api/mappings', {
//                         method: 'POST',
//                         headers: { 'Content-Type': 'application/json' },
//                         body: JSON.stringify({
//                             target_station_id: targetStationId,
//                             source_logger_id: sourceLoggerId,
//                             tag_key: box.value
//                         })
//                     });
//                 }
//                 alert('Ánh xạ thành công!');
//                 await fetchInitialHelpers();
//                 loadTargetStationTags();
//             }

//             async function deleteSelectedMappings() {
//                 const targetStationId = document.getElementById('target_station_id').value;
//                 const checkedBoxes = document.querySelectorAll('.chk-target-delete:checked');
//                 if(checkedBoxes.length === 0 || !confirm('Xóa gán các tag đã chọn?')) return;

//                 for (let box of checkedBoxes) {
//                     const tagKey = box.value;
//                     // Khớp chính xác cặp hardware_tag chứa tên trạm nguồn cụ thể
//                     const match = helpersCache.active_mappings.find(m => 
//                         m.target_station_id === targetStationId && m.parameter_key === tagKey
//                     );
//                     if(match) {
//                         await fetch('/api/mappings/' + match.id, { method: 'DELETE' });
//                     }
//                 }
//                 alert('Đã gỡ ánh xạ!');
//                 await fetchInitialHelpers();
//                 loadTargetStationTags();
//             }
//         </script>
//     </body>
//     </html>
//   `);
// });





// app.get("/", (req, res) => {
//   res.send(`
//     <!DOCTYPE html>
//     <html lang="vi">
//     <head>
//         <meta charset="UTF-8">
//         <title>Hệ thống Giám sát IoT Trung tâm</title>
//         <style>
//             body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; padding: 25px; margin: 0; color: #1e293b; }
//             .navbar { background: #1e293b; color: white; padding: 15px 30px; border-radius: 8px; margin-bottom: 25px; font-weight: bold; font-size: 18px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
//             .grid-main { display: grid; grid-template-columns: 350px 1fr; gap: 25px; max-width: 1400px; margin: 0 auto; }
//             .card { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.03); border: 1px solid #e2e8f0; }
//             h3 { color: #0f172a; margin-top: 0; border-bottom: 2px solid #3b82f6; padding-bottom: 8px; margin-bottom: 15px; font-size: 16px; }
//             label { font-weight: 600; font-size: 13px; color: #64748b; display: block; margin-bottom: 6px; }
//             select { width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 14px; margin-bottom: 15px; }
            
//             /* CSS Gauge UI */
//             .gauge-container { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 15px; margin-bottom: 25px; }
//             .gauge-box { background: #f1f5f9; padding: 15px; border-radius: 8px; text-align: center; border-top: 4px solid #3b82f6; }
//             .gauge-val { font-size: 24px; font-weight: bold; color: #1e3a8a; margin: 5px 0; }
//             .gauge-unit { font-size: 12px; color: #64748b; }
//             .progress-bar { background: #e2e8f0; height: 8px; border-radius: 4px; overflow: hidden; margin-top: 10px; }
//             .progress-fill { background: #3b82f6; height: 100%; width: 0%; transition: width 0.5s ease-out; }

//             /* CSS Chart Mockup */
//             .chart-box { background: #0f172a; color: #38bdf8; padding: 15px; border-radius: 8px; font-family: monospace; font-size: 12px; white-space: pre-wrap; max-height: 250px; overflow-y: auto; }
//             .api-link { display: inline-block; background: #e0f2fe; color: #0369a1; padding: 4px 8px; border-radius: 4px; font-size: 12px; text-decoration: none; font-weight: 600; margin-top: 5px; }
//             .api-link:hover { background: #bae6fd; }
//         </style>
//     </head>
//     <body>

//         <div class="navbar">📊 TRÌNH KIỂM TRA & GIÁM SÁT TRUNG TÂM API IOT</div>

//         <div class="grid-main">
//             <div class="card" style="height: fit-content;">
//                 <h3>📡 Chọn bộ lọc giám sát</h3>
//                 <label>Chọn Trạm để kích hoạt Chart & Gauge:</label>
//                 <select id="station_selector" onchange="triggerMonitorAPI()">
//                     <option value="">-- Đang nạp danh mục trạm... --</option>
//                 </select>
                
//                 <div style="margin-top: 20px;">
//                     <label>🔗 Các Endpoint Test nhanh:</label>
//                     <a href="/api/logger/latest/grouped" target="_blank" class="api-link">GET /api/logger/latest/grouped</a>
//                     <a href="/api/logger/latest/raw" target="_blank" class="api-link">GET /api/logger/latest/raw</a>
//                     <a href="/api/mappings/helpers" target="_blank" class="api-link">GET /api/mappings/helpers</a>
//                 </div>
//             </div>

//             <div style="display: flex; flex-direction: column; gap: 25px;">
//                 <div class="card">
//                     <h3 id="gauge_title">⏱️ Giá trị đo lường tức thời (API Gauge)</h3>
//                     <div id="gauge_wrapper" class="gauge-container">
//                         <div style="color: #64748b; font-style: italic;">Vui lòng chọn trạm ở cột bên trái để hiển thị mặt đồng hồ đo...</div>
//                     </div>
//                 </div>

//                 <div class="card">
//                     <h3 id="chart_title">📈 Chuỗi dữ liệu lịch sử vẽ biểu đồ (API History)</h3>
//                     <div id="chart_wrapper" class="chart-box">Chọn trạm để bóc tách luồng mảng tọa độ đồ thị [X, Y]...</div>
//                 </div>
//             </div>
//         </div>

//         <script>
//             // Tự động load danh sách trạm vào dropdown ngay khi bật trang
//             window.onload = async function() {
//                 try {
//                     const res = await fetch('/api/mappings/helpers');
//                     const json = await res.json();
//                     if(json.success) {
//                         const selector = document.getElementById('station_selector');
//                         selector.innerHTML = '<option value="">-- Chọn trạm muốn kiểm tra --</option>';
//                         json.target_stations.forEach(s => {
//                             selector.innerHTML += \`<option value="\value text=\${s.station_id}">\${s.display_name}</option>\`;
//                         });
//                     }
//                 } catch (e) { console.error("Lỗi tải danh mục trạm test API", e); }
//             };

//             // Kích hoạt gọi đồng thời 2 API mới (Gauge & History) khi người dùng chọn trạm
//             async function triggerMonitorAPI() {
//                 const selectElement = document.getElementById('station_selector');
//                 const stationId = selectElement.options[selectElement.selectedIndex].text; // Lấy mã station_id
                
//                 if(!stationId || stationId.startsWith('--')) return;

//                 // 1. GỌI API GAUGE DỮ LIỆU TỨC THỜI
//                 try {
//                     const resGauge = await fetch('/api/logger/gauge/' + stationId);
//                     const jsonGauge = await resGauge.json();
                    
//                     const wrapper = document.getElementById('gauge_wrapper');
//                     document.getElementById('gauge_title').innerText = '⏱️ Khối Gauge trực quan: ' + jsonGauge.display_name;
//                     wrapper.innerHTML = '';

//                     if(jsonGauge.success && Object.keys(jsonGauge.gauges).length > 0) {
//                         Object.keys(jsonGauge.gauges).forEach(tag => {
//                             const g = jsonGauge.gauges[tag];
//                             // Tính toán % để dịch thanh tiến trình hiển thị tỷ lệ
//                             const pct = Math.min(100, Math.max(0, ((g.current_value - g.min) / (g.max - g.min)) * 100));
                            
//                             wrapper.innerHTML += \`
//                                 <div class="gauge-box">
//                                     <div style="font-weight:600; font-size:14px; color:#334155;">\${g.parameter_name}</div>
//                                     <div class="gauge-val">\${g.current_value}</div>
//                                     <div class="gauge-unit">\${g.unit} (Dải đo: \${g.min} - \${g.max})</div>
//                                     <div class="progress-bar">
//                                         <div class="progress-fill" style="width: \${pct}%"></div>
//                                     </div>
//                                 </div>
//                             \`;
//                         });
//                     } else {
//                         wrapper.innerHTML = '<div style="color:#ef4444;">Trạm này chưa ghi nhận xung dữ liệu tức thời nào đổ về bảng logger_latest.</div>';
//                     }
//                 } catch(err) { console.error("Lỗi nạp API Gauge", err); }

//                 // 2. GỌI API HISTORY TUYẾN LỊCH SỬ VẼ CHART
//                 try {
//                     const resHist = await fetch('/api/logger/history?station_id=' + stationId);
//                     const jsonHist = await resHist.json();
                    
//                     const chartWrapper = document.getElementById('chart_wrapper');
//                     document.getElementById('chart_title').innerText = '📈 Log cấu trúc mảng Chart của trạm: ' + stationId;
                    
//                     if(jsonHist.success && Object.keys(jsonHist.chart_data).length > 0) {
//                         // Xuất định dạng JSON thô cực kỳ sạch sẽ lên màn hình để chứng minh API trả dữ liệu chuẩn đồ thị
//                         chartWrapper.innerHTML = JSON.stringify(jsonHist.chart_data, null, 2);
//                     } else {
//                         chartWrapper.innerHTML = '// Không có bản ghi lịch sử nào trong 24 giờ qua của trạm này tại bảng logger_history.';
//                     }
//                 } catch(err) { console.error("Lỗi nạp API Lịch sử", err); }
//             }
//         </script>
//     </body>
//     </html>
//   `);
// });



app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <title>Hệ thống Giám sát IoT Trung tâm</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
        
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; padding: 25px; margin: 0; color: #1e293b; }
            .navbar { background: #1e293b; color: white; padding: 15px 30px; border-radius: 8px; margin-bottom: 25px; font-weight: bold; font-size: 18px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
            .grid-main { display: grid; grid-template-columns: 350px 1fr; gap: 25px; max-width: 1500px; margin: 0 auto; }
            .card { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.03); border: 1px solid #e2e8f0; }
            h3 { color: #0f172a; margin-top: 0; border-bottom: 2px solid #3b82f6; padding-bottom: 8px; margin-bottom: 15px; font-size: 16px; }
            label { font-weight: 600; font-size: 13px; color: #64748b; display: block; margin-bottom: 6px; }
            select, input[type="datetime-local"], button { width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 14px; margin-bottom: 15px; box-sizing: border-box; }
            input:focus, select:focus { border-color: #3b82f6; outline: none; }
            
            button.btn-filter { background-color: #3b82f6; color: white; border: none; font-weight: bold; cursor: pointer; margin-top: 5px; transition: background 0.2s; }
            button.btn-filter:hover { background-color: #2563eb; }

            /* Filter Tag Checkbox */
            .tag-filter-box { background: #f1f5f9; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0; margin-bottom: 15px; max-height: 150px; overflow-y: auto; }
            .tag-checkbox-item { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 6px; font-weight: 500; }
            .tag-checkbox-item:last-child { margin-bottom: 0; }
            .tag-checkbox-item input { width: 16px; height: 16px; cursor: pointer; }

            /* Gauge & Chart UI */
            .gauge-container { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-bottom: 25px; }
            .gauge-box { background: #f8fafc; padding: 12px; border-radius: 8px; text-align: center; border: 1px solid #e2e8f0; border-top: 4px solid #3b82f6; }
            .gauge-val { font-size: 22px; font-weight: bold; color: #1e3a8a; margin: 4px 0; }
            .gauge-unit { font-size: 11px; color: #64748b; }
            .progress-bar { background: #e2e8f0; height: 6px; border-radius: 3px; overflow: hidden; margin-top: 8px; }
            .progress-fill { background: #3b82f6; height: 100%; width: 0%; transition: width 0.5s; }

            .chart-container { position: relative; height: 400px; width: 100%; margin-top: 10px; }
            .no-data-text { color: #64748b; text-align: center; padding-top: 150px; font-style: italic; }
        </style>
    </head>
    <body>

        <div class="navbar">📊 TRÌNH KIỂM TRA & GIÁM SÁT TRUNG TÂM API IOT</div>

        <div class="grid-main">
            <div class="card" style="height: fit-content;">
                <h3>🔍 Bộ lọc dữ liệu trạm</h3>
                
                <label>1. Chọn Trạm giám sát:</label>
                <select id="station_selector" onchange="onStationChange()">
                    <option value="">-- Đang nạp danh mục trạm... --</option>
                </select>

                <label>2. Thời gian bắt đầu (Từ):</label>
                <input type="datetime-local" id="from_date">

                <label>3. Thời gian kết thúc (Đến):</label>
                <input type="datetime-local" id="to_date">

                <label>4. Chọn các chỉ số (Lọc Tag hiển thị):</label>
                <div id="tag_checkbox_wrapper" class="tag-filter-box">
                    <div style="font-size: 12px; color: #94a3b8; font-style: italic;">Vui lòng chọn trạm trước...</div>
                </div>

                <button class="btn-filter" onclick="queryChartAndGaugeData()">⚡ Áp dụng bộ lọc đồ thị</button>
            </div>

            <div style="display: flex; flex-direction: column; gap: 25px;">
                <div class="card">
                    <h3 id="gauge_title">⏱️ Giá trị đo lường tức thời (API Gauge)</h3>
                    <div id="gauge_wrapper" class="gauge-container">
                        <div class="no-data-text" style="padding-top:20px;">Vui lòng chọn trạm hiển thị mặt đồng hồ đo...</div>
                    </div>
                </div>

                <div class="card">
                    <h3 id="chart_title">📈 Đồ thị diễn biến lịch sử dữ liệu (API History)</h3>
                    <div class="chart-container">
                        <canvas id="iotHistoryChart"></canvas>
                    </div>
                </div>
            </div>
        </div>

        <script>
            let helpersCache = null;
            let chartInstance = null; // Biến giữ khung đồ thị Chart.js toàn cục
            let currentChartRawData = null; // Lưu trữ dữ liệu lịch sử thô phục vụ lọc ẩn/hiện nhanh tag

            // Thiết lập khoảng thời gian mặc định trên Input (24h qua)
            window.onload = async function() {
                const now = new Date();
                const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
                
                document.getElementById('to_date').value = now.toISOString().slice(0, 16);
                document.getElementById('from_date').value = yesterday.toISOString().slice(0, 16);
                
                await fetchInitialHelpers();
                initEmptyChart(); // Tạo sẵn khung đồ thị trống
            };

            // Nạp danh mục trạm
            async function fetchInitialHelpers() {
                try {
                    const res = await fetch('/api/mappings/helpers');
                    const json = await res.json();
                    if(json.success) {
                        helpersCache = json;
                        const selector = document.getElementById('station_selector');
                        selector.innerHTML = '<option value="">-- Chọn trạm muốn kiểm tra --</option>';
                        json.target_stations.forEach(s => {
                            selector.innerHTML += \`<option value="\${s.station_id}">\${s.display_name}</option>\`;
                        });
                    }
                } catch (e) { console.error(e); }
            }

            // Khi người dùng đổi trạm -> Tự động load danh sách Checkbox Tag của trạm đó
            async function onStationChange() {
                const stationId = document.getElementById('station_selector').value;
                const checkboxWrapper = document.getElementById('tag_checkbox_wrapper');
                
                if(!stationId) {
                    checkboxWrapper.innerHTML = '<div style="font-size: 12px; color: #94a3b8; font-style: italic;">Vui lòng chọn trạm trước...</div>';
                    return;
                }

                try {
                    const res = await fetch('/api/mappings/station-tags/' + stationId);
                    const json = await res.json();
                    checkboxWrapper.innerHTML = '';
                    
                    if(json.tags && json.tags.length > 0) {
                        json.tags.forEach(t => {
                            checkboxWrapper.innerHTML += \`
                                <div class="tag-checkbox-item">
                                    <input type="checkbox" class="chk-tag-filter" value="\${t.tag_key}" checked onchange="renderChartDatasetsOnly()">
                                    <span>\${t.tag_key} \${t.is_native ? '' : '(Ánh xạ)'}</span>
                                </div>
                            \`;
                        });
                        // Tự động kích hoạt gọi API luôn lần đầu
                        queryChartAndGaugeData();
                    } else {
                        checkboxWrapper.innerHTML = '<div style="font-size: 12px; color: #ef4444;">Trạm không có cấu hình thẻ tag nào.</div>';
                    }
                } catch (e) { console.error(e); }
            }

            // Khởi tạo đồ thị Chart.js trống ban đầu
            function initEmptyChart() {
                const ctx = document.getElementById('iotHistoryChart').getContext('2d');
                chartInstance = new Chart(ctx, {
                    type: 'line',
                    data: { datasets: [] },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        scales: {
                            x: { type: 'time', time: { unit: 'hour', displayFormats: { hour: 'HH:mm dd/MM' } }, title: { display: true, text: 'Thời gian đo lường' } },
                            y: { beginAtZero: true, title: { display: true, text: 'Giá trị' } }
                        }
                    }
                });
            }

            // ⚡ TRUY VẤN ĐỒNG THỜI CẢ GAUGE VÀ HISTORY THEO BỘ LỌC
            async function queryChartAndGaugeData() {
                const stationId = document.getElementById('station_selector').value;
                if(!stationId) return;

                const fromDate = document.getElementById('from_date').value;
                const toDate = document.getElementById('to_date').value;

                // 1. Đồng bộ khối GAUGE tức thời
                try {
                    const resGauge = await fetch('/api/logger/gauge/' + stationId);
                    const jsonGauge = await resGauge.json();
                    const wrapper = document.getElementById('gauge_wrapper');
                    document.getElementById('gauge_title').innerText = '⏱️ Khối Gauge trực quan: ' + jsonGauge.display_name;
                    wrapper.innerHTML = '';

                    if(jsonGauge.success && Object.keys(jsonGauge.gauges).length > 0) {
                        Object.keys(jsonGauge.gauges).forEach(tag => {
                            const g = jsonGauge.gauges[tag];
                            const pct = Math.min(100, Math.max(0, ((g.current_value - g.min) / (g.max - g.min)) * 100));
                            wrapper.innerHTML += \`
                                <div class="gauge-box">
                                    <div style="font-weight:600; font-size:13px; color:#334155;">\${g.parameter_name}</div>
                                    <div class="gauge-val">\${g.current_value}</div>
                                    <div class="gauge-unit">\${g.unit} (\${g.min}-\\ \${g.max})</div>
                                    <div class="progress-bar"><div class="progress-fill" style="width: \${pct}%"></div></div>
                                </div>
                            \`;
                        });
                    } else {
                        wrapper.innerHTML = '<div class="no-data-text" style="padding-top:20px;">Không có dữ liệu tức thời.</div>';
                    }
                } catch(e) { console.error(e); }

                // 2. Đồng bộ khối ĐỒ THỊ HISTORY LỊCH SỬ
                try {
                    let url = \`/api/logger/history?station_id=\${stationId}\`;
                    if(fromDate) url += \`&from_date=\${new Date(fromDate).toISOString()}\`;
                    if(toDate) url += \`&to_date=\${new Date(toDate).toISOString()}\`;

                    const resHist = await fetch(url);
                    const jsonHist = await resHist.json();

                    if(jsonHist.success) {
                        currentChartRawData = jsonHist.chart_data; // Lưu dữ liệu gốc vào bộ nhớ cache
                        renderChartDatasetsOnly(); // Đổ dữ liệu vào đồ thị dựa trên bộ lọc checkbox tag
                    }
                } catch(e) { console.error(e); }
            }

            // BÓC TÁCH LUỒNG DỮ LIỆU ĐỔ VÀO CHART THEO CÁC CHECKBOX ĐANG ĐƯỢC TÍCH CHỌN
            function renderChartDatasetsOnly() {
                if(!currentChartRawData || !chartInstance) return;

                // Lấy mảng danh sách các tag đang ĐƯỢC TÍCH CHỌN trên UI
                const checkedTags = Array.from(document.querySelectorAll('.chk-tag-filter:checked')).map(cb => cb.value);
                const datasets = [];

                // Danh sách bảng màu sắc random tạo đường line rực rỡ cho từng tag
                const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];
                let colorIndex = 0;

                Object.keys(currentChartRawData).forEach(tagKey => {
                    // Nếu Tag này được tích chọn hiển thị -> Dựng cấu trúc Dataset cho Chart.js
                    if(checkedTags.includes(tagKey)) {
                        const rawPoints = currentChartRawData[tagKey] || [];
                        
                        // Đưa về định dạng Chart.js yêu cầu [{x: thời_gian, y: số}]
                        const chartPoints = rawPoints.map(p => ({
                            x: new Date(p.x),
                            y: p.y
                        }));

                        const currentColor = colors[colorIndex % colors.length];
                        colorIndex++;

                        datasets.push({
                            label: tagKey.toUpperCase(),
                            data: chartPoints,
                            borderColor: currentColor,
                            backgroundColor: currentColor + '15', // Đổ màu mờ mờ phía dưới chân line đường cong
                            borderWidth: 1,
                            tension: 0.2, // Độ cong mượt của đường line đồ thị
                            pointRadius: chartPoints.length > 50 ? 0 : 1 // Tự ẩn nốt tròn nếu dữ liệu quá dày để tránh rối mắt
                        });
                    }
                });

                // Đè dữ liệu mới vào Chart và ra lệnh Vẽ lại (Update) ngay lập tức
                chartInstance.data.datasets = datasets;
                chartInstance.update();
            }
        </script>
    </body>
    </html>
  `);
});
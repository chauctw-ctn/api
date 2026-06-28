// ── Cấu hình URL endpoint của Backend API ──────────────────────────────
const API_BASE_URL = window.location.origin;

let helpersCache = null;
let chartInstance = null;
let flowChartInstance = null; // Quản lý instance biểu đồ KPI Flow
let currentChartRawData = null;
let currentActiveTab = 'monitor';

// ── Khởi tạo & Cấu hình bộ lọc mặc định từ 00:00 hôm nay ──────────────────
window.onload = async function () {
    const now = new Date();
    
    const formatDate = (date) => {
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    };

    const formatTime = (date) => {
        const hh = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return `${hh}:${min}`;
    };

    const todayStr = formatDate(now);
    const currentTimeStr = formatTime(now);

    // Mặc định chu kỳ giám sát lịch sử đường line
    document.getElementById('from_date').value = `${todayStr}T00:00`;
    document.getElementById('to_date').value = `${todayStr}T${currentTimeStr}`;
    
    // Thiết lập mặc định ngày/tháng lịch sử cho phân hệ KPI Analytics
    document.getElementById('input_day').value = todayStr;
    document.getElementById('input_month').value = todayStr.slice(0, 7);

    await fetchInitialHelpers();
    initEmptyChart();
    updateStaticAPILinks();
};

// ── Hàm gán sự kiện click debug API (Tự động thích ứng môi trường) ──
function updateStaticAPILinks() {
    const BACKEND_URL = window.location.origin; 

    document.getElementById('lnk_api_helpers').onclick = function() {
        window.open(`${BACKEND_URL}/api/mappings/helpers`, '_blank');
    };
    document.getElementById('lnk_api_latest').onclick = function() {
        window.open(`${BACKEND_URL}/api/logger/latest/grouped`, '_blank');
    };
    document.getElementById('lnk_api_kpi').onclick = function() {
        window.open(`${BACKEND_URL}/api/analytics/flow-by-license`, '_blank');
    };
}

// ── Chuyển đổi các Tab trên cả Desktop và Mobile (Hỗ trợ 3 Tab) ──────────────────
function switchTab(tab) {
    currentActiveTab = tab;

    document.querySelectorAll('.tab-btn').forEach(b => {
        const text = b.textContent.trim();
        b.classList.toggle('active', 
            (tab === 'monitor' && text === 'Giám sát') || 
            (tab === 'mapping' && text === 'Ánh xạ') ||
            (tab === 'analytics' && text === 'Báo cáo KPI')
        );
    });

    const bm = document.getElementById('bnav-monitor');
    const ba = document.getElementById('bnav-mapping');
    const bn = document.getElementById('bnav-analytics');
    if (bm) bm.classList.toggle('active', tab === 'monitor');
    if (ba) ba.classList.toggle('active', tab === 'mapping');
    if (bn) bn.classList.toggle('active', tab === 'analytics');

    document.getElementById('panel-monitor').classList.toggle('active', tab === 'monitor');
    document.getElementById('panel-mapping').classList.toggle('active', tab === 'mapping');
    document.getElementById('panel-analytics').classList.toggle('active', tab === 'analytics');

    document.getElementById('sidebar-monitor').style.display = tab === 'monitor' ? '' : 'none';
    document.getElementById('sidebar-mapping').style.display = tab === 'mapping' ? '' : 'none';
    document.getElementById('sidebar-analytics').style.display = tab === 'analytics' ? '' : 'none';

    // Tự động tải dữ liệu khi nhảy vào tab Analytics báo cáo
    if (tab === 'analytics') {
        loadAnalyticsData();
    }
}

function mobileTab(tab) { switchTab(tab); }

// ── Tải dữ liệu danh sách Trạm nguồn & Trạm đích Ban đầu ────────────────
async function fetchInitialHelpers() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/mappings/helpers`);
        const json = await res.json();
        if (!json.success) return;
        helpersCache = json;

        const mainSel = document.getElementById('station_selector');
        const tgtSel  = document.getElementById('target_station_id');
        const savedMain = mainSel.value, savedTgt = tgtSel.value;

        mainSel.innerHTML = '<option value="">Chọn trạm giám sát...</option>';
        tgtSel.innerHTML  = '<option value="">Chọn trạm đích...</option>';
        
        json.target_stations.forEach(s => {
            const o = `<option value="${s.station_id}">${s.display_name}</option>`;
            mainSel.innerHTML += o; tgtSel.innerHTML += o;
        });
        if (savedMain) mainSel.value = savedMain;
        if (savedTgt)  tgtSel.value  = savedTgt;

        const srcSel = document.getElementById('source_logger_id');
        const savedSrc = srcSel.value;
        srcSel.innerHTML = '<option value="">Chọn trạm nguồn...</option>';
        Object.keys(json.source_stations).forEach(id => {
            srcSel.innerHTML += `<option value="${id}">${id}</option>`;
        });
        if (savedSrc) srcSel.value = savedSrc;
    } catch (e) { 
        console.error('Lỗi tải dữ liệu helper:', e); 
    }
}

// ── Tải danh sách Thẻ tag của Trạm đích (Mapping) ────────────────────
async function loadTargetStationTags() {
    const stationId = document.getElementById('target_station_id').value;
    const container = document.getElementById('target_tags_container');
    const deleteBtn = document.getElementById('btn_delete_mapped');
    if (!stationId) {
        container.innerHTML = '<div class="state-empty">Chọn trạm đích để kiểm tra thẻ tag</div>';
        deleteBtn.style.display = 'none'; return;
    }
    try {
        const res  = await fetch(`${API_BASE_URL}/api/mappings/station-tags/${stationId}`);
        const json = await res.json();
        container.innerHTML = '';
        let hasMapped = false;
        if (!json.tags || json.tags.length === 0) {
            container.innerHTML = '<div class="state-empty">Trạm chưa có thẻ tag nào</div>';
            deleteBtn.style.display = 'none'; return;
        }
        json.tags.forEach(t => {
            if (!t.is_native) hasMapped = true;
            const originLabel = t.is_native ? '' : `<span class="tag-origin">← ${t.origin_info}</span>`;
            container.innerHTML += `
                <div class="tag-row">
                    <div class="tag-row-left">
                        <span class="pill ${t.is_native ? 'pill-native' : 'pill-mapped'}">${t.is_native ? 'native' : 'mapped'}</span>
                        <span class="tag-key">${t.tag_key}</span>${originLabel}
                    </div>
                    ${t.is_native ? '' : `<input type="checkbox" class="chk-target-delete" value="${t.tag_key}">`}
                </div>`;
        });
        deleteBtn.style.display = hasMapped ? 'block' : 'none';
    } catch (e) { 
        console.error('Lỗi tải tags trạm đích:', e); 
    }
}

// ── Tải danh sách Thẻ tag của Trạm nguồn (Mapping) ────────────────────
function loadSourceStationTags() {
    const srcId     = document.getElementById('source_logger_id').value;
    const container = document.getElementById('source_tags_container');
    const addBtn    = document.getElementById('btn_add_mapped');
    if (!srcId || !helpersCache) {
        container.innerHTML = '<div class="state-empty">Chọn trạm nguồn để xem tag</div>';
        addBtn.style.display = 'none'; return;
    }
    const tags = helpersCache.source_stations[srcId] || [];
    container.innerHTML = '';
    if (tags.length === 0) {
        container.innerHTML = '<div class="state-empty">Không tìm thấy tag nào</div>';
        addBtn.style.display = 'none'; return;
    }
    tags.forEach(tag => {
        container.innerHTML += `
            <div class="tag-row">
                <div class="tag-row-left">
                    <span class="pill pill-native">native</span>
                    <span class="tag-key">${tag}</span>
                </div>
                <input type="checkbox" class="chk-source-add" value="${tag}">
            </div>`;
    });
    addBtn.style.display = 'block';
}

// ── Ánh xạ (Map) các Thẻ tag đã chọn từ nguồn sang đích ─────────────────
async function addSelectedTagsToTarget() {
    const targetId = document.getElementById('target_station_id').value;
    const sourceId = document.getElementById('source_logger_id').value;
    const checked  = document.querySelectorAll('.chk-source-add:checked');
    if (!targetId || checked.length === 0) { alert('Chọn trạm đích và ít nhất 1 tag nguồn.'); return; }
    try {
        for (const box of checked) {
            await fetch(`${API_BASE_URL}/api/mappings`, {
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target_station_id: targetId, source_logger_id: sourceId, tag_key: box.value })
            });
        }
        await fetchInitialHelpers(); 
        await loadTargetStationTags(); 
        loadSourceStationTags();
    } catch (e) { 
        console.error('Lỗi thêm ánh xạ:', e); 
    }
}

// ── Xóa các liên kết Ánh xạ đã được chọn ──────────────────────────────
async function deleteSelectedMappings() {
    const targetId = document.getElementById('target_station_id').value;
    const checked  = document.querySelectorAll('.chk-target-delete:checked');
    if (checked.length === 0 || !confirm(`Xóa ${checked.length} liên kết ánh xạ đã chọn?`)) return;
    try {
        for (const box of checked) {
            const match = helpersCache.active_mappings.find(m =>
                m.target_station_id === targetId && m.parameter_key === box.value
            );
            if (match) await fetch(`${API_BASE_URL}/api/mappings/${match.id}`, { method: 'DELETE' });
        }
        await fetchInitialHelpers(); 
        loadTargetStationTags();
    } catch (e) { 
        console.error('Lỗi xóa ánh xạ:', e); 
    }
}

// ── Thay đổi Trạm Giám sát (Cập nhật danh sách Checkbox Thẻ Tag + Link Debug) ──
async function onStationChange() {
    const stationId = document.getElementById('station_selector').value;
    const wrapper   = document.getElementById('tag_checkbox_wrapper');
    const lnkGauge  = document.getElementById('lnk_api_gauge');
    const lnkHistory = document.getElementById('lnk_api_history');
    
    if (!stationId) {
        wrapper.innerHTML = '<div class="state-empty">Chọn trạm để lọc tag</div>';
        lnkGauge.classList.add('disabled-link'); lnkGauge.onclick = null;
        lnkHistory.classList.add('disabled-link'); lnkHistory.onclick = null;
        document.querySelectorAll('.active-stn-id').forEach(el => el.textContent = '...');
        return;
    }
    
    lnkGauge.classList.remove('disabled-link');
    lnkGauge.onclick = function() {
        window.open(`${API_BASE_URL}/api/logger/gauge/${stationId}`, '_blank');
    };
    
    document.querySelectorAll('.active-stn-id').forEach(el => el.textContent = stationId);

    try {
        const res  = await fetch(`${API_BASE_URL}/api/mappings/station-tags/${stationId}`);
        const json = await res.json();
        wrapper.innerHTML = '';
        if (json.tags && json.tags.length > 0) {
            json.tags.forEach(t => {
                wrapper.innerHTML += `
                    <label class="check-item">
                        <input type="checkbox" class="chk-tag-filter" value="${t.tag_key}" checked onchange="renderChartDatasetsOnly()">
                        <span>${t.tag_key}${t.is_native ? '' : ' <em style="color:var(--amber);font-style:normal;">[M]</em>'}</span>
                    </label>`;
            });
            queryChartAndGaugeData();
        } else {
            wrapper.innerHTML = '<div class="state-empty" style="color:var(--red);">Trạm không có thẻ tag nào</div>';
        }
    } catch (e) { 
        console.error('Lỗi tải bộ lọc tag:', e); 
    }
}

// ── Khởi tạo Biểu đồ Rỗng (Chart.js Line) ───────────────────────────
function initEmptyChart() {
    const ctx = document.getElementById('iotHistoryChart').getContext('2d');
    Chart.defaults.color = '#8b949e';
    Chart.defaults.borderColor = '#30363d';
    chartInstance = new Chart(ctx, {
        type: 'line', 
        data: { datasets: [] },
        options: {
            responsive: true, 
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { font: { family: "'JetBrains Mono', monospace", size: 11 }, padding: 16, boxWidth: 10, boxHeight: 2 } },
                tooltip: {
                    backgroundColor: '#1c2128', borderColor: '#30363d', borderWidth: 1,
                    titleColor: '#e6edf3', bodyColor: '#8b949e',
                    titleFont: { family: "'JetBrains Mono', monospace", size: 11 },
                    bodyFont:  { family: "'JetBrains Mono', monospace", size: 11 },
                    padding: 10, cornerRadius: 8
                }
            },
            scales: {
                x: {
                    type: 'time', 
                    time: { unit: 'hour', displayFormats: { hour: 'HH:mm dd/MM' } },
                    grid: { color: '#21262d' },
                    ticks: { font: { family: "'JetBrains Mono', monospace", size: 10 }, maxTicksLimit: 8 }
                },
                y: {
                    beginAtZero: true, 
                    grid: { color: '#21262d' },
                    ticks: { font: { family: "'JetBrains Mono', monospace", size: 10 } }
                }
            }
        }
    });
}

// ── Lấy Dữ liệu Gauge (Thời gian thực) và Dữ liệu History (Biểu đồ) ──
async function queryChartAndGaugeData() {
    const stationId = document.getElementById('station_selector').value;
    if (!stationId) return;
    const fromDate = document.getElementById('from_date').value;
    const toDate   = document.getElementById('to_date').value;
    const dot      = document.getElementById('gauge_status_dot');
    
    const lnkHistory = document.getElementById('lnk_api_history');
    lnkHistory.classList.remove('disabled-link');
    
    lnkHistory.onclick = function() {
        window.open(`${API_BASE_URL}/api/logger/history?station_id=${stationId}&from_date=${fromDate}&to_date=${toDate}`, '_blank');
    };

    document.getElementById('gauge_card').classList.add('loading');
    document.getElementById('chart_card').classList.add('loading');
    dot.className = 'status-dot idle';

    try {
        const res  = await fetch(`${API_BASE_URL}/api/logger/gauge/${stationId}`);
        const json = await res.json();
        const wrap = document.getElementById('gauge_wrapper');
        document.getElementById('gauge_station_name').textContent = json.display_name || stationId;
        wrap.innerHTML = '';
        if (json.success && json.gauges && Object.keys(json.gauges).length > 0) {
            const colors = ['#2f81f7','#3fb950','#d29922','#f85149','#a371f7','#79c0ff','#56d364'];
            let ci = 0;
            Object.keys(json.gauges).forEach(tag => {
                const g = json.gauges[tag];
                const pct = g.max > g.min ? Math.min(100, Math.max(0, ((g.current_value - g.min) / (g.max - g.min)) * 100)) : 0;
                const color = colors[ci++ % colors.length];
                wrap.innerHTML += `
                    <div class="gauge-tile">
                        <div class="gauge-key">${tag}</div>
                        <div class="gauge-value" style="color:${color};">${g.current_value !== null ? g.current_value : '—'}</div>
                        <div class="gauge-unit">${g.unit || ''}</div>
                        <div class="gauge-range">${g.min} → ${g.max}</div>
                        <div class="gauge-bar"><div class="gauge-fill" style="width:${pct}%; background:${color};"></div></div>
                    </div>`;
            });
            dot.className = 'status-dot live';
        } else {
            wrap.innerHTML = '<div class="state-empty" style="grid-column:1/-1;">Không có dữ liệu tức thời</div>';
        }
    } catch (e) { 
        console.error('Lỗi render gauge:', e); 
    } finally { 
        document.getElementById('gauge_card').classList.remove('loading'); 
    }

    try {
        let url = `${API_BASE_URL}/api/logger/history?station_id=${stationId}`;
        if (fromDate) url += `&from_date=${fromDate}`;
        if (toDate)   url += `&to_date=${toDate}`;
        
        const res  = await fetch(url);
        const json = await res.json();
        
        if (fromDate && toDate) {
            const fDisp = fromDate.replace('T', ' ');
            const tDisp = toDate.replace('T', ' ');
            document.getElementById('chart_range_label').textContent = `${fDisp} → ${tDisp}`;
        }
        if (json.success && json.chart_data) { 
            currentChartRawData = json.chart_data; 
            renderChartDatasetsOnly(); 
        }
    } catch (e) { 
        console.error('Lỗi tải dữ liệu lịch sử từ logger_readings:', e); 
    } finally { 
        document.getElementById('chart_card').classList.remove('loading'); 
    }
}

function renderChartDatasetsOnly() {
    if (!currentChartRawData || !chartInstance) return;
    const checked  = Array.from(document.querySelectorAll('.chk-tag-filter:checked')).map(cb => cb.value);
    const palette  = ['#2f81f7','#3fb950','#d29922','#f85149','#a371f7','#79c0ff','#56d364'];
    const datasets = [];
    let ci = 0;
    
    Object.keys(currentChartRawData).forEach(key => {
        if (!checked.includes(key)) return;
        
        const pts = (currentChartRawData[key] || []).map(p => {
            let safeTimestamp;
            if (typeof p.x === 'string') {
                if (p.x.includes('Z') || p.x.includes('+')) {
                    safeTimestamp = new Date(p.x).getTime();
                } else {
                    safeTimestamp = new Date(`${p.x}+07:00`).getTime();
                }
            } else {
                safeTimestamp = new Date(p.x).getTime();
            }
            return { x: safeTimestamp, y: p.y };
        });
        
        const color = palette[ci++ % palette.length];
        datasets.push({
            label: key.toUpperCase(), 
            data: pts,
            borderColor: color, 
            backgroundColor: color + '18', 
            borderWidth: 1.5, 
            tension: 0.2, 
            pointRadius: pts.length > 80 ? 0 : 2, 
            pointHoverRadius: 4
        });
    });
    
    chartInstance.data.datasets = datasets;
    chartInstance.update();
}

// ══════════════════════════════════════════════════════════════════════════
// ── KHU VỰC PHÂN HỆ MỚI: CÁC HÀM XỬ LÝ LOGIC KPI ANALYTICS ─────────────────
// ══════════════════════════════════════════════════════════════════════════

function toggleReportMode() {
    const mode = document.getElementById('report_mode').value;
    document.getElementById('wrapper_day').style.display = mode === 'by_day' ? 'block' : 'none';
    document.getElementById('wrapper_month').style.display = mode === 'by_month' ? 'block' : 'none';
}

async function loadAnalyticsData() {
    const card = document.getElementById('chart_kpi_card');
    if (card) card.classList.add('loading');

    const mode = document.getElementById('report_mode').value;
    const selectedDay = document.getElementById('input_day').value;
    const selectedMonth = document.getElementById('input_month').value;

    let url = `${API_BASE_URL}/api/analytics/flow-by-license?mode=${mode}`;
    if (mode === 'by_day' && selectedDay) url += `&date=${selectedDay}`;
    if (mode === 'by_month' && selectedMonth) url += `&month=${selectedMonth}`;

    try {
        const res = await fetch(url);
        const json = await res.json();
        if (card) card.classList.remove('loading');
        
        if (!json.success || !json.analytics) return;

        document.getElementById('update_kpi_ts').textContent = `Mốc thời gian hiển thị: ${json.period_label}`;
        const labels = Object.keys(json.analytics);
        
        if (mode === 'default') {
            const dataToday = [], dataYesterday = [], dataThisMonth = [], dataLastMonth = [];
            labels.forEach(g => {
                dataToday.push(json.analytics[g].today);
                dataYesterday.push(json.analytics[g].yesterday);
                dataThisMonth.push(json.analytics[g].this_month);
                dataLastMonth.push(json.analytics[g].last_month);
            });
            renderGroupedChart(labels, dataToday, dataYesterday, dataThisMonth, dataLastMonth);
        } else {
            const dataValues = [];
            labels.forEach(g => dataValues.push(json.analytics[g].total_value));
            renderSingleChart(labels, dataValues, mode === 'by_day' ? 'Tổng lưu lượng ngày' : 'Tổng lưu lượng tháng');
        }
    } catch (e) {
        if (card) card.classList.remove('loading');
        console.error("Lỗi nạp dữ liệu KPI flow:", e);
    }
}

function renderGroupedChart(labels, today, yesterday, thisMonth, lastMonth) {
    const ctx = document.getElementById('licenseFlowChart').getContext('2d');
    if (flowChartInstance) flowChartInstance.destroy();

    flowChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'Hôm nay', data: today, backgroundColor: '#2f81f7', borderRadius: 4 },
                { label: 'Hôm qua', data: yesterday, backgroundColor: '#6e7681', borderRadius: 4 },
                { label: 'Tháng này', data: thisMonth, backgroundColor: '#3fb950', borderRadius: 4 },
                { label: 'Tháng trước', data: lastMonth, backgroundColor: '#76e388', borderRadius: 4 }
            ]
        },
        options: getCommonChartOptions()
    });
}

function renderSingleChart(labels, dataValues, datasetLabel) {
    const ctx = document.getElementById('licenseFlowChart').getContext('2d');
    if (flowChartInstance) flowChartInstance.destroy();

    flowChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: datasetLabel,
                data: dataValues,
                backgroundColor: '#2f81f7',
                borderRadius: 4,
                barThickness: 40
            }]
        },
        options: getCommonChartOptions()
    });
}

function getCommonChartOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { labels: { color: '#8b949e', font: { family: "'JetBrains Mono', monospace", size: 11 } } },
            tooltip: {
                backgroundColor: '#1c2128', borderColor: '#30363d', borderWidth: 1,
                titleColor: '#e6edf3', bodyColor: '#8b949e',
                callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw.toLocaleString('vi-VN')} m³` }
            }
        },
        scales: {
            x: { grid: { color: '#21262d' }, ticks: { color: '#8b949e', font: { size: 11 } } },
            y: { 
                beginAtZero: true, 
                grid: { color: '#21262d' }, 
                ticks: { 
                    color: '#8b949e', 
                    font: { family: "'JetBrains Mono', monospace", size: 10 }, 
                    callback: (val) => val.toLocaleString('vi-VN') + ' m³' 
                } 
            }
        }
    };
}

function exportReportData() {
    const mode = document.getElementById('report_mode').value;
    alert(`Đang khởi tạo tệp xuất báo cáo cho chế độ: [${mode}]`);
    window.print();
}
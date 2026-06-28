const API_BASE_URL = window.location.origin;
let flowChartInstance = null;

window.onload = function () {
    // Đặt mặc định ngày/tháng hiện hành vào ô input
    const now = new Date();
    document.getElementById('input_day').value = now.toISOString().slice(0, 10);
    document.getElementById('input_month').value = now.toISOString().slice(0, 7);
    
    loadAnalyticsData();
};

function toggleReportMode() {
    const mode = document.getElementById('report_mode').value;
    document.getElementById('wrapper_day').style.display = mode === 'by_day' ? 'block' : 'none';
    document.getElementById('wrapper_month').style.display = mode === 'by_month' ? 'block' : 'none';
}

async function loadAnalyticsData() {
    const card = document.getElementById('chart_card');
    card.classList.add('loading');

    const mode = document.getElementById('report_mode').value;
    const selectedDay = document.getElementById('input_day').value;
    const selectedMonth = document.getElementById('input_month').value;

    // Xây dựng Query Params gửi lên API dựa trên lựa chọn người dùng
    let url = `${API_BASE_URL}/api/analytics/flow-by-license?mode=${mode}`;
    if (mode === 'by_day' && selectedDay) url += `&date=${selectedDay}`;
    if (mode === 'by_month' && selectedMonth) url += `&month=${selectedMonth}`;

    try {
        const res = await fetch(url);
        const json = await res.json();
        card.classList.remove('loading');
        
        if (!json.success || !json.analytics) return;

        document.getElementById('update_ts').textContent = `Mốc thời gian hiển thị: ${json.period_label}`;

        const labels = Object.keys(json.analytics);
        
        // Tùy biến cách vẽ dựa trên chế độ xem tĩnh hoặc xem lịch sử cụ thể
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
            // Chế độ lịch sử đơn ngày hoặc đơn tháng: Chỉ có 1 mốc duy nhất cần hiển thị cột
            const dataValues = [];
            labels.forEach(g => dataValues.push(json.analytics[g].total_value));
            renderSingleChart(labels, dataValues, mode === 'by_day' ? 'Tổng lưu lượng ngày' : 'Tổng lưu lượng tháng');
        }
    } catch (e) {
        card.classList.remove('loading');
        console.error("Lỗi nạp dữ liệu KPI flow:", e);
    }
}

// 1. Vẽ đồ thị so sánh chu kỳ mặc định
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
        options: getCommonChartOptions() // 🟢 Đã fix: Thay dấu ";" thành dấu đóng ngoặc của đối tượng
    });
}

// 2. Vẽ đồ thị đơn cho lịch sử xem ngày/tháng được chọn
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
            legend: { labels: { color: '#8b949e', font: { family: "'JetBrains Mono', monospace", size: 12 } } },
            tooltip: {
                backgroundColor: '#1c2128', borderColor: '#30363d', borderWidth: 1,
                titleColor: '#e6edf3', bodyColor: '#8b949e',
                callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw.toLocaleString('vi-VN')} m³` }
            }
        },
        scales: {
            x: { grid: { color: '#21262d' }, ticks: { color: '#8b949e' } },
            y: { beginAtZero: true, grid: { color: '#21262d' }, ticks: { color: '#8b949e', callback: (val) => val.toLocaleString('vi-VN') + ' m³' } }
        }
    };
}

// Hàm giả lập xuất dữ liệu dạng file (Có thể in ấn hoặc lưu trữ)
function exportReportData() {
    const mode = document.getElementById('report_mode').value;
    alert(`Đang khởi tạo tệp báo cáo thống kê dạng Excel (.xlsx) cho chế độ [${mode === 'default' ? 'Tổng quan chu kỳ' : mode === 'by_day' ? 'Lịch sử ngày' : 'Lịch sử tháng'}]`);
    window.print(); // Kích hoạt lệnh in giao diện báo cáo sạch nhanh chóng
}
// ============================================
// Logistar Freight Management System - Dashboard Module
// Dashboard charts and analytics
// ============================================

// Local state for dashboard
let dashboardInitialized = false;

// ============================================
// Date Range Helpers
// ============================================

function getDashboardDateRange(fromDate, toDate) {
  let start = fromDate || null;
  let end = toDate || null;
  return { start, end };
}

function getDefaultDateRange() {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { start, end };
}

// ============================================
// API Calls
// ============================================

async function fetchDashboardCustomers() {
  const res = await fetch('/api/dashboard/customers');
  const data = await res.json();
  return data.customers || [];
}

async function fetchTMSCustomers() {
  const res = await fetch('/api/dashboard/tms_customers');
  const data = await res.json();
  return data.customers || [];
}

async function fetchDashboardData(endpoint, customer, fromDate, toDate) {
  const { start, end } = getDashboardDateRange(fromDate, toDate);
  const params = new URLSearchParams();
  if (customer && customer !== 'all') params.append('customer', customer);
  if (start) params.append('start_date', start);
  if (end) params.append('end_date', end);
  const url = `/api/dashboard/${endpoint}?${params.toString()}`;
  const res = await fetch(url);
  return res.json();
}

// ============================================
// Chart Rendering
// ============================================

function renderDashboardChart(chartId, type, labels, datasets, options = {}) {
  Core.destroyChart(chartId);
  const ctx = document.getElementById(chartId);
  if (!ctx) return;
  
  const chart = new Chart(ctx, {
    type,
    data: { labels, datasets },
    options: Object.assign({
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: true } }
    }, options)
  });
  
  AppState.chartInstances[chartId] = chart;
  return chart;
}

// ============================================
// Chart Updates
// ============================================

async function updateOrdersByDay() {
  const customerSelect = document.getElementById('orders-day-customer-filter');
  const fromDate = document.getElementById('orders-day-from-date').value;
  const toDate = document.getElementById('orders-day-to-date').value;
  const selectedCustomer = customerSelect ? customerSelect.value : 'all';
  
  const dayData = await fetchDashboardData('orders_by_day', selectedCustomer, fromDate, toDate);
  const rawData = dayData.orders_by_day || [];
  
  const allDates = [...new Set(rawData.map(r => r.date))].sort();
  const allCustomers = [...new Set(rawData.map(r => r.customer_name))];
  
  const dataMap = {};
  rawData.forEach(r => {
    const key = `${r.date}_${r.customer_name}`;
    dataMap[key] = r.count;
  });
  
  const colors = [
    'rgba(54, 162, 235, 1)',
    'rgba(255, 99, 132, 1)',
    'rgba(75, 192, 192, 1)',
    'rgba(255, 206, 86, 1)',
    'rgba(153, 102, 255, 1)',
    'rgba(255, 159, 64, 1)',
    'rgba(201, 203, 207, 1)'
  ];
  
  let datasets;
  if (selectedCustomer === 'all') {
    const totals = allDates.map(date => {
      let sum = 0;
      allCustomers.forEach(customerName => {
        const key = `${date}_${customerName}`;
        sum += dataMap[key] || 0;
      });
      return sum;
    });
    
    datasets = [{
      label: 'Total (All Customers)',
      data: totals,
      borderColor: 'rgba(0, 0, 0, 0.8)',
      backgroundColor: 'rgba(0, 0, 0, 0.1)',
      borderWidth: 2,
      fill: false,
      tension: 0.1,
      datalabels: {
        display: true,
        color: 'rgba(0, 0, 0, 0.8)',
        font: { weight: 'bold', size: 12 },
        align: 'top',
        anchor: 'end'
      }
    }];
    
    allCustomers.forEach((customerName, idx) => {
      const color = colors[idx % colors.length];
      datasets.push({
        label: customerName,
        data: allDates.map(date => {
          const key = `${date}_${customerName}`;
          return dataMap[key] || 0;
        }),
        borderColor: color,
        backgroundColor: color.replace('1)', '0.1)'),
        borderWidth: 2,
        fill: false,
        tension: 0.1,
        datalabels: { display: false }
      });
    });
  } else {
    datasets = allCustomers.map((customerName, idx) => {
      const color = colors[idx % colors.length];
      return {
        label: customerName,
        data: allDates.map(date => {
          const key = `${date}_${customerName}`;
          return dataMap[key] || 0;
        }),
        borderColor: color,
        backgroundColor: color.replace('1)', '0.1)'),
        borderWidth: 2,
        fill: false,
        tension: 0.1,
        datalabels: {
          display: true,
          color: color,
          font: { weight: 'bold', size: 11 },
          align: 'top',
          anchor: 'end'
        }
      };
    });
  }
  
  renderDashboardChart('orders-by-day-chart', 'line', allDates, datasets, {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { right: 30 } },
    plugins: { legend: { display: true, position: 'top' } },
    scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
  });
}

async function updateOtherDashboardCharts() {
  const customer = document.getElementById('dashboard-customer-filter')?.value || 'all';
  const fromDate = document.getElementById('dashboard-from-date')?.value;
  const toDate = document.getElementById('dashboard-to-date')?.value;

  // Orders by Weight
  const weightData = await fetchDashboardData('orders_by_weight', customer, fromDate, toDate);
  const weightLabels = (weightData.orders_by_weight || []).map(r => r.weight);
  const weightCounts = (weightData.orders_by_weight || []).map(r => r.count);
  renderDashboardChart('dashboard-weight-chart', 'bar', weightLabels, [{
    label: 'Orders',
    data: weightCounts,
    backgroundColor: 'rgba(255, 206, 86, 0.8)',
    borderColor: 'rgba(255, 206, 86, 1)',
    borderWidth: 1
  }], {
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
  });

  // Orders by Zone
  const zoneData = await fetchDashboardData('orders_by_zone', customer, fromDate, toDate);
  const zoneLabels = (zoneData.orders_by_zone || []).map(r => r.zone);
  const zoneCounts = (zoneData.orders_by_zone || []).map(r => r.count);
  renderDashboardChart('dashboard-zone-chart', 'bar', zoneLabels, [{
    label: 'Orders',
    data: zoneCounts,
    backgroundColor: 'rgba(153, 102, 255, 0.8)',
    borderColor: 'rgba(153, 102, 255, 1)',
    borderWidth: 1
  }], {
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
  });

  // Surcharge Category Count & Amount
  const surchargeData = await fetchDashboardData('surcharge_stats', customer, fromDate, toDate);
  const surchargeLabels = (surchargeData.surcharge_stats || []).map(r => r.type);
  const surchargeCounts = (surchargeData.surcharge_stats || []).map(r => r.count);
  const surchargeAmounts = (surchargeData.surcharge_stats || []).map(r => r.amount);
  renderDashboardChart('dashboard-surcharge-chart', 'bar', surchargeLabels, [
    {
      label: 'Count',
      data: surchargeCounts,
      backgroundColor: 'rgba(255, 159, 64, 0.8)',
      borderColor: 'rgba(255, 159, 64, 1)',
      borderWidth: 1
    },
    {
      label: 'Total Amount',
      data: surchargeAmounts,
      backgroundColor: 'rgba(54, 162, 235, 0.4)',
      borderColor: 'rgba(54, 162, 235, 1)',
      borderWidth: 1,
      type: 'line',
      yAxisID: 'y1'
    }
  ], {
    plugins: { legend: { display: true } },
    scales: {
      y: { beginAtZero: true, position: 'left', title: { display: true, text: 'Count' } },
      y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Amount ($)' } }
    }
  });

  // Total Adjustment Amount by Customer
  const adjData = await fetchDashboardData('adjustment_stats', customer, fromDate, toDate);
  const adjStats = adjData.adjustment_stats || [];
  const adjCustomers = adjStats.map(r => r.customer);
  const adjAmounts = adjStats.map(r => r.total);
  renderDashboardChart('dashboard-adjustment-chart', 'bar', adjCustomers, [{
    label: 'Total Adjustment ($)',
    data: adjAmounts,
    backgroundColor: 'rgba(75, 192, 192, 0.8)',
    borderColor: 'rgba(75, 192, 192, 1)',
    borderWidth: 1
  }], {
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true } }
  });
}

// ============================================
// Dashboard Initialization
// ============================================

async function initDashboard() {
  if (dashboardInitialized) {
    // Just refresh data on subsequent visits
    updateOrdersByDay();
    updateOtherDashboardCharts();
    return;
  }
  
  // Populate customer filters
  const customerSelect = document.getElementById('dashboard-customer-filter');
  const ordersDayCustomerSelect = document.getElementById('orders-day-customer-filter');
  
  const customers = await fetchDashboardCustomers();
  const customerOptions = '<option value="all">All</option>' +
    customers.map(c => `<option value="${Core.escapeHtml(c)}">${Core.escapeHtml(c)}</option>`).join('');
  
  if (customerSelect) customerSelect.innerHTML = customerOptions;
  
  // Populate TMS customers for Orders by Day
  const tmsCustomers = await fetchTMSCustomers();
  const tmsCustomerOptions = '<option value="all">All</option>' +
    tmsCustomers.map(c => `<option value="${Core.escapeHtml(c)}">${Core.escapeHtml(c)}</option>`).join('');
  if (ordersDayCustomerSelect) ordersDayCustomerSelect.innerHTML = tmsCustomerOptions;

  // Set default date ranges
  const { start, end } = getDefaultDateRange();
  const dashboardFromDate = document.getElementById('dashboard-from-date');
  const dashboardToDate = document.getElementById('dashboard-to-date');
  const ordersDayFromDate = document.getElementById('orders-day-from-date');
  const ordersDayToDate = document.getElementById('orders-day-to-date');
  
  if (dashboardFromDate) dashboardFromDate.value = start;
  if (dashboardToDate) dashboardToDate.value = end;
  if (ordersDayFromDate) ordersDayFromDate.value = start;
  if (ordersDayToDate) ordersDayToDate.value = end;

  // Event listeners
  if (customerSelect) customerSelect.addEventListener('change', updateOtherDashboardCharts);
  Core.safeAddEventListener('dashboard-apply-btn', 'click', updateOtherDashboardCharts);
  
  if (ordersDayCustomerSelect) ordersDayCustomerSelect.addEventListener('change', updateOrdersByDay);
  Core.safeAddEventListener('orders-day-apply-btn', 'click', updateOrdersByDay);

  // Initial load
  await updateOrdersByDay();
  await updateOtherDashboardCharts();
  
  dashboardInitialized = true;
}

// Export for global access
window.Dashboard = {
  init: initDashboard,
  updateOrdersByDay,
  updateOtherDashboardCharts
};

// Alias for navigation
window.initDashboard = initDashboard;

// ============================================
// Logistar Freight Management System - Supplier Operations Module
// Zone Charts, Product Mapping, Supplier Dashboard & Cost Verification
// ============================================

// ============================================
// Local Helpers (self-contained, no Core dependency)
// ============================================

function _escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function _showToast(message, type = 'info', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 10000; display: flex; flex-direction: column; gap: 8px;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  const colors = { success: '#22c55e', error: '#ef4444', info: '#3b82f6' };
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  toast.style.cssText = `display: flex; align-items: center; gap: 8px; padding: 12px 20px; border-radius: 8px; color: #fff; font-size: 14px; background: ${colors[type] || colors.info}; box-shadow: 0 4px 12px rgba(0,0,0,0.15); opacity: 0; transform: translateX(40px); transition: all 0.3s ease;`;
  toast.innerHTML = `<span>${icons[type] || icons.info}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(0)'; }, 10);
  setTimeout(() => {
    toast.style.opacity = '0'; toast.style.transform = 'translateX(40px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Local chart instance tracking for supplier module
let _supplierChartInstances = {};

function _destroyChart(chartId) {
  if (_supplierChartInstances[chartId]) {
    _supplierChartInstances[chartId].destroy();
    delete _supplierChartInstances[chartId];
  }
}

// ============================================
// Zone Chart Management
// ============================================

let zoneChartsData = { zone_charts: [], product_mapping: {} };
let currentZoneChart = null;

async function loadZoneChartsData() {
  try {
    const res = await fetch('/api/zone-charts');
    zoneChartsData = await res.json();
    if (!zoneChartsData.zone_charts) zoneChartsData.zone_charts = [];
    if (!zoneChartsData.product_mapping) zoneChartsData.product_mapping = {};
  } catch (e) {
    console.error('Failed to load zone charts:', e);
    zoneChartsData = { zone_charts: [], product_mapping: {} };
  }
  return zoneChartsData;
}

async function saveZoneChartsData() {
  try {
    const res = await fetch('/api/zone-charts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(zoneChartsData)
    });
    const result = await res.json();
    if (result.success) {
      _showToast('保存成功', 'success');
    } else {
      _showToast('保存失败: ' + (result.error || ''), 'error');
    }
    return result.success;
  } catch (e) {
    _showToast('保存失败: ' + e.message, 'error');
    return false;
  }
}

function findZoneChart(carrier, shipFromZip) {
  return zoneChartsData.zone_charts.find(
    c => c.carrier === carrier && c.ship_from_zip === shipFromZip
  );
}

function renderZoneChartTable(chart) {
  const tbody = document.getElementById('zone-chart-tbody');
  if (!tbody) return;

  if (!chart || !chart.entries || chart.entries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 30px; color: #999;">暂无数据，点击"添加行"或"从剪贴板粘贴"添加</td></tr>';
    document.getElementById('zone-chart-count').textContent = '0 条记录';
    return;
  }

  tbody.innerHTML = chart.entries.map((entry, idx) => `
    <tr>
      <td style="padding: 6px; border: 1px solid #e5e7eb; text-align: center;">
        <input type="text" value="${_escapeHtml(entry.start_zip || '')}" data-idx="${idx}" data-field="start_zip"
          style="width: 100px; padding: 4px 8px; text-align: center; border: 1px solid #d1d5db; border-radius: 4px;" maxlength="3">
      </td>
      <td style="padding: 6px; border: 1px solid #e5e7eb; text-align: center;">
        <input type="text" value="${_escapeHtml(entry.end_zip || '')}" data-idx="${idx}" data-field="end_zip"
          style="width: 100px; padding: 4px 8px; text-align: center; border: 1px solid #d1d5db; border-radius: 4px;" maxlength="3">
      </td>
      <td style="padding: 6px; border: 1px solid #e5e7eb; text-align: center;">
        <input type="text" value="${_escapeHtml(entry.zone || '')}" data-idx="${idx}" data-field="zone"
          style="width: 80px; padding: 4px 8px; text-align: center; border: 1px solid #d1d5db; border-radius: 4px;">
      </td>
      <td style="padding: 6px; border: 1px solid #e5e7eb; text-align: center;">
        <button onclick="removeZoneChartRow(${idx})" style="background: #fee2e2; color: #dc2626; border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 12px;">✕</button>
      </td>
    </tr>
  `).join('');

  document.getElementById('zone-chart-count').textContent = `${chart.entries.length} 条记录`;

  // Add input event listeners for live editing
  tbody.querySelectorAll('input').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.idx);
      const field = input.dataset.field;
      if (currentZoneChart && currentZoneChart.entries[idx]) {
        currentZoneChart.entries[idx][field] = input.value.trim();
      }
    });
  });
}

window.removeZoneChartRow = function(idx) {
  if (currentZoneChart && currentZoneChart.entries) {
    currentZoneChart.entries.splice(idx, 1);
    renderZoneChartTable(currentZoneChart);
  }
};

function addZoneChartRow() {
  if (!currentZoneChart) return;
  if (!currentZoneChart.entries) currentZoneChart.entries = [];
  currentZoneChart.entries.push({ start_zip: '', end_zip: '', zone: '' });
  renderZoneChartTable(currentZoneChart);
  // Scroll to bottom
  const container = document.querySelector('#zone-chart-editor .data-table')?.parentElement;
  if (container) container.scrollTop = container.scrollHeight;
}

async function pasteZoneChartFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      _showToast('剪贴板为空', 'error');
      return;
    }

    const lines = text.trim().split('\n');
    const entries = [];
    for (const line of lines) {
      const parts = line.split('\t').map(s => s.trim());
      if (parts.length >= 3) {
        entries.push({
          start_zip: parts[0],
          end_zip: parts[1],
          zone: parts[2]
        });
      } else if (parts.length === 2) {
        // Maybe start_zip and zone only (single zip = zone)
        entries.push({
          start_zip: parts[0],
          end_zip: parts[0],
          zone: parts[1]
        });
      }
    }

    if (entries.length === 0) {
      _showToast('未能解析有效数据，请确保每行至少有：起始邮编\t结束邮编\tZone', 'error');
      return;
    }

    if (!currentZoneChart) return;
    
    // Ask whether to replace or append
    const replace = confirm(`解析到 ${entries.length} 条记录。\n\n点击"确定"替换现有数据，点击"取消"追加到现有数据后面。`);
    if (replace) {
      currentZoneChart.entries = entries;
    } else {
      currentZoneChart.entries = (currentZoneChart.entries || []).concat(entries);
    }

    renderZoneChartTable(currentZoneChart);
    _showToast(`已添加 ${entries.length} 条分区记录`, 'success');
  } catch (e) {
    _showToast('无法读取剪贴板: ' + e.message, 'error');
  }
}

function initZoneCharts() {
  const loadBtn = document.getElementById('zone-chart-load-btn');
  const addFromBtn = document.getElementById('zone-chart-add-from-btn');
  const deleteBtn = document.getElementById('zone-chart-delete-btn');
  const addRowBtn = document.getElementById('zone-chart-add-row');
  const pasteBtn = document.getElementById('zone-chart-paste-btn');
  const saveBtn = document.getElementById('zone-chart-save-btn');

  if (!loadBtn) return;

  loadZoneChartsData();

  loadBtn.addEventListener('click', () => {
    const carrier = document.getElementById('zone-chart-carrier').value;
    const shipFrom = document.getElementById('zone-chart-ship-from').value;
    if (!carrier || !shipFrom) {
      _showToast('请选择承运商和发货邮编', 'error');
      return;
    }
    const chart = findZoneChart(carrier, shipFrom);
    if (chart) {
      currentZoneChart = chart;
      document.getElementById('zone-chart-editor').style.display = 'block';
      document.getElementById('zone-chart-title').textContent = `分区表: ${carrier} - ${shipFrom}`;
      renderZoneChartTable(chart);
    } else {
      _showToast(`未找到 ${carrier} / ${shipFrom} 的分区表，请点击"新建分区表"创建`, 'error');
      document.getElementById('zone-chart-editor').style.display = 'none';
      currentZoneChart = null;
    }
  });

  addFromBtn.addEventListener('click', () => {
    const carrier = document.getElementById('zone-chart-carrier').value;
    const shipFrom = document.getElementById('zone-chart-ship-from').value;
    if (!carrier || !shipFrom) {
      _showToast('请先选择承运商和发货邮编', 'error');
      return;
    }
    const existing = findZoneChart(carrier, shipFrom);
    if (existing) {
      _showToast('该分区表已存在，请直接加载编辑', 'error');
      return;
    }
    const newChart = { carrier, ship_from_zip: shipFrom, entries: [] };
    zoneChartsData.zone_charts.push(newChart);
    currentZoneChart = newChart;
    document.getElementById('zone-chart-editor').style.display = 'block';
    document.getElementById('zone-chart-title').textContent = `分区表: ${carrier} - ${shipFrom} (新建)`;
    renderZoneChartTable(newChart);
    _showToast('已创建新分区表，请添加数据后保存', 'success');
  });

  deleteBtn.addEventListener('click', () => {
    const carrier = document.getElementById('zone-chart-carrier').value;
    const shipFrom = document.getElementById('zone-chart-ship-from').value;
    if (!carrier || !shipFrom) {
      _showToast('请选择承运商和发货邮编', 'error');
      return;
    }
    const idx = zoneChartsData.zone_charts.findIndex(
      c => c.carrier === carrier && c.ship_from_zip === shipFrom
    );
    if (idx === -1) {
      _showToast('未找到该分区表', 'error');
      return;
    }
    if (!confirm(`确定要删除 ${carrier} / ${shipFrom} 的分区表吗？`)) return;
    zoneChartsData.zone_charts.splice(idx, 1);
    currentZoneChart = null;
    document.getElementById('zone-chart-editor').style.display = 'none';
    saveZoneChartsData();
  });

  if (addRowBtn) addRowBtn.addEventListener('click', addZoneChartRow);
  if (pasteBtn) pasteBtn.addEventListener('click', pasteZoneChartFromClipboard);

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      // Sync current inputs to data
      if (currentZoneChart) {
        const tbody = document.getElementById('zone-chart-tbody');
        tbody.querySelectorAll('input').forEach(input => {
          const idx = parseInt(input.dataset.idx);
          const field = input.dataset.field;
          if (currentZoneChart.entries[idx]) {
            currentZoneChart.entries[idx][field] = input.value.trim();
          }
        });
      }
      await saveZoneChartsData();
    });
  }
}


// ============================================
// Product Mapping Management
// ============================================

let supplierList = [];

async function loadProductMappingData() {
  // Load zone charts data (includes product_mapping)
  await loadZoneChartsData();
  
  // Load supplier names from supplier data
  try {
    const res = await fetch('/api/suppliers');
    const data = await res.json();
    supplierList = (data.suppliers || []).map(s => ({
      name: s.name,
      category: s.category
    }));
  } catch (e) {
    console.error('Failed to load suppliers:', e);
    supplierList = [];
  }
  
  // Load product names from TMS
  try {
    const res = await fetch('/api/supplier-dashboard/product-names');
    const data = await res.json();
    return data.product_names || [];
  } catch (e) {
    console.error('Failed to load product names:', e);
    return [];
  }
}

function renderProductMappingTable(productNames) {
  const tbody = document.getElementById('product-mapping-tbody');
  if (!tbody) return;

  const mapping = zoneChartsData.product_mapping || {};
  const carrierOptions = ['FedEx', 'FedExAHS', 'FedExOS', 'UPS', 'USPS', 'GOFO', 'SmartPost', 'UNIUNI'];
  const serviceTypes = [
    { value: 'hd', label: 'Home Delivery' },
    { value: 'ground', label: 'Ground' }
  ];
  const warehouseZips = ['08901', '91761', '92376', '92835'];

  tbody.innerHTML = productNames.map(pn => {
    const m = mapping[pn] || {};
    const selectedCarrier = m.carrier || '';
    const selectedSupplier = m.supplier || '';
    const selectedService = m.service_type || 'hd';
    const defaultShipFrom = m.default_ship_from || '';

    // Filter suppliers by selected carrier
    const filteredSuppliers = selectedCarrier 
      ? supplierList.filter(s => s.category === selectedCarrier)
      : supplierList;

    return `
      <tr>
        <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 600;">${_escapeHtml(pn)}</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: center;">
          <select data-product="${_escapeHtml(pn)}" data-field="carrier" class="pm-carrier-select"
            style="padding: 6px; border: 1px solid #d1d5db; border-radius: 4px; width: 140px;">
            <option value="">--</option>
            ${carrierOptions.map(c => `<option value="${c}" ${selectedCarrier === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </td>
        <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: center;">
          <select data-product="${_escapeHtml(pn)}" data-field="supplier" class="pm-supplier-select"
            style="padding: 6px; border: 1px solid #d1d5db; border-radius: 4px; width: 200px;">
            <option value="">--</option>
            ${filteredSuppliers.map(s => `<option value="${s.name}" ${selectedSupplier === s.name ? 'selected' : ''}>${s.name}</option>`).join('')}
          </select>
        </td>
        <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: center;">
          <select data-product="${_escapeHtml(pn)}" data-field="service_type"
            style="padding: 6px; border: 1px solid #d1d5db; border-radius: 4px; width: 130px;">
            ${serviceTypes.map(st => `<option value="${st.value}" ${selectedService === st.value ? 'selected' : ''}>${st.label}</option>`).join('')}
          </select>
        </td>
        <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: center;">
          <select data-product="${_escapeHtml(pn)}" data-field="default_ship_from"
            style="padding: 6px; border: 1px solid #d1d5db; border-radius: 4px; width: 130px;">
            <option value="">-- 自动 --</option>
            ${warehouseZips.map(z => `<option value="${z}" ${defaultShipFrom === z ? 'selected' : ''}>${z}</option>`).join('')}
          </select>
        </td>
      </tr>
    `;
  }).join('');

  // When carrier changes, update supplier dropdown
  tbody.querySelectorAll('.pm-carrier-select').forEach(select => {
    select.addEventListener('change', function() {
      const product = this.dataset.product;
      const carrier = this.value;
      const row = this.closest('tr');
      const supplierSelect = row.querySelector('.pm-supplier-select');
      
      // Filter suppliers by carrier category
      const filtered = carrier ? supplierList.filter(s => s.category === carrier) : supplierList;
      supplierSelect.innerHTML = '<option value="">--</option>' +
        filtered.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
    });
  });
}

function collectProductMapping() {
  const mapping = {};
  document.querySelectorAll('#product-mapping-tbody tr').forEach(row => {
    const selects = row.querySelectorAll('select');
    if (selects.length >= 4) {
      const product = selects[0].dataset.product;
      const carrier = selects[0].value;
      const supplier = selects[1].value;
      const serviceType = selects[2].value;
      const defaultShipFrom = selects[3].value;
      if (product && (carrier || supplier)) {
        mapping[product] = { carrier, supplier, service_type: serviceType, default_ship_from: defaultShipFrom };
      }
    }
  });
  return mapping;
}

async function initProductMapping() {
  const saveBtn = document.getElementById('product-mapping-save-btn');
  if (!saveBtn) return;

  const productNames = await loadProductMappingData();
  renderProductMappingTable(productNames);

  saveBtn.addEventListener('click', async () => {
    zoneChartsData.product_mapping = collectProductMapping();
    await saveZoneChartsData();
  });
}


// ============================================
// Supplier Dashboard (Orders by Day)
// ============================================

let supplierDashboardInitialized = false;

async function initSupplierDashboard() {
  if (supplierDashboardInitialized) return;
  supplierDashboardInitialized = true;

  // Load product names for filter dropdown
  try {
    const res = await fetch('/api/supplier-dashboard/product-names');
    const data = await res.json();
    const select = document.getElementById('supplier-day-product-filter');
    if (select) {
      (data.product_names || []).forEach(pn => {
        const opt = document.createElement('option');
        opt.value = pn;
        opt.textContent = pn;
        select.appendChild(opt);
      });
    }
  } catch (e) {
    console.error('Failed to load supplier product names:', e);
  }

  // Set default dates (last 30 days)
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const fromInput = document.getElementById('supplier-day-from-date');
  const toInput = document.getElementById('supplier-day-to-date');
  if (fromInput) fromInput.value = start;
  if (toInput) toInput.value = end;

  // Apply button
  const applyBtn = document.getElementById('supplier-day-apply-btn');
  if (applyBtn) {
    applyBtn.addEventListener('click', updateSupplierOrdersByDay);
  }

  // Initial load
  updateSupplierOrdersByDay();
}

async function updateSupplierOrdersByDay() {
  const productFilter = document.getElementById('supplier-day-product-filter')?.value || 'all';
  const fromDate = document.getElementById('supplier-day-from-date')?.value || '';
  const toDate = document.getElementById('supplier-day-to-date')?.value || '';

  const params = new URLSearchParams();
  if (productFilter && productFilter !== 'all') params.append('product_name', productFilter);
  if (fromDate) params.append('start_date', fromDate);
  if (toDate) params.append('end_date', toDate);

  try {
    const res = await fetch(`/api/supplier-dashboard/orders_by_day?${params}`);
    const data = await res.json();
    const rawData = data.orders_by_day || [];

    const allDates = [...new Set(rawData.map(r => r.date))].sort();
    const allProducts = [...new Set(rawData.map(r => r.product_name))];

    const dataMap = {};
    rawData.forEach(r => {
      const key = `${r.date}_${r.product_name}`;
      dataMap[key] = r.count;
    });

    const colors = [
      'rgba(54, 162, 235, 1)', 'rgba(255, 99, 132, 1)', 'rgba(75, 192, 192, 1)',
      'rgba(255, 206, 86, 1)', 'rgba(153, 102, 255, 1)', 'rgba(255, 159, 64, 1)',
      'rgba(201, 203, 207, 1)', 'rgba(0, 128, 128, 1)', 'rgba(220, 20, 60, 1)',
      'rgba(50, 205, 50, 1)', 'rgba(255, 140, 0, 1)', 'rgba(138, 43, 226, 1)',
      'rgba(70, 130, 180, 1)', 'rgba(244, 164, 96, 1)', 'rgba(0, 191, 255, 1)'
    ];

    let datasets = [];

    if (productFilter === 'all') {
      // Total line
      const totals = allDates.map(date => {
        let sum = 0;
        allProducts.forEach(pn => { sum += dataMap[`${date}_${pn}`] || 0; });
        return sum;
      });
      datasets.push({
        label: 'Total',
        data: totals,
        borderColor: 'rgba(0, 0, 0, 0.8)',
        backgroundColor: 'rgba(0, 0, 0, 0.1)',
        borderWidth: 2, fill: false, tension: 0.1,
        datalabels: { display: true, color: 'rgba(0,0,0,0.8)', font: { weight: 'bold', size: 11 }, align: 'top', anchor: 'end' }
      });

      // Individual product lines
      allProducts.forEach((pn, idx) => {
        const color = colors[idx % colors.length];
        datasets.push({
          label: pn,
          data: allDates.map(date => dataMap[`${date}_${pn}`] || 0),
          borderColor: color,
          backgroundColor: color.replace('1)', '0.1)'),
          borderWidth: 1.5, fill: false, tension: 0.1, pointRadius: 2,
          datalabels: { display: false }
        });
      });
    } else {
      // Single product
      datasets.push({
        label: productFilter,
        data: allDates.map(date => dataMap[`${date}_${productFilter}`] || 0),
        borderColor: colors[0],
        backgroundColor: colors[0].replace('1)', '0.2)'),
        borderWidth: 2, fill: true, tension: 0.1,
        datalabels: { display: true, color: colors[0], font: { weight: 'bold', size: 11 }, align: 'top', anchor: 'end' }
      });
    }

    // Destroy existing chart
    _destroyChart('supplier-orders-by-day-chart');
    
    const ctx = document.getElementById('supplier-orders-by-day-chart');
    if (ctx) {
      const chart = new Chart(ctx, {
        type: 'line',
        data: { labels: allDates, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true, position: 'top', labels: { usePointStyle: true, font: { size: 11 } } },
            datalabels: { display: false }
          },
          scales: {
            y: { beginAtZero: true, title: { display: true, text: '订单数' } },
            x: { title: { display: true, text: '日期' } }
          },
          interaction: { mode: 'index', intersect: false }
        },
        plugins: [ChartDataLabels]
      });
      _supplierChartInstances['supplier-orders-by-day-chart'] = chart;
    }
  } catch (e) {
    console.error('Failed to load supplier orders by day:', e);
  }
}


// ============================================
// Supplier Cost Verification
// ============================================

let supplierVerifyData = null;

async function initSupplierVerify() {
  // Load product names for verification dropdown
  try {
    const res = await fetch('/api/supplier-dashboard/product-names');
    const data = await res.json();
    const select = document.getElementById('supplier-verify-product');
    if (select && select.options.length <= 1) {
      (data.product_names || []).forEach(pn => {
        const opt = document.createElement('option');
        opt.value = pn;
        opt.textContent = pn;
        select.appendChild(opt);
      });
    }
  } catch (e) {
    console.error('Failed to load product names:', e);
  }

  // Set default dates
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const fromInput = document.getElementById('supplier-verify-from-date');
  const toInput = document.getElementById('supplier-verify-to-date');
  if (fromInput && !fromInput.value) fromInput.value = start;
  if (toInput && !toInput.value) toInput.value = end;

  // Verify button
  const verifyBtn = document.getElementById('supplier-verify-btn');
  if (verifyBtn) {
    verifyBtn.addEventListener('click', runSupplierVerification);
  }

  // Status filter
  const statusFilter = document.getElementById('supplier-verify-status-filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', () => {
      if (supplierVerifyData) {
        renderSupplierVerifyResults(supplierVerifyData);
      }
    });
  }
}

async function runSupplierVerification() {
  const productName = document.getElementById('supplier-verify-product')?.value;
  const fromDate = document.getElementById('supplier-verify-from-date')?.value;
  const toDate = document.getElementById('supplier-verify-to-date')?.value;

  if (!productName) {
    _showToast('请选择产品名称', 'error');
    return;
  }

  const verifyBtn = document.getElementById('supplier-verify-btn');
  if (verifyBtn) {
    verifyBtn.disabled = true;
    verifyBtn.textContent = '⏳ 核对中...';
  }

  try {
    const res = await fetch('/api/supplier-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_name: productName,
        start_date: fromDate,
        end_date: toDate
      })
    });
    const data = await res.json();

    if (data.error) {
      _showToast('核对失败: ' + data.error, 'error');
      return;
    }

    supplierVerifyData = data;

    // Update summary
    document.getElementById('verify-total-count').textContent = data.total || 0;
    document.getElementById('verify-match-count').textContent = data.match_count || 0;
    document.getElementById('verify-mismatch-count').textContent = data.mismatch_count || 0;
    document.getElementById('verify-nozone-count').textContent = data.no_zone_count || 0;

    document.getElementById('supplier-verify-summary').style.display = 'block';
    document.getElementById('supplier-verify-filter').style.display = 'block';
    document.getElementById('supplier-verify-results').style.display = 'block';

    renderSupplierVerifyResults(data);
    _showToast(`核对完成: ${data.total} 条记录`, 'success');

  } catch (e) {
    _showToast('核对失败: ' + e.message, 'error');
  } finally {
    if (verifyBtn) {
      verifyBtn.disabled = false;
      verifyBtn.textContent = '🔍 开始核对';
    }
  }
}

function renderSupplierVerifyResults(data) {
  const tbody = document.getElementById('supplier-verify-tbody');
  if (!tbody) return;

  const statusFilter = document.getElementById('supplier-verify-status-filter')?.value || 'all';
  let results = data.results || [];

  if (statusFilter !== 'all') {
    results = results.filter(r => r.status === statusFilter);
  }

  if (results.length === 0) {
    tbody.innerHTML = '<tr><td colspan="18" style="text-align: center; padding: 30px; color: #999;">无匹配记录</td></tr>';
    return;
  }

  const _$ = (v) => v ? '$' + v.toFixed(2) : '-';
  const _s = (v) => (v && v !== 0) ? '$' + v.toFixed(2) : '';  // blank if zero

  tbody.innerHTML = results.map(r => {
    const statusColor = r.status === 'match' ? '#22c55e' : r.status === 'mismatch' ? '#ef4444' : '#f59e0b';
    const statusText = r.status === 'match' ? '✓ 匹配' : r.status === 'mismatch' ? '✗ 不匹配' : '⚠ 无分区';
    const rowBg = r.status === 'mismatch' ? 'background: #fef2f2;' : r.status === 'no_zone' ? 'background: #fffbeb;' : '';
    const diffDisplay = r.difference !== null ? `$${r.difference.toFixed(2)}` : '-';
    const diffColor = r.difference !== null && r.difference !== 0 ? (r.difference > 0 ? '#ef4444' : '#22c55e') : '#666';

    // TMS surcharge breakdown
    const s = r.tms_surcharges || {};
    const otherTotal = (s.peak || 0) + (s.remote || 0) + (s.oversize || 0) + (s.address_change || 0) + (s.signature || 0) + (s.other || 0);

    // Build tooltip for our calculated breakdown
    let calcTitle = '';
    if (r.breakdown && Object.keys(r.breakdown).length > 0) {
      calcTitle = Object.entries(r.breakdown)
        .map(([k, v]) => `${k}: ${typeof v === 'number' ? '$' + v.toFixed(2) : v}`)
        .join('&#10;');
    }

    const cell = 'padding: 4px 6px; border: 1px solid #e5e7eb;';
    const numCell = cell + ' text-align: right; font-variant-numeric: tabular-nums;';
    const surCell = numCell + ' color: #6b7280; font-size: 11px;';

    return `
      <tr style="${rowBg}">
        <td style="${cell} font-family: monospace; font-size: 11px;">${_escapeHtml(r.tracking_number || '')}</td>
        <td style="${cell}">${_escapeHtml(r.customer_name || '')}</td>
        <td style="${cell} font-size: 11px;">${_escapeHtml((r.date || '').slice(0, 10))}</td>
        <td style="${cell} text-align: center;">${_escapeHtml(r.ship_from || '')}</td>
        <td style="${cell} text-align: center;">${_escapeHtml(r.ship_to || '')}</td>
        <td style="${numCell}">${r.weight_kg.toFixed(2)}</td>
        <td style="${numCell}">${r.weight_lb.toFixed(2)}</td>
        <td style="${cell} text-align: center; font-weight: 600;">${r.zone || '-'}</td>
        <td style="${surCell} background: #f8fafc;">${_s(s.freight)}</td>
        <td style="${surCell} background: #f8fafc;">${_s(s.fuel)}</td>
        <td style="${surCell} background: #f8fafc;">${_s(s.residential)}</td>
        <td style="${surCell} background: #f8fafc;">${_s(s.das + (s.das_remote || 0))}</td>
        <td style="${surCell} background: #f8fafc;">${_s(s.ahs)}</td>
        <td style="${surCell} background: #f8fafc;">${_s(otherTotal)}</td>
        <td style="${numCell} font-weight: 700;">$${(r.tms_cost || 0).toFixed(2)}</td>
        <td style="${numCell} font-weight: 700; cursor: help;" title="${calcTitle}">${r.calculated_cost !== null ? '$' + r.calculated_cost.toFixed(2) : '-'}</td>
        <td style="${numCell} color: ${diffColor}; font-weight: 600;">${diffDisplay}</td>
        <td style="${cell} text-align: center; color: ${statusColor}; font-weight: 600;">${statusText}</td>
      </tr>
    `;
  }).join('');
}


// ============================================
// Supplier Operations Sub-Tab Navigation
// ============================================

function initSupplierOpsSubTabs() {
  const subtabs = document.querySelectorAll('#supplier-ops-subtabs .settings-subtab');
  
  subtabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-supplier-ops-tab');
      
      subtabs.forEach(t => t.classList.remove('active'));
      
      document.querySelectorAll('#supplier-operations-tab .settings-subtab-content').forEach(content => {
        content.style.display = 'none';
      });
      
      tab.classList.add('active');
      
      const target = document.getElementById(targetId);
      if (target) {
        target.style.display = 'block';
      }

      // Initialize tabs on first view
      if (targetId === 'supplier-dashboard') {
        initSupplierDashboard();
      } else if (targetId === 'supplier-verify') {
        initSupplierVerify();
      }
    });
  });
}


// ============================================
// Module Initialization
// ============================================

function initSupplierOperations() {
  // Initialize sub-tab navigation
  initSupplierOpsSubTabs();
  
  // Initialize zone charts (in settings)
  initZoneCharts();
  
  // Initialize product mapping (in settings)  
  initProductMapping();
  
  // Initialize supplier dashboard on first view
  // (deferred until tab is clicked)
}

// Export
window.SupplierOps = {
  init: initSupplierOperations,
  initDashboard: initSupplierDashboard,
  initVerify: initSupplierVerify
};

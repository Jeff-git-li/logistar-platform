/**
 * Turnover Analytics Module v2.0  Full multi-tab dashboard
 * Sub-tabs: Overview, Volume, Customers, SKU Analysis, Warehouses
 * Fetches data from /api/turnover/ (proxied to FastAPI backend) and renders with Chart.js.
 */

(function () {
  'use strict';

  const turnoverCharts = {};
  let turnoverInitialized = false;
  const subTabLoaded = {};

  const WAREHOUSE_MAP = {
    '13': 'Ontario, CA',
    '5': 'New York, NY',
    '3': 'Rialto, CA (WH3)',
    '15': 'Rialto, CA (WH15)',
  };

  //  Helpers 

  function formatDate(d) {
    return d.toISOString().split('T')[0];
  }

  function defaultDates() {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    return { from: formatDate(from), to: formatDate(to) };
  }

  function populateWarehouseSelect(selectId) {
    const el = document.getElementById(selectId);
    if (!el || el.options.length > 1) return;
    el.innerHTML = '<option value="">全部仓库</option>';
    for (const [id, name] of Object.entries(WAREHOUSE_MAP)) {
      el.innerHTML += `<option value="${id}">${name}</option>`;
    }
  }

  function setDefaultDateInputs(fromId, toId) {
    const d = defaultDates();
    const f = document.getElementById(fromId);
    const t = document.getElementById(toId);
    if (f && !f.value) f.value = d.from;
    if (t && !t.value) t.value = d.to;
  }

  function showEl(id) { const e = document.getElementById(id); if (e) e.style.display = 'block'; }
  function hideEl(id) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
  function showFlex(id) { const e = document.getElementById(id); if (e) e.style.display = 'flex'; }

  function destroyChart(key) {
    if (turnoverCharts[key]) { turnoverCharts[key].destroy(); delete turnoverCharts[key]; }
  }

  function num(v, dec) {
    if (v == null) return '';
    return v.toLocaleString(undefined, { maximumFractionDigits: dec != null ? dec : 2 });
  }

  function fetchApi(path, params) {
    const qs = params ? '?' + new URLSearchParams(Object.fromEntries(
      Object.entries(params).filter(([,v]) => v != null && v !== '')
    )).toString() : '';
    return fetch(`/api/turnover/${path}${qs}`).then(r => r.json());
  }

  //  INIT / DESTROY 

  window.initTurnover = function () {
    if (!turnoverInitialized) {
      // Setup granularity toggle buttons
      document.querySelectorAll('.to-gran-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          btn.closest('.to-granularity-group').querySelectorAll('.to-gran-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
      // Setup sort toggle buttons
      document.querySelectorAll('.to-sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          btn.closest('.to-granularity-group').querySelectorAll('.to-sort-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
      turnoverInitialized = true;
    }
    // Always load overview on tab open
    loadTurnoverOverview();
  };

  window.destroyTurnover = function () {
    Object.values(turnoverCharts).forEach(c => c.destroy());
    Object.keys(turnoverCharts).forEach(k => delete turnoverCharts[k]);
    Object.keys(subTabLoaded).forEach(k => delete subTabLoaded[k]);
  };

  //  SUB-TAB 1: OVERVIEW 

  window.loadTurnoverOverview = function () {
    setDefaultDateInputs('turnover-date-from', 'turnover-date-to');
    populateWarehouseSelect('turnover-warehouse');

    const from = document.getElementById('turnover-date-from')?.value;
    const to = document.getElementById('turnover-date-to')?.value;
    const wh = document.getElementById('turnover-warehouse')?.value;
    const params = { date_from: from, date_to: to, warehouse_id: wh };

    showFlex('turnover-loading');
    hideEl('turnover-overview-content');

    Promise.all([
      fetchApi('analytics/invlog/dashboard', params),
      fetchApi('analytics/invlog/volume', params),
      fetchApi('analytics/invlog/turnover', params),
      fetchApi('analytics/invlog/customers', params),
      fetchApi('warehouses/live-inventory', { warehouse_id: wh }).catch(e => { console.warn('Live inventory unavailable:', e); return { warehouses: [] }; }),
    ])
    .then(([dashboard, volume, turnover, customers, liveInv]) => {
      hideEl('turnover-loading');
      showEl('turnover-overview-content');

      if (dashboard.error) {
        document.getElementById('turnover-overview-content').innerHTML =
          `<div class="to-error-msg"> ${dashboard.error}<br><span style="font-size:13px;">${dashboard.detail || ''}</span></div>`;
        return;
      }

      // Calculate total inventory SKU count from live data
      const inventorySkusByCustomer = {};
      let totalInventorySkus = 0;
      const allWarehouses = liveInv.warehouses || [];
      allWarehouses.forEach(w => {
        (w.customers || []).forEach(c => {
          if (!inventorySkusByCustomer[c.customer_code]) {
            inventorySkusByCustomer[c.customer_code] = 0;
          }
          inventorySkusByCustomer[c.customer_code] += c.skus;
        });
        totalInventorySkus += w.total_skus || 0;
      });

      renderOverviewStats(dashboard, totalInventorySkus);
      renderOverviewVolumeChart(volume);
      renderOverviewTurnoverRate(turnover);
      renderOverviewCustomers(customers, inventorySkusByCustomer);
    })
    .catch(err => {
      hideEl('turnover-loading');
      showEl('turnover-overview-content');
      document.getElementById('turnover-overview-content').innerHTML =
        `<div class="to-error-msg"> ${err.message}</div>`;
    });
  };

  function renderOverviewStats(data, totalInventorySkus) {
    const el = document.getElementById('turnover-stats');
    if (!el) return;
    const ob = data.outbound || {};
    const ib = data.inbound || {};
    el.innerHTML = `
      <div class="turnover-stat-card turnover-stat-outbound">
        <div class="turnover-stat-label"> 出库总量</div>
        <div class="turnover-stat-value">${num(ob.total_vol,1)} CBM</div>
        <div class="turnover-stat-sub">${num(ob.total_events,0)} 次  ${num(ob.total_qty,0)} 件</div>
      </div>
      <div class="turnover-stat-card turnover-stat-inbound">
        <div class="turnover-stat-label"> 入库总量</div>
        <div class="turnover-stat-value">${num(ib.total_vol,1)} CBM</div>
        <div class="turnover-stat-sub">${num(ib.total_events,0)} 次  ${num(ib.total_qty,0)} 件</div>
      </div>
      <div class="turnover-stat-card">
        <div class="turnover-stat-label"> 在库SKU数</div>
        <div class="turnover-stat-value">${num(totalInventorySkus || 0, 0)}</div>
        <div class="turnover-stat-sub">当前库存</div>
      </div>
      <div class="turnover-stat-card">
        <div class="turnover-stat-label"> 客户数</div>
        <div class="turnover-stat-value">${data.unique_customers || 0}</div>
      </div>
      <div class="turnover-stat-card">
        <div class="turnover-stat-label"> 仓库数</div>
        <div class="turnover-stat-value">${data.active_warehouses || 0}</div>
      </div>
    `;
  }

  function renderOverviewVolumeChart(data) {
    destroyChart('overview-vol');
    const canvas = document.getElementById('turnover-volume-chart');
    if (!canvas) return;

    const inbound = data.inbound || [];
    const outbound = data.outbound || [];
    const allPeriods = [...new Set([...inbound.map(r => r.period), ...outbound.map(r => r.period)])].sort();
    const inMap = {}; inbound.forEach(r => { inMap[r.period] = r; });
    const outMap = {}; outbound.forEach(r => { outMap[r.period] = r; });

    turnoverCharts['overview-vol'] = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: allPeriods,
        datasets: [
          {
            label: '入库 (CBM)', data: allPeriods.map(p => inMap[p]?.total_volume_cbm || 0),
            backgroundColor: 'rgba(59,130,246,0.6)', borderColor: '#3b82f6', borderWidth: 1,
          },
          {
            label: '出库 (CBM)', data: allPeriods.map(p => outMap[p]?.total_volume_cbm || 0),
            backgroundColor: 'rgba(249,115,22,0.6)', borderColor: '#f97316', borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' }, datalabels: { display: false } },
        scales: {
          x: { ticks: { maxRotation: 45, minRotation: 45, font: { size: 11 } } },
          y: { beginAtZero: true, ticks: { callback: v => v >= 1000 ? (v/1000)+'k' : v } },
        },
      },
    });
  }

  function renderOverviewTurnoverRate(data) {
    const el = document.getElementById('turnover-rate-display');
    if (!el) return;
    if (data.error || data.detail) { el.innerHTML = `<p style="color:var(--color-slate-500);text-align:center;">${data.detail||data.error}</p>`; return; }

    const rate = data.turnover_rate || 0;
    const color = rate >= 2 ? 'var(--color-success)' : rate >= 1 ? 'var(--color-warning)' : 'var(--color-danger)';
    const label = rate >= 2 ? '高' : rate >= 1 ? '中' : '低';

    el.innerHTML = `
      <div class="to-rate-container">
        <div class="to-rate-big">
          <div style="font-size:48px;font-weight:800;color:${color};">${rate.toFixed(2)}</div>
          <div style="font-size:14px;color:var(--color-slate-500);">周转率 (${label})</div>
        </div>
        <div class="to-rate-details">
          <div class="to-rate-box" style="background:var(--color-success-light);">
            <div class="to-rate-box-label">出库体积</div>
            <div class="to-rate-box-value" style="color:var(--color-success);">${num(data.total_outbound_vol)} CBM</div>
          </div>
          <div class="to-rate-box" style="background:var(--color-primary-light);">
            <div class="to-rate-box-label">入库体积</div>
            <div class="to-rate-box-value" style="color:var(--color-primary);">${num(data.total_inbound_vol)} CBM</div>
          </div>
          <div class="to-rate-box" style="background:var(--color-slate-50);">
            <div class="to-rate-box-label">期初库存</div>
            <div class="to-rate-box-value">${num(data.beginning_inventory_vol)} CBM</div>
          </div>
          <div class="to-rate-box" style="background:var(--color-slate-50);">
            <div class="to-rate-box-label">期末库存</div>
            <div class="to-rate-box-value">${num(data.ending_inventory_vol)} CBM</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderOverviewCustomers(customers, inventorySkusByCustomer) {
    const tbody = document.getElementById('turnover-overview-customers-tbody');
    if (!tbody) return;
    if (!Array.isArray(customers) || !customers.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="to-empty-cell">暂无数据</td></tr>';
      return;
    }
    const invSkus = inventorySkusByCustomer || {};
    tbody.innerHTML = customers.slice(0, 15).map(c => `
      <tr>
        <td style="text-align:left;"><span class="to-cust-badge">${c.customer_code}</span></td>
        <td>${num(c.outbound_vol)}</td>
        <td>${num(c.inbound_vol)}</td>
        <td>${num(c.outbound_qty,0)}</td>
        <td>${num(c.inbound_qty,0)}</td>
        <td>${c.outbound_skus || 0}</td>
        <td>${invSkus[c.customer_code] || 0}</td>
      </tr>
    `).join('');
  }

  //  SUB-TAB 2: VOLUME 

  window.loadTurnoverVolume = function () {
    setDefaultDateInputs('turnover-vol-from', 'turnover-vol-to');
    populateWarehouseSelect('turnover-vol-warehouse');

    const from = document.getElementById('turnover-vol-from')?.value;
    const to = document.getElementById('turnover-vol-to')?.value;
    const wh = document.getElementById('turnover-vol-warehouse')?.value;
    const cust = document.getElementById('turnover-vol-customer')?.value;
    const granBtn = document.querySelector('.to-gran-btn.active');
    const gran = granBtn ? granBtn.getAttribute('data-gran') : 'day';

    showFlex('turnover-vol-loading');
    hideEl('turnover-vol-content');

    fetchApi('analytics/invlog/volume', {
      date_from: from, date_to: to, warehouse_id: wh, customer_code: cust, granularity: gran,
    })
    .then(data => {
      hideEl('turnover-vol-loading');
      showEl('turnover-vol-content');
      renderVolumeChart(data);
      renderVolumeTable(data);
    })
    .catch(err => {
      hideEl('turnover-vol-loading');
      showEl('turnover-vol-content');
      document.getElementById('turnover-vol-content').innerHTML = `<div class="to-error-msg"> ${err.message}</div>`;
    });
  };

  function renderVolumeChart(data) {
    destroyChart('vol-detail');
    const canvas = document.getElementById('turnover-vol-detail-chart');
    if (!canvas) return;

    const inbound = data.inbound || [];
    const outbound = data.outbound || [];
    const allPeriods = [...new Set([...inbound.map(r=>r.period), ...outbound.map(r=>r.period)])].sort();
    const inMap = {}; inbound.forEach(r => { inMap[r.period] = r; });
    const outMap = {}; outbound.forEach(r => { outMap[r.period] = r; });

    turnoverCharts['vol-detail'] = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: allPeriods,
        datasets: [
          {
            label: '入库 (CBM)', data: allPeriods.map(p => inMap[p]?.total_volume_cbm || 0),
            backgroundColor: 'rgba(59,130,246,0.6)', borderColor: '#3b82f6', borderWidth: 1, borderRadius: 4,
          },
          {
            label: '出库 (CBM)', data: allPeriods.map(p => outMap[p]?.total_volume_cbm || 0),
            backgroundColor: 'rgba(249,115,22,0.6)', borderColor: '#f97316', borderWidth: 1, borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' }, datalabels: { display: false } },
        scales: {
          x: { ticks: { maxRotation: 45, minRotation: 45, font: { size: 11 } } },
          y: { beginAtZero: true },
        },
      },
    });
  }

  function renderVolumeTable(data) {
    const renderTbody = (tbodyId, items) => {
      const tbody = document.getElementById(tbodyId);
      if (!tbody) return;
      if (!items || !items.length) { tbody.innerHTML = '<tr><td colspan="5" class="to-empty-cell">暂无数据</td></tr>'; return; }
      tbody.innerHTML = items.map(r => `
        <tr>
          <td style="text-align:left;">${r.period}</td>
          <td>${num(r.total_volume_cbm)}</td>
          <td>${num(r.total_qty,0)}</td>
          <td>${num(r.event_count,0)}</td>
          <td>${r.unique_skus || 0}</td>
        </tr>
      `).join('');
    };
    renderTbody('turnover-vol-outbound-tbody', data.outbound ? [...data.outbound].reverse() : []);
    renderTbody('turnover-vol-inbound-tbody', data.inbound ? [...data.inbound].reverse() : []);
  }

  //  SUB-TAB 3: CUSTOMERS 

  window.loadTurnoverCustomers = function () {
    setDefaultDateInputs('turnover-cust-from', 'turnover-cust-to');
    populateWarehouseSelect('turnover-cust-warehouse');

    const from = document.getElementById('turnover-cust-from')?.value;
    const to = document.getElementById('turnover-cust-to')?.value;
    const wh = document.getElementById('turnover-cust-warehouse')?.value;

    showFlex('turnover-cust-loading');
    hideEl('turnover-cust-content');

    fetchApi('analytics/invlog/customers', { date_from: from, date_to: to, warehouse_id: wh })
    .then(data => {
      hideEl('turnover-cust-loading');
      showEl('turnover-cust-content');
      renderCustomerChart(data);
      renderCustomerTable(data);
    })
    .catch(err => {
      hideEl('turnover-cust-loading');
      showEl('turnover-cust-content');
      document.getElementById('turnover-cust-content').innerHTML = `<div class="to-error-msg"> ${err.message}</div>`;
    });
  };

  function renderCustomerChart(data) {
    destroyChart('cust');
    const canvas = document.getElementById('turnover-cust-chart');
    if (!canvas || !data.length) return;

    const top15 = data.slice(0, 15);
    turnoverCharts['cust'] = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: top15.map(c => c.customer_code),
        datasets: [
          {
            label: '出库 (CBM)', data: top15.map(c => c.outbound_vol),
            backgroundColor: 'rgba(249,115,22,0.7)', borderRadius: 4,
          },
          {
            label: '入库 (CBM)', data: top15.map(c => c.inbound_vol),
            backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { position: 'top' }, datalabels: { display: false } },
        scales: { x: { beginAtZero: true } },
      },
    });
  }

  function renderCustomerTable(data) {
    const tbody = document.getElementById('turnover-cust-tbody');
    const tfoot = document.getElementById('turnover-cust-tfoot');
    const title = document.getElementById('turnover-cust-table-title');
    if (!tbody) return;

    if (title) title.textContent = `客户明细 (${data.length} 个客户)`;

    const totalOutVol = data.reduce((s, d) => s + d.outbound_vol, 0);
    const totalInVol = data.reduce((s, d) => s + d.inbound_vol, 0);

    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="to-empty-cell">暂无数据</td></tr>';
      if (tfoot) tfoot.innerHTML = '';
      return;
    }

    tbody.innerHTML = data.map(d => `
      <tr>
        <td style="text-align:left;"><span class="to-cust-badge">${d.customer_code}</span></td>
        <td>${num(d.outbound_vol)}</td>
        <td>${num(d.inbound_vol)}</td>
        <td>${num(d.outbound_qty,0)}</td>
        <td>${d.outbound_skus || 0}</td>
        <td>${num(d.inbound_qty,0)}</td>
        <td>${d.inbound_skus || 0}</td>
        <td>${totalOutVol > 0 ? ((d.outbound_vol / totalOutVol) * 100).toFixed(1) + '%' : ''}</td>
      </tr>
    `).join('');

    if (tfoot) {
      tfoot.innerHTML = `
        <tr style="font-weight:700;border-top:2px solid var(--color-slate-300);">
          <td style="text-align:left;">合计</td>
          <td>${num(totalOutVol,1)}</td>
          <td>${num(totalInVol,1)}</td>
          <td>${num(data.reduce((s,d) => s+d.outbound_qty, 0),0)}</td>
          <td></td>
          <td>${num(data.reduce((s,d) => s+d.inbound_qty, 0),0)}</td>
          <td></td>
          <td>100%</td>
        </tr>
      `;
    }
  }

  //  SUB-TAB 4: SKU ANALYSIS 

  window.loadTurnoverSkus = function () {
    setDefaultDateInputs('turnover-sku-from', 'turnover-sku-to');
    populateWarehouseSelect('turnover-sku-warehouse');

    const from = document.getElementById('turnover-sku-from')?.value;
    const to = document.getElementById('turnover-sku-to')?.value;
    const wh = document.getElementById('turnover-sku-warehouse')?.value;
    const cust = document.getElementById('turnover-sku-customer')?.value;
    const sortBtn = document.querySelector('.to-sort-btn.active');
    const sortBy = sortBtn ? sortBtn.getAttribute('data-sort') : 'outbound_vol';
    const limit = document.getElementById('turnover-sku-limit')?.value || 100;

    showFlex('turnover-sku-loading');
    hideEl('turnover-sku-content');

    fetchApi('analytics/invlog/skus', {
      date_from: from, date_to: to, warehouse_id: wh, customer_code: cust,
      sort_by: sortBy, limit: limit,
    })
    .then(data => {
      hideEl('turnover-sku-loading');
      showEl('turnover-sku-content');
      renderSkuTable(data, sortBy);
    })
    .catch(err => {
      hideEl('turnover-sku-loading');
      showEl('turnover-sku-content');
      document.getElementById('turnover-sku-content').innerHTML = `<div class="to-error-msg"> ${err.message}</div>`;
    });
  };

  function renderSkuTable(data, sortBy) {
    const tbody = document.getElementById('turnover-sku-tbody');
    const title = document.getElementById('turnover-sku-table-title');
    if (!tbody) return;

    const sortLabel = sortBy && sortBy.includes('vol') ? '体积(CBM)' : '数量';
    if (title) title.textContent = `SKU按${sortLabel}排序 (${data.length} 条)`;

    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="to-empty-cell">暂无数据</td></tr>';
      return;
    }

    tbody.innerHTML = data.map((d, i) => {
      const netClass = d.net_change_vol > 0 ? 'to-positive' : d.net_change_vol < 0 ? 'to-negative' : '';
      const netSign = d.net_change_vol > 0 ? '+' : '';
      return `
        <tr>
          <td style="color:var(--color-slate-400);">${i+1}</td>
          <td style="text-align:left;font-family:'SF Mono','Fira Code',monospace;font-size:12px;">${d.product_barcode}</td>
          <td style="text-align:left;"><span class="to-cust-badge">${d.customer_code}</span></td>
          <td>${d.unit_cbm != null ? d.unit_cbm.toFixed(6) : ''}</td>
          <td style="font-weight:600;">${num(d.outbound_vol)}</td>
          <td style="font-weight:600;">${num(d.inbound_vol)}</td>
          <td class="${netClass}" style="font-weight:600;">${netSign}${num(d.net_change_vol)}</td>
          <td>${num(d.outbound_qty,0)}</td>
          <td>${num(d.inbound_qty,0)}</td>
          <td>${num(d.total_events,0)}</td>
        </tr>
      `;
    }).join('');
  }

  //  SUB-TAB 5: WAREHOUSES 

  window.loadTurnoverWarehouses = function () {
    setDefaultDateInputs('turnover-wh-from', 'turnover-wh-to');

    const from = document.getElementById('turnover-wh-from')?.value;
    const to = document.getElementById('turnover-wh-to')?.value;
    const cust = document.getElementById('turnover-wh-customer')?.value;

    showFlex('turnover-wh-loading');
    hideEl('turnover-wh-content');

    Promise.all([
      fetchApi('analytics/invlog/warehouses', { date_from: from, date_to: to, customer_code: cust }),
      fetchApi('warehouses/capacities', {}),
      fetchApi('warehouses/live-inventory', {}).catch(e => { console.warn('Live inventory unavailable:', e); return { warehouses: [] }; }),
    ])
    .then(([whData, capData, invData]) => {
      hideEl('turnover-wh-loading');
      showEl('turnover-wh-content');
      renderWarehouseChart(whData);
      renderWarehouseCards(whData, capData, invData);
    })
    .catch(err => {
      hideEl('turnover-wh-loading');
      showEl('turnover-wh-content');
      document.getElementById('turnover-wh-content').innerHTML = `<div class="to-error-msg"> ${err.message}</div>`;
    });
  };

  function renderWarehouseChart(data) {
    destroyChart('wh');
    const canvas = document.getElementById('turnover-wh-chart');
    if (!canvas || !data.length) return;

    turnoverCharts['wh'] = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: data.map(d => d.warehouse_name),
        datasets: [
          {
            label: '入库 (CBM)', data: data.map(d => d.inbound_vol),
            backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 4,
          },
          {
            label: '出库 (CBM)', data: data.map(d => d.outbound_vol),
            backgroundColor: 'rgba(249,115,22,0.7)', borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' }, datalabels: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    });
  }

  function renderWarehouseCards(whData, capData, invData) {
    const container = document.getElementById('turnover-wh-cards');
    if (!container) return;

    if (!whData.length) {
      container.innerHTML = '<div class="to-error-msg">暂无仓库数据</div>';
      return;
    }

    const capMap = {};
    if (Array.isArray(capData)) capData.forEach(c => { capMap[c.warehouse_id] = c.total_capacity_cbm; });

    // Build live inventory lookup by warehouse_id
    const invMap = {};
    if (invData && Array.isArray(invData.warehouses)) {
      invData.warehouses.forEach(w => {
        invMap[w.warehouse_id] = w;
      });
    }

    container.innerHTML = whData.map(wh => {
      const cap = wh.total_capacity_cbm || capMap[wh.warehouse_id] || 0;
      const liveInv = invMap[wh.warehouse_id];
      // Prefer live inventory for net stock; fall back to delta
      const net = liveInv ? liveInv.total_volume_cbm : (wh.inbound_vol - wh.outbound_vol);
      const liveQty = liveInv ? liveInv.total_qty : null;
      const liveSKUs = liveInv ? liveInv.total_skus : null;
      const util = cap > 0 ? Math.min(100, Math.max(0, (net / cap) * 100)) : 0;
      const barColor = util >= 90 ? 'var(--color-danger)' : util >= 70 ? 'var(--color-warning)' : 'var(--color-success)';

      // Build customer breakdown HTML if available
      let custBreakdownHtml = '';
      if (liveInv && Array.isArray(liveInv.customers) && liveInv.customers.length) {
        const topCusts = liveInv.customers.slice(0, 5);
        custBreakdownHtml = `
          <div class="to-wh-customers" style="margin-top:12px;border-top:1px solid var(--color-slate-100);padding-top:12px;">
            <div style="font-size:12px;font-weight:600;color:var(--color-slate-500);margin-bottom:6px;">客户库存明细 (Top ${topCusts.length})</div>
            ${topCusts.map(c => `
              <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--color-slate-600);padding:2px 0;">
                <span>${c.customer_code}</span>
                <span>${num(c.volume_cbm,1)} CBM · ${num(c.qty,0)} 件 · ${c.skus} SKU</span>
              </div>
            `).join('')}
          </div>
        `;
      }

      return `
        <div class="to-wh-card">
          <div class="to-wh-card-header">
            <div>
              <h3 class="to-wh-card-name">${wh.warehouse_name}</h3>
              <p class="to-wh-card-sub">WH #${wh.warehouse_id}  ${wh.timezone || ''}</p>
            </div>
          </div>
          <div class="to-wh-stats-grid">
            <div class="to-wh-stat-box" style="background:#fff7ed;">
              <div class="to-wh-stat-box-label" style="color:#c2410c;">出库体积</div>
              <div class="to-wh-stat-box-value" style="color:#9a3412;">${num(wh.outbound_vol,1)}</div>
              <div class="to-wh-stat-box-extra" style="color:#c2410c;">CBM  ${num(wh.outbound_qty,0)} 件</div>
            </div>
            <div class="to-wh-stat-box" style="background:var(--color-primary-light);">
              <div class="to-wh-stat-box-label" style="color:#2563eb;">入库体积</div>
              <div class="to-wh-stat-box-value" style="color:#1e40af;">${num(wh.inbound_vol,1)}</div>
              <div class="to-wh-stat-box-extra" style="color:#2563eb;">CBM  ${num(wh.inbound_qty,0)} 件</div>
            </div>
            <div class="to-wh-stat-box" style="background:#ecfdf5;">
              <div class="to-wh-stat-box-label" style="color:#059669;">净库存${liveInv ? ' (实时)' : ''}</div>
              <div class="to-wh-stat-box-value" style="color:#065f46;">${num(net,1)}</div>
              <div class="to-wh-stat-box-extra" style="color:#059669;">CBM${liveQty !== null ? '  ' + num(liveQty,0) + ' 件' : ''}</div>
            </div>
            <div class="to-wh-stat-box" style="background:var(--color-slate-50);">
              <div class="to-wh-stat-box-label">SKU数${liveInv ? ' (实时)' : ''}</div>
              <div class="to-wh-stat-box-value">${liveSKUs !== null ? num(liveSKUs,0) : num(wh.unique_skus,0)}</div>
            </div>
          </div>
          ${cap > 0 ? `
            <div class="to-wh-capacity">
              <div class="to-wh-cap-labels">
                <span>净库存: ${num(net,1)} CBM${liveInv ? ' (实时)' : ''}</span>
                <span>容量: ${num(cap,0)} CBM</span>
              </div>
              <div class="to-wh-cap-bar">
                <div class="to-wh-cap-fill" style="width:${util}%;background:${barColor};"></div>
              </div>
              <div style="text-align:right;font-size:12px;font-weight:600;color:var(--color-slate-600);margin-top:4px;">
                ${util.toFixed(1)}% 已使用
              </div>
            </div>
          ` : `<p style="font-size:12px;color:var(--color-slate-400);font-style:italic;margin-top:12px;border-top:1px solid var(--color-slate-100);padding-top:12px;">设置容量以查看利用率</p>`}
          ${custBreakdownHtml}
        </div>
      `;
    }).join('');
  }

  //  SYNC 

  window.triggerTurnoverSync = function () {
    const btn = document.getElementById('turnover-sync-btn');
    if (btn) { btn.disabled = true; btn.textContent = '同步中...'; }

    fetch('/api/turnover/sync/daily', { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (btn) { btn.disabled = false; btn.textContent = ' 同步'; }
        if (window.showToast) showToast(data.message || '同步已开始', 'success');
        else alert(data.message || '同步已开始');
      })
      .catch(err => {
        if (btn) { btn.disabled = false; btn.textContent = ' 同步'; }
        alert('同步失败: ' + err.message);
      });
  };

})();
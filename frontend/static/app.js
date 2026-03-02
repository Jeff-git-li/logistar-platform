// FedEx Invoice Verification System - Frontend

// Register and configure datalabels plugin
if (window.ChartDataLabels) {
  Chart.register(ChartDataLabels);
  // Disable datalabels plugin by default (enable only where needed)
  Chart.defaults.set('plugins.datalabels', { display: false });
}

let appData = null; // Full versioned rate data
let currentVersion = null; // Currently selected version for editing
let customerData = null;
let isVerifying = false; // Prevent multiple simultaneous verifications
let analysisResults = null; // Store analysis results for export
let uploadedFileName = ''; // Store original uploaded filename
let originalInvoiceData = null; // Store original invoice rows for export

// ============================================
// Data Management
// ============================================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function moveArrayItem(array, fromIndex, toIndex) {
  const item = array.splice(fromIndex, 1)[0];
  array.splice(toIndex, 0, item);
}

async function getData() {
  // Get all rate versions
  const res = await fetch('/api/data');
  return res.json();
}

async function getActiveVersion() {
  // Get the active version for editing
  const res = await fetch('/api/data/active');
  return res.json();
}

async function getVersionById(versionId) {
  const res = await fetch(`/api/data/version/${versionId}`);
  return res.json();
}

async function saveData(data) {
  // Save entire versioned structure
  const res = await fetch('/api/data', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data)
  });
  return res.json();
}

async function saveVersion(versionId, versionData) {
  // Save a specific version
  const res = await fetch(`/api/data/version/${versionId}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(versionData)
  });
  return res.json();
}

async function createNewVersion(versionData) {
  const res = await fetch('/api/data/version', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(versionData)
  });
  return res.json();
}

async function deleteVersion(versionId) {
  const res = await fetch(`/api/data/version/${versionId}`, {
    method: 'DELETE'
  });
  return res.json();
}

async function setActiveVersion(versionId) {
  const res = await fetch(`/api/data/active/${versionId}`, {
    method: 'POST'
  });
  return res.json();
}

async function getCustomerData() {
  const res = await fetch('/api/customers');
  return res.json();
}

async function saveCustomerData(data) {
  const res = await fetch('/api/customers', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data)
  });
  return res.json();
}

// ============================================
// Tab Management
// ============================================

function initTabs() {
  // Sidebar navigation
  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tabName = item.dataset.tab;
      
      // Update active states
      navItems.forEach(n => n.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      item.classList.add('active');
      document.getElementById(`${tabName}-tab`).classList.add('active');
      
      // Load download center when that tab is opened
      if (tabName === 'downloads') {
        loadDownloadCenter();
      }
      
      // Initialize supplier dashboard when tab is first opened
      if (tabName === 'supplier-operations' && window.SupplierOps) {
        SupplierOps.initDashboard();
      }
      
      // Initialize WMS Monitor when tab is opened, destroy when leaving
      if (tabName === 'wms-monitor') {
        if (window.initWmsMonitor) initWmsMonitor();
      } else {
        if (window.destroyWmsMonitor) destroyWmsMonitor();
      }
      
      // Initialize Turnover when tab is opened, destroy when leaving
      if (tabName === 'turnover') {
        if (window.initTurnover) initTurnover();
      } else {
        if (window.destroyTurnover) destroyTurnover();
      }
    });
  });
}

// ============================================
// Base Rate Table
// ============================================

function createBaseTable(container, data) {
  container.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'grid';
  table.style.width = 'auto';
  table.style.maxWidth = '100%';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const topLeft = document.createElement('th');
  topLeft.className = 'diagonal-header';
  topLeft.innerHTML = '<span class="lbs-label">lbs</span><span class="zone-label">Zone</span>';
  topLeft.style.width = '50px';
  topLeft.style.maxWidth = '50px';
  headRow.appendChild(topLeft);
  
  data.base_table.zones.forEach(z => {
    const th = document.createElement('th');
    th.textContent = z.replace('Zone ', '');
    th.style.width = '55px';
    th.style.maxWidth = '55px';
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  data.base_table.lbs.forEach((lb, r) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = lb;
    th.style.width = '50px';
    th.style.maxWidth = '50px';
    tr.appendChild(th);
    
    data.base_table.zones.forEach((z, c) => {
      const td = document.createElement('td');
      td.contentEditable = 'true';
      td.className = 'cell';
      td.style.width = '55px';
      td.style.maxWidth = '55px';
      const raw = (data.base_table.rates[r] && data.base_table.rates[r][c] != null) ? data.base_table.rates[r][c] : '';
      
      function formatNumber(v) {
        if (v === '' || v === null || v === undefined) return '';
        const n = Number(v);
        if (Number.isNaN(n)) return '';
        return n.toFixed(2);
      }
      
      td.textContent = (typeof raw === 'number') ? formatNumber(raw) : (raw === '' ? '' : formatNumber(raw));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

function collectBaseTable(container, data) {
  const rows = Array.from(container.querySelectorAll('tbody tr'));
  const rates = rows.map(r => {
    return Array.from(r.querySelectorAll('td')).map(td => {
      const text = td.textContent.trim();
      const cleaned = text.replace(/[^0-9.\-]/g, '');
      const num = parseFloat(cleaned);
      return Number.isFinite(num) ? num : 0.0;
    });
  });
  data.base_table.rates = rates;
}

// ============================================
// Fixed Surcharges
// ============================================

function renderFixedSurcharges(container, data) {
  container.innerHTML = '';
  const surcharges = data.fixed_surcharges || [];
  
  surcharges.forEach((sc, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" class="table-input fixed-desc" data-index="${i}" value="${escapeHtml(sc.description || '')}" placeholder="e.g., DAS Resi" /></td>
      <td><input type="number" class="table-input fixed-amount" data-index="${i}" value="${sc.amount || 0}" /></td>
      <td><input type="text" class="table-input fixed-remark" data-index="${i}" value="${escapeHtml(sc.remark || '')}" /></td>
      <td class="text-center"><button class="btn-remove-small" data-type="fixed" data-index="${i}">×</button></td>
    `;
    container.appendChild(tr);
  });
}

function collectFixedSurcharges(container, data) {
  const rows = Array.from(container.querySelectorAll('tr'));
  data.fixed_surcharges = rows.map(tr => {
    return {
      description: tr.querySelector('.fixed-desc').value,
      amount: parseFloat(tr.querySelector('.fixed-amount').value) || 0,
      remark: tr.querySelector('.fixed-remark').value,
      enabled: true
    };
  });
}

// ============================================
// Zone-Based Surcharges
// ============================================

function renderZoneSurcharges(container, data) {
  container.innerHTML = '';
  const surcharges = data.zone_based_surcharges || [];
  
  surcharges.forEach((sc, i) => {
    const tr = document.createElement('tr');
    
    // Get values for each individual zone (2-8)
    const zone2Val = (sc.zone_rates && sc.zone_rates[2]) || '';
    const zone3Val = (sc.zone_rates && sc.zone_rates[3]) || '';
    const zone4Val = (sc.zone_rates && sc.zone_rates[4]) || '';
    const zone5Val = (sc.zone_rates && sc.zone_rates[5]) || '';
    const zone6Val = (sc.zone_rates && sc.zone_rates[6]) || '';
    const zone7Val = (sc.zone_rates && sc.zone_rates[7]) || '';
    const zone8Val = (sc.zone_rates && sc.zone_rates[8]) || '';
    
    tr.innerHTML = `
      <td><input type="text" class="table-input zone-desc" data-index="${i}" value="${escapeHtml(sc.description || '')}" placeholder="e.g., AHS - Weight" /></td>
      <td><input type="number" class="table-input zone-rate" data-index="${i}" data-zone="2" value="${zone2Val}" placeholder="0.00" step="0.01" /></td>
      <td><input type="number" class="table-input zone-rate" data-index="${i}" data-zone="3" value="${zone3Val}" placeholder="0.00" step="0.01" /></td>
      <td><input type="number" class="table-input zone-rate" data-index="${i}" data-zone="4" value="${zone4Val}" placeholder="0.00" step="0.01" /></td>
      <td><input type="number" class="table-input zone-rate" data-index="${i}" data-zone="5" value="${zone5Val}" placeholder="0.00" step="0.01" /></td>
      <td><input type="number" class="table-input zone-rate" data-index="${i}" data-zone="6" value="${zone6Val}" placeholder="0.00" step="0.01" /></td>
      <td><input type="number" class="table-input zone-rate" data-index="${i}" data-zone="7" value="${zone7Val}" placeholder="0.00" step="0.01" /></td>
      <td><input type="number" class="table-input zone-rate" data-index="${i}" data-zone="8" value="${zone8Val}" placeholder="0.00" step="0.01" /></td>
      <td><input type="text" class="table-input zone-remark" data-index="${i}" value="${escapeHtml(sc.remark || '')}" /></td>
      <td class="text-center"><button class="btn-remove-small" data-type="zone" data-index="${i}">×</button></td>
    `;
    container.appendChild(tr);
  });
}

function collectZoneSurcharges(container, data) {
  const rows = Array.from(container.querySelectorAll('tr'));
  data.zone_based_surcharges = rows.map(tr => {
    const zoneRates = {};
    
    tr.querySelectorAll('.zone-rate').forEach(input => {
      const val = parseFloat(input.value);
      if (!isNaN(val) && val > 0) {
        // Each input has its own individual zone
        if (input.dataset.zone) {
          zoneRates[input.dataset.zone] = val;
        }
      }
    });
    
    return {
      description: tr.querySelector('.zone-desc').value,
      zone_rates: zoneRates,
      remark: tr.querySelector('.zone-remark').value,
      enabled: true
    };
  });
}

// ============================================
// Demand Surcharges (FedEx Contract - with date ranges for invoice verification)
// ============================================

function renderDemandSurcharges(container, data) {
  container.innerHTML = '';
  const surcharges = data.demand_surcharges || [];
  
  surcharges.forEach((sc, i) => {
    const tr = document.createElement('tr');
    
    // Format date ranges as compact inputs
    const dateRangesHtml = (sc.date_ranges || []).map((dr, drIdx) => `
      <div class="date-range-compact" style="display: flex; gap: 4px; align-items: center; margin-bottom: 4px;">
        <input type="date" class="dr-start" data-sc-index="${i}" data-dr-index="${drIdx}" value="${dr.start_date || ''}" style="padding: 4px; font-size: 12px;" />
        <span>-</span>
        <input type="date" class="dr-end" data-sc-index="${i}" data-dr-index="${drIdx}" value="${dr.end_date || ''}" style="padding: 4px; font-size: 12px;" />
        <span>$</span>
        <input type="number" class="dr-amount" data-sc-index="${i}" data-dr-index="${drIdx}" value="${dr.amount || 0}" placeholder="0.00" step="0.01" style="width: 70px; padding: 4px; font-size: 12px;" />
        <button class="btn-remove-tiny" data-sc-index="${i}" data-dr-index="${drIdx}" style="padding: 2px 6px; font-size: 12px;">×</button>
      </div>
    `).join('');
    
    tr.innerHTML = `
      <td><input type="text" class="table-input demand-desc" data-index="${i}" value="${escapeHtml(sc.description || '')}" placeholder="e.g., Demand Surcharge" /></td>
      <td><input type="text" class="table-input demand-trigger" data-index="${i}" value="${escapeHtml(sc.triggered_by || '')}" placeholder="e.g., Residential" /></td>
      <td>
        <div class="date-ranges-cell" data-index="${i}">
          ${dateRangesHtml}
          <button class="btn-add-tiny" data-index="${i}" style="padding: 2px 8px; font-size: 11px; background: #e0e7ff; border: 1px solid #a5b4fc; border-radius: 3px; cursor: pointer;">+ Add Date Range</button>
        </div>
      </td>
      <td><input type="text" class="table-input demand-remark" data-index="${i}" value="${escapeHtml(sc.remark || '')}" /></td>
      <td class="text-center"><button class="btn-remove-small" data-type="demand" data-index="${i}">×</button></td>
    `;
    container.appendChild(tr);
  });
}

function collectDemandSurcharges(container, data) {
  const rows = Array.from(container.querySelectorAll('tr'));
  data.demand_surcharges = rows.map(tr => {
    const dateRanges = [];
    const drCell = tr.querySelector('.date-ranges-cell');
    
    if (drCell) {
      drCell.querySelectorAll('.date-range-compact').forEach(dr => {
        const start = dr.querySelector('.dr-start').value;
        const end = dr.querySelector('.dr-end').value;
        const amount = parseFloat(dr.querySelector('.dr-amount').value) || 0;
        
        if (start && end) {
          dateRanges.push({
            start_date: start,
            end_date: end,
            amount: amount
          });
        }
      });
    }
    
    return {
      description: tr.querySelector('.demand-desc')?.value || '',
      triggered_by: tr.querySelector('.demand-trigger')?.value || '',
      date_ranges: dateRanges,
      remark: tr.querySelector('.demand-remark')?.value || '',
      enabled: true
    };
  });
}

// ============================================
// Fuel Surcharge
// ============================================

function calculateSunday(mondayDate) {
  if (!mondayDate) return '';
  const monday = new Date(mondayDate);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday.toISOString().split('T')[0];
}

function renderFuelSurcharge(data) {
  const container = document.getElementById('fuel-list');
  container.innerHTML = '';
  let fuelRanges = data.fuel_surcharge?.date_ranges || [];
  
  // Sort by start date descending (most recent first)
  fuelRanges = fuelRanges.sort((a, b) => {
    if (!a.start_date) return 1;
    if (!b.start_date) return -1;
    return new Date(b.start_date) - new Date(a.start_date);
  });
  
  fuelRanges.forEach((fr, i) => {
    const tr = document.createElement('tr');
    const endDate = fr.end_date || calculateSunday(fr.start_date);
    tr.innerHTML = `
      <td><input type="date" class="table-input fuel-start" data-index="${i}" value="${fr.start_date || ''}" title="Select Monday" /></td>
      <td><input type="date" class="table-input fuel-end" data-index="${i}" value="${endDate}" readonly style="background: #f0f0f0; cursor: not-allowed;" title="Auto-calculated Sunday" /></td>
      <td><input type="number" class="table-input fuel-pct" data-index="${i}" value="${fr.percentage || 0}" min="0" max="100" /></td>
      <td class="text-center"><button class="btn-remove-small" data-type="fuel" data-index="${i}">×</button></td>
    `;
    
    // Add change listener to auto-calculate Sunday when Monday is changed
    const startInput = tr.querySelector('.fuel-start');
    const endInput = tr.querySelector('.fuel-end');
    startInput.addEventListener('change', () => {
      endInput.value = calculateSunday(startInput.value);
    });
    
    container.appendChild(tr);
  });
}

function collectFuelSurcharge(data) {
  const container = document.getElementById('fuel-list');
  const rows = Array.from(container.querySelectorAll('tr'));
  
  const dateRanges = rows.map(tr => {
    const startDate = tr.querySelector('.fuel-start').value;
    return {
      start_date: startDate,
      end_date: calculateSunday(startDate),
      percentage: parseFloat(tr.querySelector('.fuel-pct').value) || 0
    };
  }).filter(fr => fr.start_date);
  
  data.fuel_surcharge = { date_ranges: dateRanges };
}

// ============================================
// Customer Pricing
// ============================================

function renderCustomers(data) {
  const container = document.getElementById('customer-list');
  container.innerHTML = '';
  const customers = data.customers || [];
  
  customers.forEach((customer, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" class="table-input customer-name" data-index="${i}" value="${escapeHtml(customer.name || '')}" placeholder="Customer name from TMS" /></td>
      <td><input type="number" class="table-input customer-base-markup" data-index="${i}" value="${customer.base_markup || 0}" step="0.1" min="0" max="1000" /></td>
      <td><input type="number" class="table-input customer-fixed-markup" data-index="${i}" value="${customer.fixed_markup || 0}" step="0.1" min="0" max="1000" /></td>
      <td><input type="number" class="table-input customer-zone-markup" data-index="${i}" value="${customer.zone_markup || 0}" step="0.1" min="0" max="1000" /></td>
      <td><input type="number" class="table-input customer-demand-markup" data-index="${i}" value="${customer.demand_markup || 0}" step="0.1" min="0" max="1000" /></td>
      <td><input type="number" class="table-input customer-fuel-markup" data-index="${i}" value="${customer.fuel_markup || 0}" step="0.1" min="0" max="1000" /></td>
      <td><input type="text" class="table-input customer-remark" data-index="${i}" value="${escapeHtml(customer.remark || '')}" placeholder="Optional note" /></td>
      <td class="text-center"><button class="btn-remove-small" data-type="customer" data-index="${i}">×</button></td>
    `;
    container.appendChild(tr);
  });
}

function collectCustomers() {
  const container = document.getElementById('customer-list');
  const rows = Array.from(container.querySelectorAll('tr'));
  
  const customers = rows.map(tr => ({
    name: tr.querySelector('.customer-name').value.trim(),
    base_markup: parseFloat(tr.querySelector('.customer-base-markup').value) || 0,
    fixed_markup: parseFloat(tr.querySelector('.customer-fixed-markup').value) || 0,
    zone_markup: parseFloat(tr.querySelector('.customer-zone-markup').value) || 0,
    demand_markup: parseFloat(tr.querySelector('.customer-demand-markup').value) || 0,
    fuel_markup: parseFloat(tr.querySelector('.customer-fuel-markup').value) || 0,
    remark: tr.querySelector('.customer-remark').value.trim()
  })).filter(c => c.name);
  
  return { customers };
}

// ============================================
// Invoice Verification
// ============================================

async function handleInvoiceUpload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet);
        resolve(jsonData);
      } catch (err) {
        reject(err);
      }
    };
    
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

async function analyzeInvoice(invoiceRows, filename) {
  const res = await fetch('/api/verify', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({rows: invoiceRows, original_filename: filename})
  });
  return res.json();
}

function renderAnalysisResults(container, results) {
  if (!results || !results.results) {
    container.innerHTML = '<p>No results to display.</p>';
    return;
  }
  
  // Store results globally for export
  analysisResults = results;
  
  const data = results.results;
  const tmsComparison = results.tms_comparison || [];
  
  // Show export button if there are mismatches
  const unmatchedCount = data.filter(r => r.status === 'mismatch' || r.status === 'error' || r.status === 'Mixed Address' || r.status === 'MultiWeight').length;
  
  // Filter out error rows for stats
  const validRows = data.filter(r => r.status !== 'error' && r.actual_charge !== undefined);
  const errorRows = data.filter(r => r.status === 'error');
  
  const matchCount = validRows.filter(r => r.status === 'match').length;
  const mismatchCount = validRows.filter(r => r.status === 'mismatch').length;
  const mixedAddressCount = validRows.filter(r => r.status === 'Mixed Address').length;
  const multiWeightCount = validRows.filter(r => r.status === 'MultiWeight').length;
  
  const totalActual = validRows.reduce((sum, r) => sum + (r.actual_charge || 0), 0);
  const totalExpected = validRows.reduce((sum, r) => sum + (r.expected_charge || 0), 0);
  const totalDiff = validRows.reduce((sum, r) => sum + Math.abs(r.difference || 0), 0);
  
  let errorSection = '';
  if (errorRows.length > 0) {
    errorSection = `
      <div class="error-message">
        <strong>⚠️ ${errorRows.length} row(s) had errors:</strong><br>
        ${errorRows.map(r => `${r.tracking_id}: ${r.error || 'Unknown error'}`).join('<br>')}
      </div>
    `;
  }
  
  container.innerHTML = `
    ${errorSection}


    <div class="result-summary">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h3 style="margin: 0;">Verification Summary</h3>
        <div style="display: flex; align-items: center; gap: 10px;">
          <button id="export-mismatches-btn" class="btn-secondary" style="display: ${unmatchedCount > 0 ? 'inline-block' : 'none'};">📥 Export Mismatches</button>
        </div>
      </div>
      <div class="result-stats">
        <div class="stat">
          <span class="stat-label">Total Rows</span>
          <span class="stat-value">${data.length}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Matches</span>
          <span class="stat-value match">${matchCount}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Mismatches</span>
          <span class="stat-value mismatch">${mismatchCount}</span>
        </div>
        ${mixedAddressCount > 0 ? `
        <div class="stat">
          <span class="stat-label">Mixed Address</span>
          <span class="stat-value" style="color: #ff9800;">${mixedAddressCount}</span>
        </div>
        ` : ''}
        ${multiWeightCount > 0 ? `
        <div class="stat">
          <span class="stat-label">MultiWeight</span>
          <span class="stat-value" style="color: #2196f3;">${multiWeightCount}</span>
        </div>
        ` : ''}
        ${errorRows.length > 0 ? `
        <div class="stat">
          <span class="stat-label">Errors</span>
          <span class="stat-value" style="color: #ff6b6b;">${errorRows.length}</span>
        </div>
        ` : ''}
        <div class="stat">
          <span class="stat-label">Total Actual</span>
          <span class="stat-value">$${totalActual.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Total Expected</span>
          <span class="stat-value">$${totalExpected.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Total Difference</span>
          <span class="stat-value ${totalDiff > 0 ? 'mismatch' : 'match'}">$${totalDiff.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
        </div>
      </div>
    </div>

    
    <div class="result-table">
      <h3>FedEx Invoice Verification - Mismatches Only</h3>
      <div class="fedex-verification-wrapper">
        <table class="fedex-verification-table">
        <thead>
          <tr>
            <th>Invoice Number</th>
            <th>Tracking ID</th>
            <th>Zone</th>
            <th>Weight (lbs)</th>
            <th>Status</th>
            <th>Actual Charge</th>
            <th>Expected Charge</th>
            <th>Difference</th>
            <th>Breakdown</th>
          </tr>
        </thead>
        <tbody>
          ${data.filter(row => row.status === 'mismatch' || row.status === 'error' || row.status === 'Mixed Address' || row.status === 'MultiWeight').map(row => {
            if (row.status === 'error') {
              return `
                <tr style="background: #fff3cd;">
                  <td>${row.invoice_number || 'N/A'}</td>
                  <td>${row.tracking_id}</td>
                  <td colspan="7" style="color: #856404;">
                    <strong>Error:</strong> ${row.error || 'Unknown error'}
                  </td>
                </tr>
              `;
            }
            
            return `
              <tr>
                <td>${row.invoice_number || 'N/A'}</td>
                <td>${row.tracking_id || 'N/A'}</td>
                <td>${row.zone || 'N/A'}</td>
                <td>${(row.rated_weight || 0).toFixed(1)}</td>
                <td><span class="status-badge ${row.status}">${row.status}</span></td>
                <td>$${(row.actual_charge || 0).toFixed(2)}</td>
                <td>$${(row.expected_charge || 0).toFixed(2)}</td>
                <td style="color: ${(row.difference || 0) > 0 ? '#dc3545' : (row.difference || 0) < 0 ? '#28a745' : '#666'}">
                  ${(row.difference || 0) > 0 ? '+' : ''}$${(row.difference || 0).toFixed(2)}
                </td>
                <td>
                  ${row.breakdown && row.breakdown.length > 0 ? `
                    <table class="breakdown-table">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Actual</th>
                          <th>Expected</th>
                          <th>Diff</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${row.breakdown.map(b => `
                          <tr>
                            <td>${b.type}</td>
                            <td>$${(b.actual || 0).toFixed(2)}</td>
                            <td>$${(b.expected || 0).toFixed(2)}</td>
                            <td style="color: ${(b.difference || 0) > 0 ? '#dc3545' : (b.difference || 0) < 0 ? '#28a745' : '#666'}">
                              ${(b.difference || 0) > 0 ? '+' : ''}$${(b.difference || 0).toFixed(2)}
                            </td>
                          </tr>
                        `).join('')}
                      </tbody>
                    </table>
                  ` : '<em>No breakdown available</em>'}
                </td>
              </tr>
            `;
          }).join('')}
          ${data.filter(row => row.status === 'mismatch' || row.status === 'error' || row.status === 'Mixed Address' || row.status === 'MultiWeight').length === 0 ? 
            '<tr><td colspan="9" style="text-align: center; padding: 20px; color: #28a745; font-weight: 600;">✓ All invoices match! No discrepancies found.</td></tr>' : ''}
        </tbody>
      </table>
      </div>
    </div>
    
    ${tmsComparison.length > 0 ? `
    <div class="result-table" style="margin-top: 40px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div style="flex-grow: 1;">
          <h3 style="margin: 0;">TMS Customer Pricing Comparison - Per Tracking Number (${tmsComparison.length} bills)</h3>
        </div>
        <div style="display: flex; gap: 10px; align-items: center;">
          <label for="customer-filter" style="font-weight: 600;">Filter by Customer:</label>
          <select id="customer-filter" class="form-control" style="width: 200px;">
            <option value="all">All Customers</option>
            ${results.customers.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
            ${results.unfound_in_tms && results.unfound_in_tms.length > 0 ? 
              '<option value="unfound">Not Found in TMS (' + results.unfound_in_tms.length + ')</option>' : ''}
          </select>
          <button id="export-customer-btn" class="btn-secondary">📥 Export Customer Reports</button>
        </div>
      </div>
      <div class="tms-table-wrapper">
        <table class="tms-comparison-table">
          <thead>
            <tr>
              <th>Tracking ID</th>
              <th>Customer</th>
              <th>Zone</th>
              <th>Weight (lbs)</th>
              <th>FedEx Charge</th>
              <th>We Should Charge</th>
              <th>TMS API Cost (avg)</th>
              <th>TMS Charged (avg)</th>
              <th>Adjustment</th>
              <th>Ship Date</th>
              <th>Dimensions</th>
              <th>Service Type</th>
              <th>Ground Service</th>
              <th>POD Delivery Date</th>
            </tr>
          </thead>
          <tbody id="tms-comparison-tbody">
            ${tmsComparison.map((row, idx) => {
              // Use backend-calculated per-child TMS values directly
              const tmsApiCost = row.tms_api_cost !== undefined && row.tms_api_cost !== null ? row.tms_api_cost : '';
              const tmsCharged = row.tms_charged !== undefined && row.tms_charged !== null ? row.tms_charged : '';
              const weShouldCharge = row.expected_customer_charge !== undefined && row.expected_customer_charge !== null ? row.expected_customer_charge : '';
              const adjustment = (weShouldCharge !== '' && tmsCharged !== '') ? (weShouldCharge - tmsCharged) : '';
              return `
                <tr data-customer="${escapeHtml(row.customer || 'Unknown')}">
                  <td>${row.tracking_id || 'N/A'}</td>
                  <td>${row.customer || 'N/A'}</td>
                  <td style="text-align: center;">${row.zone || 'N/A'}</td>
                  <td style="text-align: right;">${(row.actual_weight || 0).toFixed(1)}</td>
                  <td style="text-align: right;">$${(row.actual_charge || 0).toFixed(2)}</td>
                  <td style="text-align: right;">${weShouldCharge !== '' ? `$${Number(weShouldCharge).toFixed(2)}` : ''}</td>
                  <td style="text-align: right;">${tmsApiCost !== '' ? `$${Number(tmsApiCost).toFixed(2)}` : ''}</td>
                  <td style="text-align: right;">${tmsCharged !== '' ? `$${Number(tmsCharged).toFixed(2)}` : ''}</td>
                  <td style="text-align: right;">${adjustment !== '' ? `$${Number(adjustment).toFixed(2)}` : ''}</td>
                  <td>${row.ship_date || 'N/A'}</td>
                  <td>${row.dimensions || 'N/A'}</td>
                  <td>${row.service_type || 'N/A'}</td>
                  <td>${row.ground_service || 'N/A'}</td>
                  <td>${row.pod_date || 'N/A'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      
      ${results.unfound_in_tms && results.unfound_in_tms.length > 0 ? `
      <div id="unfound-tms-section" style="margin-top: 30px;">
        <h3 style="margin-bottom: 12px; color: #dc3545;">⚠️ Not Found in TMS (${results.unfound_in_tms.length} records)</h3>
        <p style="color: #666; margin-bottom: 16px;">These FedEx tracking numbers were not found in the TMS database. They may need to be added manually.</p>
        <table class="tms-comparison-table">
          <thead>
            <tr>
              <th>Tracking ID</th>
              <th>Master Tracking</th>
              <th>Zone</th>
              <th>Weight (lbs)</th>
              <th>FedEx Charge</th>
              <th>Ship Date</th>
              <th>Service Type</th>
            </tr>
          </thead>
          <tbody>
            ${results.unfound_in_tms.map(record => `
              <tr>
                <td>${record.tracking_id || 'N/A'}</td>
                <td>${(record.TDMasterTrackingID || '').replace(/^'/, '') || 'N/A'}</td>
                <td style="text-align: center;">${record.zone || 'N/A'}</td>
                <td style="text-align: right;">${(record.actual_weight || 0).toFixed(1)}</td>
                <td style="text-align: right;">$${(record.charge || 0).toFixed(2)}</td>
                <td>${record.ship_date || 'N/A'}</td>
                <td>${record.service_type || 'N/A'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ` : ''}
    </div>
    ` : '<div class="result-summary" style="margin-top: 40px; padding: 20px; background: #f5f5f5; border-radius: 8px;"><p style="margin: 0; color: #666;">ℹ️ No TMS data found for these tracking numbers.</p></div>'}
  `;
  
  // Add event listener to export button (now that it exists)
  const exportMismatchBtn = document.getElementById('export-mismatches-btn');
  if (exportMismatchBtn) {
    exportMismatchBtn.addEventListener('click', exportMismatchesToExcel);
  }
  
  // Add event listener to customer filter
  const customerFilter = document.getElementById('customer-filter');
  if (customerFilter) {
    customerFilter.addEventListener('change', () => filterTMSComparisonByCustomer(customerFilter.value));
  }
  
  // Add event listener to export customer button
  const exportCustomerBtn = document.getElementById('export-customer-btn');
  if (exportCustomerBtn) {
    exportCustomerBtn.addEventListener('click', () => {
      exportCustomerAdjustments();
    });
  }
}

function filterTMSComparisonByCustomer(selectedCustomer) {
  const tbody = document.getElementById('tms-comparison-tbody');
  if (!tbody) return;
  
  const rows = tbody.querySelectorAll('tr');
  
  rows.forEach(row => {
    const customer = row.dataset.customer;
    if (selectedCustomer === 'all') {
      row.style.display = '';
    } else if (selectedCustomer === 'unfound') {
      row.style.display = 'none';  // Hide all TMS rows when showing unfound
    } else {
      row.style.display = customer === selectedCustomer ? '' : 'none';
    }
  });
  
  // Show unfound section if selected
  const unfoundSection = document.getElementById('unfound-tms-section');
  if (unfoundSection) {
    unfoundSection.style.display = selectedCustomer === 'unfound' || selectedCustomer === 'all' ? '' : 'none';
  }
}

async function exportCustomerAdjustments() {
  console.log('Export Customer Adjustments clicked');
  console.log('analysisResults:', analysisResults);
  
  if (!analysisResults || !analysisResults.tms_comparison) {
    alert('No data available to export. Please run verification first.');
    return;
  }
  
  if (analysisResults.tms_comparison.length === 0) {
    alert('No TMS comparison data to export.');
    return;
  }
  
  // Create or get status div
  let statusDiv = document.getElementById('export-status-customer');
  if (!statusDiv) {
    statusDiv = document.createElement('div');
    statusDiv.id = 'export-status-customer';
    statusDiv.style.marginTop = '10px';
    const btn = document.getElementById('export-customer-btn');
    if (btn && btn.parentNode) btn.parentNode.appendChild(statusDiv);
  }
  statusDiv.innerHTML = '<span style="color: #1976d2;">⏳ Preparing export...</span>';
  
  // Gather export data - send minimal payload, server uses cached data
  const totalRows = analysisResults.tms_comparison.length + (analysisResults.unfound_in_tms ? analysisResults.unfound_in_tms.length : 0);
  console.log('Total rows to export:', totalRows);
  
  // Only send minimal data - server will use cached analysis results
  const exportData = {
    use_cache: true,
    original_filename: uploadedFileName,
    row_count: totalRows
  };
  
  // Start export job
  try {
    statusDiv.innerHTML = '<span style="color: #1976d2;">⏳ Starting export for ' + totalRows + ' records...</span>';
    
    const res = await fetch('/api/export_customer_adjustments', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(exportData)
    });
    const job = await res.json();
    if (!job.job_id) {
      statusDiv.innerHTML = '<span style="color: #d32f2f;">✗ Export failed: ' + (job.error || 'Unknown error') + '</span>';
      statusDiv.style.background = '#ffebee';
      statusDiv.style.padding = '10px';
      statusDiv.style.borderRadius = '4px';
      return;
    }
    
    statusDiv.innerHTML = '<span style="color: #1976d2;">⏳ Generating Excel file...</span>';
    
    // Poll for status
    function poll() {
      fetch('/api/export_status/' + job.job_id)
        .then(res => res.json())
        .then(status => {
          if (status.status === 'done') {
            statusDiv.innerHTML = '✓ Adjustment export completed! Go to <a href="#" onclick="document.querySelector(\'.nav-item[data-tab=downloads]\').click(); return false;" style="color: #2196F3; font-weight: bold;">Download Center</a> to download the file.';
            statusDiv.style.background = '#e8f5e9';
            statusDiv.style.padding = '10px';
            statusDiv.style.borderRadius = '4px';
            // Refresh download center if on that tab
            if (document.getElementById('downloads-tab').style.display !== 'none') {
              loadDownloadCenter();
            }
          } else if (status.status === 'error') {
            statusDiv.innerHTML = '✗ Export failed: ' + status.error;
            statusDiv.style.background = '#ffebee';
            statusDiv.style.padding = '10px';
            statusDiv.style.borderRadius = '4px';
          } else {
            setTimeout(poll, 2000);
          }
        });
    }
    poll();
  } catch (error) {
    statusDiv.innerHTML = 'Error exporting customer adjustments: ' + error.message;
    console.error('Error exporting customer adjustments:', error);
  }
}

// ============================================
// Export Rates and Surcharges
// ============================================

function exportRatesAndSurcharges() {
  const wb = XLSX.utils.book_new();
  
  // Use currentVersion if available, otherwise use active version from appData
  const dataToExport = currentVersion || (appData.rate_versions && appData.rate_versions.find(v => v.version_id === appData.active_version_id)) || appData;
  
  if (!dataToExport.base_table) {
    alert('Error: No rate data available to export');
    return;
  }
  
  // 1. Export Base Rates
  const baseRates = [];
  const zones = dataToExport.base_table.zones;
  const lbs = dataToExport.base_table.lbs;
  const rates = dataToExport.base_table.rates;
  
  // Header row
  const headerRow = ['Weight (lbs)', ...zones];
  baseRates.push(headerRow);
  
  // Data rows
  lbs.forEach((lb, idx) => {
    const row = [lb];
    zones.forEach((zone, zIdx) => {
      const rate = rates[idx] && rates[idx][zIdx];
      row.push(rate || '');
    });
    baseRates.push(row);
  });
  
  const wsBase = XLSX.utils.aoa_to_sheet(baseRates);
  wsBase['!cols'] = [{wch: 12}, ...zones.map(() => ({wch: 10}))];
  XLSX.utils.book_append_sheet(wb, wsBase, 'Base Rates');
  
  // 2. Export Fixed Surcharges
  const fixedData = (dataToExport.fixed_surcharges || []).map(s => ({
    'Description': s.description || '',
    'Amount ($)': s.amount || 0,
    'Remark': s.remark || ''
  }));
  if (fixedData.length > 0) {
    const wsFixed = XLSX.utils.json_to_sheet(fixedData);
    wsFixed['!cols'] = [{wch: 35}, {wch: 12}, {wch: 40}];
    XLSX.utils.book_append_sheet(wb, wsFixed, 'Fixed Surcharges');
  }
  
  // 3. Export Zone-Based Surcharges
  const zoneData = (dataToExport.zone_based_surcharges || []).map(s => {
    const row = {'Description': s.description || ''};
    [2, 3, 4, 5, 6, 7, 8].forEach(z => {
      row[`Zone ${z}`] = (s.zone_rates && s.zone_rates[z]) || '';
    });
    row['Remark'] = s.remark || '';
    return row;
  });
  if (zoneData.length > 0) {
    const wsZone = XLSX.utils.json_to_sheet(zoneData);
    wsZone['!cols'] = [{wch: 25}, ...Array(7).fill({wch: 10}), {wch: 25}];
    XLSX.utils.book_append_sheet(wb, wsZone, 'Zone Surcharges');
  }
  
  // 4. Export Demand Surcharges (with date ranges for invoice verification)
  const demandData = (dataToExport.demand_surcharges || []).map(s => ({
    'Description': s.description || '',
    'Triggered By': s.triggered_by || '',
    'Date Ranges': (s.date_ranges || []).map(dr => 
      `${dr.start_date || ''} to ${dr.end_date || ''}: $${dr.amount || 0}`
    ).join('\n'),
    'Remark': s.remark || ''
  }));
  if (demandData.length > 0) {
    const wsDemand = XLSX.utils.json_to_sheet(demandData);
    wsDemand['!cols'] = [{wch: 25}, {wch: 15}, {wch: 40}, {wch: 25}];
    XLSX.utils.book_append_sheet(wb, wsDemand, 'Demand Surcharges');
  }
  
  // 5. Export Fuel Surcharge
  const fuelData = (dataToExport.fuel_surcharge?.date_ranges || []).map(fr => ({
    'Week Starting (Monday)': fr.start_date || '',
    'Week Ending (Sunday)': fr.end_date || '',
    'Percentage (%)': fr.percentage || 0
  }));
  if (fuelData.length > 0) {
    const wsFuel = XLSX.utils.json_to_sheet(fuelData);
    wsFuel['!cols'] = [{wch: 20}, {wch: 20}, {wch: 15}];
    XLSX.utils.book_append_sheet(wb, wsFuel, 'Fuel Surcharge');
  }
  
  // Generate filename with timestamp and version info
  const timestamp = new Date().toISOString().slice(0, 10);
  const versionName = dataToExport.version_name || 'Current';
  const filename = `FedEx_Rates_${versionName.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.xlsx`;
  
  // Download file
  XLSX.writeFile(wb, filename);
  alert('✓ Rates and surcharges exported successfully!');
}

// ============================================
// Event Handlers
// ============================================

function safeAddEventListener(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

function setupEventHandlers() {
  // Helper to get the current working data (currentVersion or appData)
  const getWorkingData = () => currentVersion || appData;
  const setWorkingData = (data) => { if (currentVersion) currentVersion = data; else appData = data; };
  
  // Fixed surcharges
  safeAddEventListener('add-fixed', 'click', () => {
    const data = getWorkingData();
    collectFixedSurcharges(document.getElementById('fixed-list'), data);
    data.fixed_surcharges = data.fixed_surcharges || [];
    data.fixed_surcharges.push({
      description: '',
      amount: 0,
      remark: '',
      enabled: true
    });
    renderFixedSurcharges(document.getElementById('fixed-list'), data);
  });

  const fixedList = document.getElementById('fixed-list');
  if (fixedList) {
    fixedList.addEventListener('click', (e) => {
      const data = getWorkingData();
      if (e.target.classList.contains('btn-remove-small')) {
        collectFixedSurcharges(fixedList, data);
        const idx = parseInt(e.target.dataset.index, 10);
        data.fixed_surcharges.splice(idx, 1);
        renderFixedSurcharges(fixedList, data);
      }
      if (e.target.classList.contains('btn-move-up')) {
        collectFixedSurcharges(fixedList, data);
        const idx = parseInt(e.target.dataset.index, 10);
        if (idx > 0) {
          moveArrayItem(data.fixed_surcharges, idx, idx - 1);
          renderFixedSurcharges(fixedList, data);
        }
      }
      if (e.target.classList.contains('btn-move-down')) {
        collectFixedSurcharges(fixedList, data);
        const idx = parseInt(e.target.dataset.index, 10);
        if (idx < data.fixed_surcharges.length - 1) {
          moveArrayItem(data.fixed_surcharges, idx, idx + 1);
          renderFixedSurcharges(fixedList, data);
        }
      }
    });
  }
  
  // Zone-based surcharges
  safeAddEventListener('add-zone', 'click', () => {
    const data = getWorkingData();
    collectZoneSurcharges(document.getElementById('zone-list'), data);
    data.zone_based_surcharges = data.zone_based_surcharges || [];
    data.zone_based_surcharges.push({
      description: '',
      zone_rates: {},
      remark: '',
      enabled: true
    });
    renderZoneSurcharges(document.getElementById('zone-list'), data);
  });
  
  const zoneList = document.getElementById('zone-list');
  if (zoneList) {
    zoneList.addEventListener('click', (e) => {
      const data = getWorkingData();
      if (e.target.classList.contains('btn-remove-small')) {
        collectZoneSurcharges(zoneList, data);
        const idx = parseInt(e.target.dataset.index, 10);
        data.zone_based_surcharges.splice(idx, 1);
        renderZoneSurcharges(zoneList, data);
      }
      if (e.target.classList.contains('btn-move-up')) {
        collectZoneSurcharges(zoneList, data);
        const idx = parseInt(e.target.dataset.index, 10);
        if (idx > 0) {
          moveArrayItem(data.zone_based_surcharges, idx, idx - 1);
          renderZoneSurcharges(zoneList, data);
        }
      }
      if (e.target.classList.contains('btn-move-down')) {
        collectZoneSurcharges(zoneList, data);
        const idx = parseInt(e.target.dataset.index, 10);
        if (idx < data.zone_based_surcharges.length - 1) {
          moveArrayItem(data.zone_based_surcharges, idx, idx + 1);
          renderZoneSurcharges(zoneList, data);
        }
      }
    });
  }
  
  // Demand surcharges (FedEx Contract - with date ranges)
  safeAddEventListener('add-demand', 'click', () => {
    const data = getWorkingData();
    collectDemandSurcharges(document.getElementById('demand-list'), data);
    data.demand_surcharges = data.demand_surcharges || [];
    data.demand_surcharges.push({
      description: '',
      triggered_by: '',
      date_ranges: [],
      remark: '',
      enabled: true
    });
    renderDemandSurcharges(document.getElementById('demand-list'), data);
  });
  
  const demandList = document.getElementById('demand-list');
  if (demandList) {
    demandList.addEventListener('click', (e) => {
      const data = getWorkingData();
      
      if (e.target.classList.contains('btn-remove-small') && e.target.dataset.type === 'demand') {
        collectDemandSurcharges(demandList, data);
        const idx = parseInt(e.target.dataset.index, 10);
        data.demand_surcharges.splice(idx, 1);
        renderDemandSurcharges(demandList, data);
      }
      
      if (e.target.classList.contains('btn-add-tiny')) {
        collectDemandSurcharges(demandList, data);
        const idx = parseInt(e.target.dataset.index, 10);
        data.demand_surcharges[idx].date_ranges = data.demand_surcharges[idx].date_ranges || [];
        data.demand_surcharges[idx].date_ranges.push({
          start_date: '',
          end_date: '',
          amount: 0
        });
        renderDemandSurcharges(demandList, data);
      }
      
      if (e.target.classList.contains('btn-remove-tiny')) {
        collectDemandSurcharges(demandList, data);
        const scIdx = parseInt(e.target.dataset.scIndex, 10);
        const drIdx = parseInt(e.target.dataset.drIndex, 10);
        data.demand_surcharges[scIdx].date_ranges.splice(drIdx, 1);
        renderDemandSurcharges(demandList, data);
      }
    });
  }
  
  // Fuel surcharge
  safeAddEventListener('add-fuel-range', 'click', () => {
    collectFuelSurcharge(appData);
    appData.fuel_surcharge = appData.fuel_surcharge || { date_ranges: [] };
    appData.fuel_surcharge.date_ranges = appData.fuel_surcharge.date_ranges || [];
    appData.fuel_surcharge.date_ranges.push({
      start_date: '',
      end_date: '',
      percentage: 0,
      remark: ''
    });
    renderFuelSurcharge(appData);
  });
  
  const fuelList = document.getElementById('fuel-list');
  if (fuelList) {
    fuelList.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-remove-small')) {
        collectFuelSurcharge(appData);
        const idx = parseInt(e.target.dataset.index, 10);
        appData.fuel_surcharge.date_ranges.splice(idx, 1);
        renderFuelSurcharge(appData);
      }
    });
  }
  
  // Invoice verification
  safeAddEventListener('verify-btn', 'click', async () => {
    const fileInput = document.getElementById('invoice-file');
    const file = fileInput.files[0];
    
    if (!file) {
      alert('Please select a file first.');
      return;
    }
    
    // Store original filename
    uploadedFileName = file.name;
    
    // Prevent multiple simultaneous verifications
    if (isVerifying) {
      alert('Verification already in progress. Please wait...');
      return;
    }
    
    try {
      isVerifying = true;
      document.getElementById('verify-btn').disabled = true;
      document.getElementById('verify-btn').textContent = 'Processing...';
      
      // Clear previous results immediately
      document.getElementById('verification-results').innerHTML = '<p>Processing invoice...</p>';
      
      console.log('Reading file:', file.name);
      const invoiceData = await handleInvoiceUpload(file);
      console.log('Parsed rows:', invoiceData.length);
      console.log('First row sample:', invoiceData[0]);
      
      // Store original invoice data and filename for export
      originalInvoiceData = invoiceData;
      originalFilename = file.name;
      
      if (!invoiceData || invoiceData.length === 0) {
        alert('No data found in the file. Please check the file format.');
        return;
      }
      
      console.log('Sending to verify API...');
      const results = await analyzeInvoice(invoiceData, file.name);
      console.log('Analysis results:', results);
      
      if (results.error) {
        alert('Error: ' + results.error);
        document.getElementById('verification-results').innerHTML = 
          `<div class="error-message">Error: ${results.error}</div>`;
        return;
      }
      
      renderAnalysisResults(document.getElementById('verification-results'), results);
      
      // Clear the file input so user can select the same file again if needed
      fileInput.value = '';
      
    } catch (err) {
      alert('Error processing invoice: ' + err.message);
      console.error('Full error:', err);
      document.getElementById('verification-results').innerHTML = 
        `<div class="error-message">Error: ${err.message}<br><br>Check browser console for details.</div>`;
    } finally {
      isVerifying = false;
      document.getElementById('verify-btn').disabled = false;
      document.getElementById('verify-btn').textContent = 'Analyze Invoice';
    }
  });
  
  // Clear results button
  safeAddEventListener('clear-results-btn', 'click', () => {
    document.getElementById('verification-results').innerHTML = '';
    document.getElementById('invoice-file').value = '';
    analysisResults = null;
    originalInvoiceData = null;
    const exportBtn = document.getElementById('export-mismatches-btn');
    if (exportBtn) exportBtn.style.display = 'none';
  });

  // TMS Upload button
  safeAddEventListener('tms-upload-btn', 'click', async () => {
    const fileInput = document.getElementById('tms-upload-file');
    const statusDiv = document.getElementById('tms-upload-status');
    const file = fileInput.files[0];
    
    if (!file) {
      alert('请先选择TMS导出文件');
      return;
    }
    
    // Validate file extension
    if (!file.name.toLowerCase().endsWith('.xlsx') && !file.name.toLowerCase().endsWith('.xls')) {
      alert('只支持 Excel 文件 (.xlsx, .xls)');
      return;
    }
    
    try {
      const uploadBtn = document.getElementById('tms-upload-btn');
      uploadBtn.disabled = true;
      uploadBtn.textContent = '上传中...';
      statusDiv.innerHTML = '<p style="color: #2563eb;">正在上传并处理文件...</p>';
      
      // Create FormData to upload file
      const formData = new FormData();
      formData.append('file', file);
      
      console.log('Uploading TMS file:', file.name);
      
      const response = await fetch('/api/upload_tms', {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Upload failed');
      }
      
      console.log('TMS upload result:', result);
      
      // Display success message
      statusDiv.innerHTML = `
        <div style="padding: 16px; background: #dcfce7; border: 1px solid #86efac; border-radius: 8px;">
          <h4 style="margin: 0 0 8px 0; color: #166534;">✓ 上传成功</h4>
          <p style="margin: 4px 0; color: #166534;">已解析记录: ${result.stats.parsed}</p>
          <p style="margin: 4px 0; color: #166534;">已插入记录: ${result.stats.inserted}</p>
          <p style="margin: 4px 0; color: #166534;">数据库总记录数: ${result.stats.total_in_db}</p>
          <p style="margin: 4px 0; color: #166534;">唯一追踪号数: ${result.stats.unique_tracking}</p>
        </div>
      `;
      
      // Clear file input
      fileInput.value = '';
      
    } catch (err) {
      console.error('TMS upload error:', err);
      statusDiv.innerHTML = `
        <div style="padding: 16px; background: #fee2e2; border: 1px solid #fca5a5; border-radius: 8px;">
          <h4 style="margin: 0 0 8px 0; color: #991b1b;">✗ 上传失败</h4>
          <p style="margin: 0; color: #991b1b;">${err.message}</p>
        </div>
      `;
    } finally {
      const uploadBtn = document.getElementById('tms-upload-btn');
      uploadBtn.disabled = false;
      uploadBtn.textContent = '📤 上传 TMS 记录';
    }
  });

  // TMS Clear button
  safeAddEventListener('tms-clear-btn', 'click', () => {
    document.getElementById('tms-upload-file').value = '';
    document.getElementById('tms-upload-status').innerHTML = '';
  });
  
  // Save and Load
  safeAddEventListener('save', 'click', async () => {
    try {
      const data = currentVersion || appData;
      
      collectBaseTable(document.getElementById('base-table-wrap'), data);
      collectFixedSurcharges(document.getElementById('fixed-list'), data);
      collectZoneSurcharges(document.getElementById('zone-list'), data);
      collectDemandSurcharges(document.getElementById('demand-list'), data);
      collectFuelSurcharge(data);
      
      // Save the current version or entire appData
      if (currentVersion) {
        await saveVersion(currentVersion.version_id, currentVersion);
        // Also set as active version
        await setActiveVersion(currentVersion.version_id);
        // Reload full data
        appData = await getData();
      } else {
        await saveData(appData);
      }
      
      alert('✓ All data saved successfully!');
    } catch (err) {
      alert('Error saving data: ' + err.message);
      console.error(err);
    }
  });
  
  safeAddEventListener('export-rates', 'click', () => {
    try {
      exportRatesAndSurcharges();
    } catch (err) {
      alert('Error exporting data: ' + err.message);
      console.error(err);
    }
  });

  // Customer pricing
  safeAddEventListener('add-customer', 'click', () => {
    customerData.customers = customerData.customers || [];
    customerData.customers.push({
      name: '',
      base_markup: 0,
      fixed_markup: 0,
      zone_markup: 0,
      demand_markup: 0,
      fuel_markup: 0,
      remark: ''
    });
    renderCustomers(customerData);
  });

  const customerList = document.getElementById('customer-list');
  if (customerList) {
    customerList.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-remove-small')) {
        const currentData = collectCustomers();
        customerData = currentData;
        const idx = parseInt(e.target.dataset.index, 10);
        customerData.customers.splice(idx, 1);
        renderCustomers(customerData);
      }
    });
  }

  safeAddEventListener('save-customers', 'click', async () => {
    try {
      customerData = collectCustomers();
      await saveCustomerData(customerData);
      alert('✓ Customer pricing saved successfully!');
    } catch (err) {
      alert('Error saving customer pricing: ' + err.message);
      console.error(err);
    }
  });

}


async function exportMismatchesToExcel() {
  if (!analysisResults || !analysisResults.results || !originalInvoiceData) {
    alert('No results to export');
    return;
  }
  
  const data = analysisResults.results;
  const unmatched = data.filter(r => r.status === 'mismatch' || r.status === 'error' || r.status === 'Mixed Address' || r.status === 'MultiWeight');
  
  if (unmatched.length === 0) {
    alert('No mismatches to export');
    return;
  }
  
  // Show status message
  let statusDiv = document.getElementById('export-status-mismatch');
  if (!statusDiv) {
    statusDiv = document.createElement('div');
    statusDiv.id = 'export-status-mismatch';
    statusDiv.style.padding = '10px';
    statusDiv.style.background = '#e3f2fd';
    statusDiv.style.borderRadius = '4px';
    statusDiv.style.whiteSpace = 'nowrap';
    const btn = document.getElementById('export-mismatches-btn');
    if (btn && btn.parentNode) btn.parentNode.appendChild(statusDiv);
  }
  statusDiv.innerHTML = 'Preparing mismatch export...';
  
  // Build export data: Add Type, Actual Charge, Expected Charge, Difference, and Breakdown columns to the front
  const exportData = unmatched.map(result => {
    // Find the original row by tracking ID
    const originalRow = originalInvoiceData.find(r => 
      r['Express or Ground Tracking ID'] === result.tracking_id
    );
    if (!originalRow) {
      console.warn('Original row not found for tracking ID:', result.tracking_id);
      return null;
    }
    // Build breakdown strings
    const breakdownTypes = [];
    const breakdownActual = [];
    const breakdownExpected = [];
    const breakdownDiff = [];
    if (result.breakdown && result.breakdown.length > 0) {
      result.breakdown.forEach(b => {
        breakdownTypes.push(b.type || '');
        breakdownActual.push('$' + (b.actual || 0).toFixed(2));
        breakdownExpected.push('$' + (b.expected || 0).toFixed(2));
        breakdownDiff.push((b.difference > 0 ? '+' : '') + '$' + (b.difference || 0).toFixed(2));
      });
    }
    // Add requested columns to the front
    const exportRow = {
      'Type': result.status || '',
      'Actual Charge': result.actual_charge !== undefined ? `$${(result.actual_charge || 0).toFixed(2)}` : '',
      'Expected Charge': result.expected_charge !== undefined ? `$${(result.expected_charge || 0).toFixed(2)}` : '',
      'Difference': result.difference !== undefined ? ((result.difference > 0 ? '+' : '') + `$${(result.difference || 0).toFixed(2)}`) : '',
      'Breakdown - Type': breakdownTypes.join('\n'),
      'Breakdown - Actual': breakdownActual.join('\n'),
      'Breakdown - Expected': breakdownExpected.join('\n'),
      'Breakdown - Difference': breakdownDiff.join('\n'),
      ...originalRow
    };
    return exportRow;
  }).filter(r => r !== null);

  // Send to backend for export
  try {
    const res = await fetch('/api/export_mismatch', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        original_filename: uploadedFileName,
        mismatch_data: exportData
      })
    });
    
    const result = await res.json();
    
    if (result.success) {
      statusDiv.innerHTML = '✓ Mismatch export completed! Go to <a href="#" onclick="document.querySelector(\'.nav-item[data-tab=downloads]\').click(); return false;" style="color: #2196F3; font-weight: bold;">Download Center</a> to download the file.';
      statusDiv.style.background = '#e8f5e9';
      // Refresh download center if on that tab
      if (document.getElementById('downloads-tab').classList.contains('active')) {
        loadDownloadCenter();
      }
    } else {
      statusDiv.innerHTML = '✗ Export failed: ' + (result.error || 'Unknown error');
      statusDiv.style.background = '#ffebee';
    }
  } catch (error) {
    console.error('Error exporting mismatches:', error);
    statusDiv.innerHTML = '✗ Error exporting mismatches: ' + error.message;
    statusDiv.style.background = '#ffebee';
  }
}

// ============================================
// Initialization
// ============================================

function renderAll() {
  // Use currentVersion if available (for editing), otherwise use active version from appData
  const dataToRender = currentVersion || (appData.rate_versions && appData.rate_versions.find(v => v.version_id === appData.active_version_id)) || appData;
  
  createBaseTable(document.getElementById('base-table-wrap'), dataToRender);
  renderFixedSurcharges(document.getElementById('fixed-list'), dataToRender);
  renderZoneSurcharges(document.getElementById('zone-list'), dataToRender);
  renderDemandSurcharges(document.getElementById('demand-list'), dataToRender);
  renderFuelSurcharge(dataToRender);
  renderCustomers(customerData);
}


// ===============================
// Dashboard Frontend Logic
// ===============================

// Chart.js chart instances for dashboard
let dashboardCharts = {
  ordersByDay: null,
  weight: null,
  zone: null,
  service: null,
  surcharge: null,
  adjustment: null
};

// Helper: Parse time filter to date range
function getDashboardDateRange(fromDate, toDate) {
  // If dates are provided, use them; otherwise return null (all time)
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

async function fetchDashboardCustomers() {
  const res = await fetch('/api/dashboard/customers');
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

function renderDashboardChart(chartId, type, labels, datasets, options = {}) {
  // Destroy previous chart if exists
  if (dashboardCharts[chartId]) {
    dashboardCharts[chartId].destroy();
  }
  const ctx = document.getElementById(chartId);
  if (!ctx) return;
  dashboardCharts[chartId] = new Chart(ctx, {
    type,
    data: { labels, datasets },
    options: Object.assign({
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: true } }
    }, options)
  });
}

async function updateOrdersByDay() {
  const ordersDayCustomer = document.getElementById('orders-day-customer-filter').value;
  const ordersDayFromDate = document.getElementById('orders-day-from-date').value;
  const ordersDayToDate = document.getElementById('orders-day-to-date').value;
  const dayData = await fetchDashboardData('orders_by_day', ordersDayCustomer, ordersDayFromDate, ordersDayToDate);
  const rawData = dayData.orders_by_day || [];
  
  // Get unique dates and customers
  const allDates = [...new Set(rawData.map(r => r.date))].sort();
  const allCustomers = [...new Set(rawData.map(r => r.customer_name))];
  
  // Create a map for quick lookup
  const dataMap = {};
  rawData.forEach(r => {
    const key = `${r.date}_${r.customer_name}`;
    dataMap[key] = r.count;
  });
  
  // Generate colors for each customer
  const colors = [
    'rgba(54, 162, 235, 1)',
    'rgba(255, 99, 132, 1)',
    'rgba(75, 192, 192, 1)',
    'rgba(255, 206, 86, 1)',
    'rgba(153, 102, 255, 1)',
    'rgba(255, 159, 64, 1)',
    'rgba(201, 203, 207, 1)'
  ];
  
  // Build datasets for each customer
  let datasets;
  if (ordersDayCustomer === 'all') {
    // Show both total line and individual customer lines
    const totals = allDates.map(date => {
      let sum = 0;
      allCustomers.forEach(customerName => {
        const key = `${date}_${customerName}`;
        sum += dataMap[key] || 0;
      });
      return sum;
    });
    
    // Add total line first with thicker border
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
    
    // Add individual customer lines
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
        datalabels: {
          display: false  // Hide labels for individual customers when All is selected to avoid clutter
        }
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
    layout: {
      padding: {
        right: 30
      }
    },
    plugins: { 
      legend: { display: true, position: 'top' }
    },
    scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
  });
}

async function updateOtherDashboardCharts() {
  const customer = document.getElementById('dashboard-customer-filter').value;
  const fromDate = document.getElementById('dashboard-from-date').value;
  const toDate = document.getElementById('dashboard-to-date').value;

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

  // ...removed Orders by Service Type chart...

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

async function initDashboardTab() {
  const loadingEl = document.getElementById('dashboard-loading');
  const contentEl = document.getElementById('dashboard-content');
  
  // Show loading, hide content
  if (loadingEl) loadingEl.style.display = 'flex';
  if (contentEl) contentEl.style.display = 'none';
  
  try {
    // Populate customer filters
    const customerSelect = document.getElementById('dashboard-customer-filter');
    const ordersDayCustomerSelect = document.getElementById('orders-day-customer-filter');
    const customers = await fetchDashboardCustomers();
    const customerOptions = '<option value="all">All</option>' +
      customers.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    
    customerSelect.innerHTML = customerOptions;
    
    // Populate TMS customers for Orders by Day
    const tmsCustomersResp = await fetch('/api/dashboard/tms_customers');
    const tmsCustomersData = await tmsCustomersResp.json();
    const tmsCustomers = tmsCustomersData.customers || [];
    const tmsCustomerOptions = '<option value="all">All</option>' +
      tmsCustomers.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    ordersDayCustomerSelect.innerHTML = tmsCustomerOptions;

    // Set default date ranges (30 days ago to today)
    const { start, end } = getDefaultDateRange();
    document.getElementById('dashboard-from-date').value = start;
    document.getElementById('dashboard-to-date').value = end;
    document.getElementById('orders-day-from-date').value = start;
    document.getElementById('orders-day-to-date').value = end;

    // Add event listeners for main dashboard - customer change triggers update, dates need Apply button
    customerSelect.addEventListener('change', updateOtherDashboardCharts);
    document.getElementById('dashboard-apply-btn').addEventListener('click', updateOtherDashboardCharts);
    
    // Add event listeners for Orders by Day section - customer change triggers update, dates need Apply button
    ordersDayCustomerSelect.addEventListener('change', updateOrdersByDay);
    document.getElementById('orders-day-apply-btn').addEventListener('click', updateOrdersByDay);

    // Initial load
    await Promise.all([updateOrdersByDay(), updateOtherDashboardCharts()]);
  } finally {
    // Hide loading, show content
    if (loadingEl) loadingEl.style.display = 'none';
    if (contentEl) contentEl.style.display = 'block';
  }
}

// ===============================
// Download Center Logic
// ===============================

let allExports = []; // Store all exports for filtering

async function loadDownloadCenter() {
  const loadingDiv = document.getElementById('downloads-loading');
  const tableBody = document.getElementById('downloads-table-body');
  
  if (loadingDiv) loadingDiv.style.display = 'block';
  
  try {
    const res = await fetch('/api/exports');
    const data = await res.json();
    allExports = data.exports || []; // Store for filtering
    
    // Populate user filter dropdown
    populateUserFilter(allExports);
    
    // Apply filters and render
    applyDownloadsFilter();
    
  } catch (error) {
    console.error('Error loading download center:', error);
    if (loadingDiv) loadingDiv.style.display = 'none';
    const tableBody = document.getElementById('downloads-table-body');
    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 40px; color: #f44336; border: 1px solid #ddd;">
            Error loading exports: ${escapeHtml(error.message)}
          </td>
        </tr>
      `;
    }
  }
}

function populateUserFilter(exports) {
  const userFilter = document.getElementById('filter-export-user');
  if (!userFilter) return;
  
  // Get unique users
  const users = [...new Set(exports.map(exp => exp.exported_by_username || 'unknown'))].sort();
  
  // Keep the "全部" option and add users
  userFilter.innerHTML = '<option value="">全部</option>' + 
    users.map(user => `<option value="${escapeHtml(user)}">${escapeHtml(user)}</option>`).join('');
}

function applyDownloadsFilter() {
  const loadingDiv = document.getElementById('downloads-loading');
  const tableBody = document.getElementById('downloads-table-body');
  
  if (loadingDiv) loadingDiv.style.display = 'none';
  
  // Get filter values
  const typeFilter = document.getElementById('filter-export-type')?.value || '';
  const userFilter = document.getElementById('filter-export-user')?.value || '';
  const dateStartFilter = document.getElementById('filter-export-date-start')?.value || '';
  const dateEndFilter = document.getElementById('filter-export-date-end')?.value || '';
  
  // Filter exports
  let filteredExports = allExports.filter(exp => {
    // Filter by type
    if (typeFilter && exp.export_type !== typeFilter) return false;
    
    // Filter by user
    if (userFilter && (exp.exported_by_username || 'unknown') !== userFilter) return false;
    
    // Filter by date range
    if (dateStartFilter || dateEndFilter) {
      const expDate = new Date(exp.timestamp);
      expDate.setHours(0, 0, 0, 0);
      
      if (dateStartFilter) {
        const startDate = new Date(dateStartFilter);
        startDate.setHours(0, 0, 0, 0);
        if (expDate < startDate) return false;
      }
      
      if (dateEndFilter) {
        const endDate = new Date(dateEndFilter);
        endDate.setHours(23, 59, 59, 999);
        if (expDate > endDate) return false;
      }
    }
    
    return true;
  });
  
  if (filteredExports.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 40px; color: #999; border: 1px solid #ddd;">
          ${allExports.length === 0 ? 'No exports available yet. Upload and analyze an invoice to generate exports.' : 'No exports match the selected filters.'}
        </td>
      </tr>
    `;
    return;
  }
  
  renderDownloadsTable(filteredExports);
}

function renderDownloadsTable(exports) {
  const tableBody = document.getElementById('downloads-table-body');
  if (!tableBody) return;
  
  // Get current user info for permission check
  const currentUser = window.CURRENT_USER || {};
  const canDeleteAll = currentUser.role === 'admin' || currentUser.role === 'manager';
  
  tableBody.innerHTML = exports.map(exp => {
      const date = new Date(exp.timestamp);
      const dateStr = date.toLocaleString();
      const rowCount = (exp.row_count !== undefined && exp.row_count !== null && exp.row_count > 0) ? exp.row_count : 'N/A';
      const exportType = exp.export_type === 'adjustment' ? 'Adjustment' : 'Mismatch';
      const exportTypeBadge = exp.export_type === 'adjustment' 
        ? '<span style="background: #4CAF50; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 500;">Adjustment</span>'
        : '<span style="background: #FF9800; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 500;">Mismatch</span>';
      
      // Check if current user can delete this export
      const exportedById = exp.exported_by_id;
      const canDelete = canDeleteAll || (exportedById && exportedById === currentUser.id);
      const exportedByName = exp.exported_by_username || 'unknown';
      
      // Show delete button only if user has permission
      const deleteBtn = canDelete 
        ? `<button class="btn-secondary" onclick="deleteExport('${exp.id}')" style="margin-left: 8px; padding: 6px 16px;">🗑️ 删除</button>`
        : '';
      
      return `
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 12px; border: 1px solid #ddd;">${escapeHtml(exp.original_filename || 'unknown')}</td>
          <td style="padding: 12px; border: 1px solid #ddd; text-align: center;">${exportTypeBadge}</td>
          <td style="padding: 12px; border: 1px solid #ddd; text-align: center; font-weight: 500;">${rowCount}</td>
          <td style="padding: 12px; border: 1px solid #ddd; text-align: center;">${escapeHtml(exportedByName)}</td>
          <td style="padding: 12px; border: 1px solid #ddd; text-align: center;">${dateStr}</td>
          <td style="padding: 12px; border: 1px solid #ddd; text-align: center;">
            ${exp.exists ? `<button class="btn-primary" onclick="downloadExport('${exp.id}', '${escapeHtml(exp.download_filename)}')" style="padding: 6px 16px;">📥 下载</button>` : '<span style="color: #999;">File not available</span>'}
            ${deleteBtn}
          </td>
        </tr>
      `;
    }).join('');
}

function clearDownloadsFilter() {
  const typeFilter = document.getElementById('filter-export-type');
  const userFilter = document.getElementById('filter-export-user');
  const dateStartFilter = document.getElementById('filter-export-date-start');
  const dateEndFilter = document.getElementById('filter-export-date-end');
  
  if (typeFilter) typeFilter.value = '';
  if (userFilter) userFilter.value = '';
  if (dateStartFilter) dateStartFilter.value = '';
  if (dateEndFilter) dateEndFilter.value = '';
  
  applyDownloadsFilter();
}

async function downloadExport(exportId, filename) {
  try {
    window.location.href = `/api/exports/${exportId}`;
  } catch (error) {
    alert('Error downloading file: ' + error.message);
  }
}

async function deleteExport(exportId) {
  if (!confirm('Are you sure you want to delete this export?')) {
    return;
  }
  
  try {
    const res = await fetch(`/api/exports/${exportId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    
    if (data.success) {
      // Reload the full list and reapply filters
      await loadDownloadCenter();
    } else {
      alert('Error deleting export: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    alert('Error deleting export: ' + error.message);
  }
}

// ===============================
// Search Tracking Number Logic
// ===============================

async function searchTrackingNumber() {
  const input = document.getElementById('search-tracking-input');
  const resultsDiv = document.getElementById('search-results');
  const trackingNumber = input.value.trim();
  
  if (!trackingNumber) {
    alert('Please enter a tracking number');
    return;
  }
  
  resultsDiv.innerHTML = '<div style="text-align: center; padding: 40px;"><p>Searching...</p></div>';
  
  try {
    const res = await fetch(`/api/search_tracking/${encodeURIComponent(trackingNumber)}`);
    const data = await res.json();
    
    if (!data.found) {
      resultsDiv.innerHTML = `
        <div style="padding: 20px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px;">
          <h3 style="margin-top: 0; color: #856404;">⚠️ Not Found</h3>
          <p>${escapeHtml(data.message || 'Tracking number not found')}</p>
        </div>
      `;
      return;
    }
    
    const fedex = data.fedex_data;
    const tms = data.tms_data;
    const analysisResult = fedex.analysis_result || {};
    
    // Build the results display
    let html = '<div style="display: flex; flex-direction: column; gap: 20px;">';
    
    // Shipment Overview
    html += `
      <div style="background: #e8f5e9; padding: 20px; border-radius: 8px; border-left: 4px solid #4caf50;">
        <h2 style="margin-top: 0; color: #2e7d32;">✓ Shipment Found</h2>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 15px;">
          <div><strong>Tracking Number:</strong><br/>${escapeHtml(fedex.tracking_number)}</div>
          <div><strong>Invoice Number:</strong><br/>${escapeHtml(fedex.invoice_number || 'N/A')}</div>
          <div><strong>Ship Date:</strong><br/>${escapeHtml(fedex.ship_date || 'N/A')}</div>
          <div><strong>Customer:</strong><br/>${escapeHtml(fedex.customer_name || 'N/A')}</div>
          <div><strong>Service Type:</strong><br/>${escapeHtml(fedex.service_type || 'N/A')}</div>
          <div><strong>Zone:</strong><br/>${escapeHtml(fedex.zone || 'N/A')}</div>
          <div><strong>Weight:</strong><br/>${fedex.weight} lbs</div>
        </div>
      </div>
    `;
    
    // Adjustment Information
    html += `
      <div style="background: #fff; padding: 20px; border-radius: 8px; border: 1px solid #ddd;">
        <h3 style="margin-top: 0;">💰 Adjustment Information</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr style="background: #f8f9fa;">
            <th style="padding: 12px; text-align: left; border: 1px solid #ddd;">Description</th>
            <th style="padding: 12px; text-align: right; border: 1px solid #ddd;">Amount</th>
          </tr>
    `;
    
    // Add base rate and surcharges from analysis_result
    if (analysisResult.base_rate !== undefined) {
      html += `
        <tr>
          <td style="padding: 12px; border: 1px solid #ddd;"><strong>Base Rate</strong></td>
          <td style="padding: 12px; text-align: right; border: 1px solid #ddd;">$${(analysisResult.base_rate || 0).toFixed(2)}</td>
        </tr>
      `;
    }
    
    if (analysisResult.surcharge) {
      const surcharges = analysisResult.surcharge.split('\\n');
      surcharges.forEach(sc => {
        if (sc.trim()) {
          html += `
            <tr>
              <td style="padding: 12px; border: 1px solid #ddd;">${escapeHtml(sc)}</td>
              <td style="padding: 12px; text-align: right; border: 1px solid #ddd;">-</td>
            </tr>
          `;
        }
      });
    }
    
    html += `
      <tr style="background: #fff3cd;">
        <td style="padding: 12px; border: 1px solid #ddd;"><strong>Prepaid Charge (TMS)</strong></td>
        <td style="padding: 12px; text-align: right; border: 1px solid #ddd;"><strong>$${(fedex.actual_charge || 0).toFixed(2)}</strong></td>
      </tr>
      <tr style="background: #e3f2fd;">
        <td style="padding: 12px; border: 1px solid #ddd;"><strong>Total Amount (Expected)</strong></td>
        <td style="padding: 12px; text-align: right; border: 1px solid #ddd;"><strong>$${(fedex.expected_charge || 0).toFixed(2)}</strong></td>
      </tr>
    `;
    
    const adjustment = fedex.adjustment || 0;
    const adjustmentColor = adjustment > 0 ? '#f44336' : adjustment < 0 ? '#4caf50' : '#999';
    html += `
      <tr style="background: #ffebee;">
        <td style="padding: 12px; border: 1px solid #ddd;"><strong>Adjustment</strong></td>
        <td style="padding: 12px; text-align: right; border: 1px solid #ddd; color: ${adjustmentColor}; font-weight: bold;">
          ${adjustment > 0 ? '+' : ''}$${adjustment.toFixed(2)}
        </td>
      </tr>
    `;
    
    html += `</table></div>`;
    
    // TMS Information
    if (tms) {
      html += `
        <div style="background: #fff; padding: 20px; border-radius: 8px; border: 1px solid #ddd;">
          <h3 style="margin-top: 0;">📦 TMS Information</h3>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
            <div><strong>Master Tracking:</strong><br/>${escapeHtml(tms.master_tracking_number || 'N/A')}</div>
            <div><strong>API Cost:</strong><br/>$${(tms.api_cost || 0).toFixed(2)}</div>
            <div><strong>Charged Amount:</strong><br/>$${(tms.charged_amount || 0).toFixed(2)}</div>
            <div><strong>Weight:</strong><br/>${(tms.weight_kg || 0).toFixed(2)} kg</div>
            <div><strong>Created At:</strong><br/>${escapeHtml(tms.created_at || 'N/A')}</div>
          </div>
        </div>
      `;
    }
    
    // Verification Status
    if (fedex.verification_status) {
      const statusColor = fedex.verification_status === 'match' ? '#4caf50' : '#ff9800';
      html += `
        <div style="background: ${statusColor}22; padding: 20px; border-radius: 8px; border: 1px solid ${statusColor};">
          <h3 style="margin-top: 0; color: ${statusColor};">Verification Status: ${escapeHtml(fedex.verification_status.toUpperCase())}</h3>
        </div>
      `;
    }
    
    html += '</div>';
    
    resultsDiv.innerHTML = html;
    
  } catch (error) {
    console.error('Error searching tracking number:', error);
    resultsDiv.innerHTML = `
      <div style="padding: 20px; background: #ffebee; border: 1px solid #f44336; border-radius: 4px;">
        <h3 style="margin-top: 0; color: #c62828;">❌ Error</h3>
        <p>${escapeHtml(error.message)}</p>
      </div>
    `;
  }
}

function clearSearch() {
  document.getElementById('search-tracking-input').value = '';
  document.getElementById('search-results').innerHTML = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  // Apply permission-based tab visibility
  applyPermissions();
  
  try {
    appData = await getData(); // Get all versions
    customerData = await getCustomerData();
    
    // Initialize version selector if on rates tab
    if (document.getElementById('rate-version-select')) {
      await initVersionSelector();
    }
    
    initTabs();
    renderAll();
    setupEventHandlers();

    // Initialize the currently active tab (handles permission-based landing tabs)
    const activeNavItem = document.querySelector('.nav-item.active');
    if (activeNavItem) {
      const activeTabName = activeNavItem.dataset.tab;
      if (activeTabName === 'wms-monitor' && window.initWmsMonitor) {
        initWmsMonitor();
      }
      if (activeTabName === 'turnover' && window.initTurnover) {
        initTurnover();
      }
      if (activeTabName === 'supplier-operations' && window.SupplierOps) {
        SupplierOps.initDashboard();
      }
    }
    
    // Dashboard tab logic
    if (document.getElementById('dashboard-tab')) {
      initDashboardTab();
    }
    
    // Rate Comparison tab logic
    if (document.getElementById('rate-comparison-tab')) {
      initRateComparisonTab();
    }
    
    // Quote Carrier Pricing Management
    if (document.getElementById('settings-quote-pricing')) {
      initQuotePricingSettings();
    }
    
    // Supplier Management
    if (document.getElementById('settings-supplier')) {
      initSupplierManagement();
    }
    
    // Supplier Operations (其它服务商)
    if (document.getElementById('supplier-operations-tab') && window.SupplierOps) {
      SupplierOps.init();
    }
    
    // Download center tab logic
    if (document.getElementById('downloads-tab')) {
      const refreshBtn = document.getElementById('refresh-downloads-btn');
      const applyFilterBtn = document.getElementById('apply-downloads-filter-btn');
      const clearFilterBtn = document.getElementById('clear-downloads-filter-btn');
      
      if (refreshBtn) {
        refreshBtn.addEventListener('click', loadDownloadCenter);
      }
      
      if (applyFilterBtn) {
        applyFilterBtn.addEventListener('click', applyDownloadsFilter);
      }
      
      if (clearFilterBtn) {
        clearFilterBtn.addEventListener('click', clearDownloadsFilter);
      }
      
      // Apply filter on Enter key in date inputs
      const dateStartInput = document.getElementById('filter-export-date-start');
      const dateEndInput = document.getElementById('filter-export-date-end');
      
      if (dateStartInput) {
        dateStartInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') applyDownloadsFilter();
        });
      }
      
      if (dateEndInput) {
        dateEndInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') applyDownloadsFilter();
        });
      }
    }
    
    // Search tab logic
    if (document.getElementById('search-tab')) {
      const searchBtn = document.getElementById('search-tracking-btn');
      const clearBtn = document.getElementById('clear-search-btn');
      const searchInput = document.getElementById('search-tracking-input');
      
      if (searchBtn) {
        searchBtn.addEventListener('click', searchTrackingNumber);
      }
      
      if (clearBtn) {
        clearBtn.addEventListener('click', clearSearch);
      }
      
      if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            searchTrackingNumber();
          }
        });
      }
    }
    
    // Customer Quote tab logic
    if (document.getElementById('customer-quote-tab')) {
      initCustomerQuoteTab();
    }
    
    // Rate Debug tab logic
    if (document.getElementById('rate-debug-tab')) {
      if (typeof window.initRateDebug === 'function') {
        window.initRateDebug();
      }
    }
    
    // User Management tab logic
    if (document.getElementById('user-management-tab')) {
      initUserManagement();
    }
    
    // Warehouse Operations settings logic
    if (document.getElementById('settings-warehouse-ops')) {
      initWarehouseOpsSettings();
    }
    
    // Settings sub-tab switching
    initSettingsSubTabs();
    
    // Operations sub-tab switching
    initOperationsSubTabs();
    
    // Turnover sub-tab switching
    initTurnoverSubTabs();
  } catch (err) {
    alert('Error initializing app: ' + err.message);
    console.error(err);
  }
});

// ============================================
// Version Management
// ============================================

async function initVersionSelector() {
  const select = document.getElementById('rate-version-select');
  const btnEdit = document.getElementById('btn-edit-version');
  const btnNew = document.getElementById('btn-new-version');
  const btnDelete = document.getElementById('btn-delete-version');
  const btnDuplicate = document.getElementById('btn-duplicate-version');
  const btnPasteBaseRates = document.getElementById('btn-paste-base-rates');
  
  // Populate version dropdown
  await refreshVersionSelector();
  
  // Version change handler
  select.addEventListener('change', async () => {
    const versionId = select.value;
    if (!versionId) return;
    
    try {
      currentVersion = await getVersionById(versionId);
      renderAll();
      updateVersionInfo();
    } catch (err) {
      alert('Error loading version: ' + err.message);
    }
  });
  
  // Edit version button - edit name and dates
  btnEdit.addEventListener('click', async () => {
    const versionId = select.value;
    if (!versionId || !currentVersion) {
      alert('Please select a version first');
      return;
    }
    
    // Show edit dialog
    showEditVersionDialog(currentVersion, async (updatedInfo) => {
      try {
        // Update the current version with new info
        currentVersion.version_name = updatedInfo.version_name;
        currentVersion.effective_start = updatedInfo.effective_start || null;
        currentVersion.effective_end = updatedInfo.effective_end || null;
        
        // Save to server
        await saveVersion(versionId, currentVersion);
        appData = await getData();
        await refreshVersionSelector();
        select.value = versionId;
        updateVersionInfo();
        alert('Version updated successfully!');
      } catch (err) {
        alert('Error updating version: ' + err.message);
      }
    });
  });
  
  // Paste base rates from Excel button
  if (btnPasteBaseRates) {
    btnPasteBaseRates.addEventListener('click', handlePasteBaseRates);
  }
  
  // New version button
  btnNew.addEventListener('click', async () => {
    const name = prompt('Enter new version name:', `Rates ${new Date().toISOString().split('T')[0]}`);
    if (!name) return;
    
    const startDate = prompt('Enter effective start date (YYYY-MM-DD) or leave empty for no start limit:', '');
    const endDate = prompt('Enter effective end date (YYYY-MM-DD) or leave empty for ongoing:', '');
    
    // Create empty version
    const newVersion = {
      version_id: `v_${Date.now()}`,
      version_name: name,
      effective_start: startDate || null,
      effective_end: endDate || null,
      base_table: {
        zones: Array.from({length: 7}, (_, i) => `Zone ${i + 2}`),
        lbs: Array.from({length: 150}, (_, i) => i + 1),
        rates: Array.from({length: 150}, () => Array(7).fill(''))
      },
      fixed_surcharges: [],
      zone_based_surcharges: [],
      demand_surcharges: [],
      fuel_surcharge: {date_ranges: []}
    };
    
    try {
      await createNewVersion(newVersion);
      appData = await getData();
      await refreshVersionSelector();
      select.value = newVersion.version_id;
      select.dispatchEvent(new Event('change'));
      alert('Version created successfully!');
    } catch (err) {
      alert('Error creating version: ' + err.message);
    }
  });
  
  // Delete version button
  btnDelete.addEventListener('click', async () => {
    const versionId = select.value;
    if (!versionId) return;
    
    const version = appData.rate_versions.find(v => v.version_id === versionId);
    if (!confirm(`Delete version "${version.version_name}"?`)) return;
    
    try {
      await deleteVersion(versionId);
      appData = await getData();
      await refreshVersionSelector();
      alert('Version deleted successfully!');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });
  
  // Duplicate version button
  btnDuplicate.addEventListener('click', async () => {
    const versionId = select.value;
    if (!versionId) return;
    
    const sourceVersion = appData.rate_versions.find(v => v.version_id === versionId);
    const name = prompt('Enter name for duplicated version:', sourceVersion.version_name + ' (Copy)');
    if (!name) return;
    
    const startDate = prompt('Enter effective start date (YYYY-MM-DD):', '');
    const endDate = prompt('Enter effective end date (YYYY-MM-DD) or leave empty:', '');
    
    const newVersion = {
      ...JSON.parse(JSON.stringify(sourceVersion)), // Deep copy
      version_id: `v_${Date.now()}`,
      version_name: name,
      effective_start: startDate || null,
      effective_end: endDate || null
    };
    
    try {
      await createNewVersion(newVersion);
      appData = await getData();
      await refreshVersionSelector();
      select.value = newVersion.version_id;
      select.dispatchEvent(new Event('change'));
      alert('Version duplicated successfully!');
    } catch (err) {
      alert('Error duplicating version: ' + err.message);
    }
  });
}

async function refreshVersionSelector() {
  const select = document.getElementById('rate-version-select');
  if (!select) return;
  
  appData = await getData();
  
  select.innerHTML = appData.rate_versions.map(v => 
    `<option value="${v.version_id}" ${v.version_id === appData.active_version_id ? 'selected' : ''}>
      ${escapeHtml(v.version_name)}
    </option>`
  ).join('');
  
  // Load the active version
  if (appData.active_version_id) {
    const activeId = appData.active_version_id;
    currentVersion = appData.rate_versions.find(v => v.version_id === activeId);
    updateVersionInfo();
  }
}

function updateVersionInfo() {
  if (!currentVersion) return;
  
  const datesSpan = document.getElementById('version-dates');
  if (!datesSpan) return;
  
  const start = currentVersion.effective_start || 'Beginning';
  const end = currentVersion.effective_end || 'Ongoing';
  datesSpan.textContent = `${start} to ${end}`;
}

// Edit Version Dialog
function showEditVersionDialog(version, onSave) {
  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;';
  
  const dialog = document.createElement('div');
  dialog.style.cssText = 'background: white; padding: 24px; border-radius: 8px; width: 400px; max-width: 90%;';
  dialog.innerHTML = `
    <h3 style="margin-top: 0; margin-bottom: 20px;">Edit Rate Version</h3>
    <div style="margin-bottom: 16px;">
      <label style="display: block; font-weight: bold; margin-bottom: 4px;">Version Name:</label>
      <input type="text" id="edit-version-name" value="${escapeHtml(version.version_name || '')}" 
             style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;">
    </div>
    <div style="margin-bottom: 16px;">
      <label style="display: block; font-weight: bold; margin-bottom: 4px;">Effective Start Date:</label>
      <input type="date" id="edit-version-start" value="${version.effective_start || ''}" 
             style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;">
      <small style="color: #666;">Leave empty for no start limit (applies to all past dates)</small>
    </div>
    <div style="margin-bottom: 20px;">
      <label style="display: block; font-weight: bold; margin-bottom: 4px;">Effective End Date:</label>
      <input type="date" id="edit-version-end" value="${version.effective_end || ''}" 
             style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;">
      <small style="color: #666;">Leave empty for ongoing (no end date)</small>
    </div>
    <div style="display: flex; justify-content: flex-end; gap: 12px;">
      <button id="edit-version-cancel" class="btn-secondary" style="padding: 8px 20px;">Cancel</button>
      <button id="edit-version-save" class="btn-primary" style="padding: 8px 20px;">Save</button>
    </div>
  `;
  
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  
  // Focus on name input
  document.getElementById('edit-version-name').focus();
  
  // Cancel button
  document.getElementById('edit-version-cancel').addEventListener('click', () => {
    document.body.removeChild(overlay);
  });
  
  // Click outside to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      document.body.removeChild(overlay);
    }
  });
  
  // Save button
  document.getElementById('edit-version-save').addEventListener('click', () => {
    const name = document.getElementById('edit-version-name').value.trim();
    if (!name) {
      alert('Version name is required');
      return;
    }
    
    const updatedInfo = {
      version_name: name,
      effective_start: document.getElementById('edit-version-start').value || null,
      effective_end: document.getElementById('edit-version-end').value || null
    };
    
    document.body.removeChild(overlay);
    onSave(updatedInfo);
  });
}

// Paste Base Rates from Excel
function handlePasteBaseRates() {
  // Create modal for paste area
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;';
  
  const dialog = document.createElement('div');
  dialog.style.cssText = 'background: white; padding: 24px; border-radius: 8px; width: 600px; max-width: 90%; max-height: 80vh; overflow-y: auto;';
  dialog.innerHTML = `
    <h3 style="margin-top: 0; margin-bottom: 12px;">Paste Base Rates from Excel</h3>
    <p style="color: #666; margin-bottom: 16px;">
      Copy a rate table from Excel with the following format:<br>
      - First row: Zone headers (e.g., Zone 2, Zone 3, ... or just 2, 3, ...)<br>
      - First column: Weight in lbs (1-150)<br>
      - Data cells: Rate values
    </p>
    <div style="margin-bottom: 16px;">
      <textarea id="paste-rates-area" placeholder="Paste your rate table here (Ctrl+V)..." 
                style="width: 100%; height: 200px; padding: 12px; border: 2px dashed #2196F3; border-radius: 4px; font-family: monospace; font-size: 12px; box-sizing: border-box; resize: vertical;"></textarea>
    </div>
    <div id="paste-preview" style="margin-bottom: 16px; display: none;">
      <h4 style="margin-bottom: 8px;">Preview (first 5 rows):</h4>
      <div id="paste-preview-content" style="background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; font-family: monospace; font-size: 11px;"></div>
    </div>
    <div style="display: flex; justify-content: flex-end; gap: 12px;">
      <button id="paste-rates-cancel" class="btn-secondary" style="padding: 8px 20px;">Cancel</button>
      <button id="paste-rates-apply" class="btn-primary" style="padding: 8px 20px;">Apply Rates</button>
    </div>
  `;
  
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  
  const textarea = document.getElementById('paste-rates-area');
  const previewDiv = document.getElementById('paste-preview');
  const previewContent = document.getElementById('paste-preview-content');
  
  // Focus on textarea
  textarea.focus();
  
  // Handle paste and show preview
  textarea.addEventListener('input', () => {
    const text = textarea.value.trim();
    if (!text) {
      previewDiv.style.display = 'none';
      return;
    }
    
    const parsed = parseExcelRates(text);
    if (parsed && parsed.rates.length > 0) {
      previewDiv.style.display = 'block';
      const previewRows = parsed.rates.slice(0, 5);
      let html = '<table style="border-collapse: collapse; font-size: 11px;">';
      html += '<tr><th style="border: 1px solid #ddd; padding: 4px;">lbs</th>';
      parsed.zones.forEach(z => {
        html += `<th style="border: 1px solid #ddd; padding: 4px;">${z}</th>`;
      });
      html += '</tr>';
      previewRows.forEach((row, i) => {
        html += `<tr><td style="border: 1px solid #ddd; padding: 4px;">${parsed.startWeight + i}</td>`;
        row.forEach(val => {
          html += `<td style="border: 1px solid #ddd; padding: 4px;">${val}</td>`;
        });
        html += '</tr>';
      });
      if (parsed.rates.length > 5) {
        html += `<tr><td colspan="${parsed.zones.length + 1}" style="text-align: center; color: #666; padding: 8px;">... and ${parsed.rates.length - 5} more rows</td></tr>`;
      }
      html += '</table>';
      html += `<div style="margin-top: 8px; color: #2196F3;">Detected: ${parsed.rates.length} weight rows, ${parsed.zones.length} zones (starting from ${parsed.startWeight} lbs)</div>`;
      previewContent.innerHTML = html;
    } else {
      previewDiv.style.display = 'block';
      previewContent.innerHTML = '<span style="color: #f44336;">Could not parse the pasted data. Make sure it\'s a valid rate table.</span>';
    }
  });
  
  // Cancel button
  document.getElementById('paste-rates-cancel').addEventListener('click', () => {
    document.body.removeChild(overlay);
  });
  
  // Click outside to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      document.body.removeChild(overlay);
    }
  });
  
  // Apply button
  document.getElementById('paste-rates-apply').addEventListener('click', () => {
    const text = textarea.value.trim();
    if (!text) {
      alert('Please paste rate data first');
      return;
    }
    
    const parsed = parseExcelRates(text);
    if (!parsed || parsed.rates.length === 0) {
      alert('Could not parse the pasted data. Please check the format.');
      return;
    }
    
    // Apply to currentVersion
    if (!currentVersion) {
      alert('No version selected');
      return;
    }
    
    // Update the base table rates
    const startIdx = parsed.startWeight - 1; // Convert to 0-indexed
    parsed.rates.forEach((row, i) => {
      const weightIdx = startIdx + i;
      if (weightIdx < 150) {
        // Map parsed zones to our zone indices (Zone 2 = index 0, Zone 3 = index 1, etc.)
        row.forEach((val, zoneIdx) => {
          if (zoneIdx < 7) {
            if (!currentVersion.base_table.rates[weightIdx]) {
              currentVersion.base_table.rates[weightIdx] = Array(7).fill('');
            }
            currentVersion.base_table.rates[weightIdx][zoneIdx] = val;
          }
        });
      }
    });
    
    document.body.removeChild(overlay);
    
    // Re-render the base table
    createBaseTable(document.getElementById('base-table-wrap'), currentVersion);
    
    alert(`Successfully applied ${parsed.rates.length} rate rows for ${parsed.zones.length} zones!`);
  });
}

// Parse Excel paste data for base rates
function parseExcelRates(text) {
  try {
    // Split by lines
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return null;
    
    // First line should be headers (zones)
    const headerLine = lines[0];
    const headerCells = headerLine.split(/\t/).map(c => c.trim());
    
    // Detect zones from header - look for zone numbers
    const zones = [];
    let dataStartCol = 0;
    
    headerCells.forEach((cell, idx) => {
      // Check if it's a zone header
      const zoneMatch = cell.match(/(?:Zone\s*)?(\d+)/i);
      if (zoneMatch) {
        const zoneNum = parseInt(zoneMatch[1]);
        if (zoneNum >= 2 && zoneNum <= 8) {
          zones.push(`Zone ${zoneNum}`);
          if (dataStartCol === 0 && idx > 0) dataStartCol = idx;
        }
      }
    });
    
    // If no zones found in header, assume first row is not a header
    let startLineIdx = 1;
    if (zones.length === 0) {
      // Try to detect zones from column count - assume Zone 2-8
      zones.push('Zone 2', 'Zone 3', 'Zone 4', 'Zone 5', 'Zone 6', 'Zone 7', 'Zone 8');
      startLineIdx = 0;
    }
    
    // Parse data rows
    const rates = [];
    let startWeight = null;
    
    for (let i = startLineIdx; i < lines.length; i++) {
      const cells = lines[i].split(/\t/).map(c => c.trim());
      if (cells.length < 2) continue;
      
      // First cell should be weight
      const weightStr = cells[0].replace(/[^0-9]/g, '');
      const weight = parseInt(weightStr);
      if (!weight || weight < 1 || weight > 150) continue;
      
      if (startWeight === null) startWeight = weight;
      
      // Rest are rate values
      const rowRates = [];
      for (let j = 1; j < cells.length && rowRates.length < 7; j++) {
        const val = parseFloat(cells[j].replace(/[$,]/g, ''));
        rowRates.push(isNaN(val) ? 0 : val);
      }
      
      // Pad with zeros if needed
      while (rowRates.length < 7) rowRates.push(0);
      
      rates.push(rowRates);
    }
    
    return {
      zones: zones.slice(0, 7),
      rates,
      startWeight: startWeight || 1
    };
  } catch (e) {
    console.error('Error parsing rates:', e);
    return null;
  }
}

// ===============================
// Rate Comparison Logic
// ===============================

function initRateComparisonTab() {
  const compareBtn = document.getElementById('compare-rates-btn');
  const exportBtn = document.getElementById('export-comparison-btn');
  
  if (compareBtn) {
    compareBtn.addEventListener('click', generateRateComparison);
  }
  
  if (exportBtn) {
    exportBtn.addEventListener('click', exportRateComparison);
  }
  
  // Load suppliers into the checkbox container
  loadSuppliersIntoRateComparison();
}

async function loadSuppliersIntoRateComparison() {
  const container = document.getElementById('suppliers-select-container');
  if (!container) return;
  
  try {
    const data = await getSupplierData();
    
    // Clear existing content
    container.innerHTML = '';
    
    // Group suppliers by carrier (9 standard carriers + TEST)
    const carriers = ['UNIUNI', 'GOFO', 'USPS', 'SmartPost', 'UPS', 'FedEx', 'FedExAHS', 'FedExOS', 'TEST'];
    const grouped = {};
    
    carriers.forEach(cat => grouped[cat] = []);
    
    if (data.suppliers && data.suppliers.length > 0) {
      data.suppliers.forEach(supplier => {
        const category = supplier.category || 'FedEx';
        if (!grouped[category]) grouped[category] = [];
        grouped[category].push(supplier);
      });
    }
    
    // Render carrier groups
    carriers.forEach(carrier => {
      if (grouped[carrier].length > 0) {
        const categoryDiv = document.createElement('div');
        categoryDiv.style.marginBottom = '12px';
        
        const categoryHeader = document.createElement('div');
        categoryHeader.style.cssText = 'font-weight: 600; font-size: 12px; color: #374151; margin-bottom: 6px; padding: 4px 0; border-bottom: 1px solid #e5e7eb;';
        categoryHeader.textContent = carrier;
        categoryDiv.appendChild(categoryHeader);
        
        grouped[carrier].forEach(supplier => {
          const label = document.createElement('label');
          label.style.cssText = 'display: block; margin-bottom: 4px; cursor: pointer; padding: 4px 8px; border-radius: 4px; font-size: 13px;';
          label.onmouseover = () => label.style.background = '#f3f4f6';
          label.onmouseout = () => label.style.background = 'transparent';
          
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.value = supplier.id;
          checkbox.className = 'supplier-checkbox';
          checkbox.style.marginRight = '8px';
          
          label.appendChild(checkbox);
          label.appendChild(document.createTextNode(supplier.name));
          categoryDiv.appendChild(label);
        });
        
        container.appendChild(categoryDiv);
      }
    });
  } catch (error) {
    console.error('Error loading suppliers for rate comparison:', error);
  }
}

function filterSuppliersByRequiredSurcharges(supplierIds, selectedAHS, signatureType) {
  if (!supplierData || !supplierData.suppliers) return supplierIds;
  
  return supplierIds.filter(supplierId => {
    const supplier = supplierData.suppliers.find(s => s.id === supplierId);
    if (!supplier) return false;
    
    // Check AHS surcharges (zone-based)
    for (const ahsType of selectedAHS) {
      let surchargeRequired = null;
      
      if (ahsType === 'ahs_dimension') {
        surchargeRequired = 'AHS - Dimensions';
      } else if (ahsType === 'additional_handling') {
        surchargeRequired = 'Additional Handling';
      } else if (ahsType === 'oversize') {
        surchargeRequired = 'Oversize Charge';
      }
      
      if (surchargeRequired) {
        // Check zone-based surcharges
        const hasZoneSurcharge = supplier.zone_based_surcharges?.some(s => 
          s.description === surchargeRequired
        );
        
        // If this AHS type is required but not configured, filter out supplier
        if (!hasZoneSurcharge) {
          return false;
        }
      }
    }
    
    // Check signature surcharges (fixed)
    if (signatureType === 'direct') {
      const hasDirectSig = supplier.fixed_surcharges?.some(s => 
        s.description === 'Direct Signature'
      );
      if (!hasDirectSig) return false;
    } else if (signatureType === 'adult') {
      const hasAdultSig = supplier.fixed_surcharges?.some(s => 
        s.description === 'Adult Signature'
      );
      if (!hasAdultSig) return false;
    }
    
    return true;
  });
}

function generateRateComparison() {
  const serviceType = document.querySelector('input[name="service-type"]:checked').value;
  
  // Get selected suppliers from checkboxes
  const selectedCheckboxes = document.querySelectorAll('.supplier-checkbox:checked');
  const selectedSuppliers = Array.from(selectedCheckboxes).map(cb => cb.value);
  
  const dasLevel = document.getElementById('das-select').value;
  const ahsCheckboxes = document.querySelectorAll('.ahs-checkbox:checked');
  const selectedAHS = Array.from(ahsCheckboxes).map(cb => cb.value);
  
  // Single demand checkbox (replaces multiple demand checkboxes)
  const demandCheckbox = document.getElementById('demand-checkbox');
  const demandEnabled = demandCheckbox ? demandCheckbox.checked : false;
  
  const signatureTypeSelect = document.getElementById('signature-type-select');
  const signatureType = signatureTypeSelect ? signatureTypeSelect.value : 'none';
  
  // Get carrier-based fuel rates (FedEx group shares rate, UPS has its own, others are 0)
  const fedexFuelRate = parseFloat(document.getElementById('fuel-fedex').value) || 0;
  const upsFuelRate = parseFloat(document.getElementById('fuel-ups').value) || 0;
  const fuelRates = {
    'FedEx': fedexFuelRate,
    'FedExAHS': fedexFuelRate,
    'FedExOS': fedexFuelRate,
    'SmartPost': fedexFuelRate,
    'UPS': upsFuelRate,
    'USPS': 0,
    'UNIUNI': 0,
    'GOFO': 0,
    'TEST': 0
  };
  
  if (selectedSuppliers.length === 0) {
    alert('Please select at least one supplier to compare');
    return;
  }
  
  // Filter suppliers based on required surcharges
  const filteredSuppliers = filterSuppliersByRequiredSurcharges(
    selectedSuppliers, 
    selectedAHS, 
    signatureType
  );
  
  if (filteredSuppliers.length === 0) {
    alert('No suppliers have the required surcharges configured. Please configure surcharges in 参数设置 or adjust selections.');
    return;
  }
  
  // Generate comparison table (pass demandEnabled as boolean instead of selectedDemand array)
  const resultsDiv = document.getElementById('comparison-results');
  resultsDiv.innerHTML = generateComparisonTable(serviceType, filteredSuppliers, dasLevel, selectedAHS, demandEnabled, signatureType, fuelRates);
}

function generateComparisonTable(serviceType, suppliers, dasLevel, selectedAHS, demandEnabled, signatureType, fuelRates) {
  // Dynamically determine available zones from selected suppliers
  const allZones = new Set();
  let hasOunceRates = false;
  let maxPoundWeight = 150;
  let maxOunceWeight = 16;
  
  suppliers.forEach(supplierId => {
    const supplierObj = supplierData?.suppliers?.find(s => s.id === supplierId);
    if (!supplierObj) return;
    
    // Check for pound rates zones
    const service = serviceType === 'home_delivery' ? 'hd' : 'ground';
    let actualService = service;
    if (service === 'ground' && (!supplierObj.ground_base_rates_lb || supplierObj.ground_base_rates_lb.length === 0)) {
      actualService = 'hd';
    }
    
    const poundZones = supplierObj[`${actualService}_zones_lb`] || [];
    poundZones.forEach(z => allZones.add(z));
    
    // Check for ounce rates
    if (supplierObj.base_rates_oz && supplierObj.base_rates_oz.length > 0) {
      hasOunceRates = true;
      const ozZones = supplierObj.zones_oz || [];
      ozZones.forEach(z => allZones.add(z));
      maxOunceWeight = Math.max(maxOunceWeight, supplierObj.weight_end_oz || 16);
    }
    
    // Get max weight for pounds
    const weightEnd = supplierObj[`${actualService}_weight_end_lb`] || 150;
    maxPoundWeight = Math.max(maxPoundWeight, weightEnd);
  });
  
  const zones = Array.from(allZones).sort((a, b) => a - b);
  if (zones.length === 0) zones.push(2, 3, 4, 5, 6, 7, 8); // Default fallback
  
  let html = '';
  
  // Generate ounce rates table if available
  if (hasOunceRates) {
    html += '<h3 style="margin-top: 0; margin-bottom: 15px; color: #374151;">📦 Ounce Rates (Lightweight Shipments)</h3>';
    html += '<div style="max-height: 400px; overflow-y: auto; overflow-x: auto; position: relative; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 30px;">';
    html += '<table class="data-table" style="font-size: 12px; border-collapse: collapse; width: 100%;">';
    html += '<thead><tr style="background: #8b5cf6; color: white;">';
    html += '<th style="padding: 12px; border: 1px solid rgba(255,255,255,0.2); position: sticky; left: 0; top: 0; background: #8b5cf6; z-index: 3; font-weight: 600;">Weight (oz)</th>';
    zones.forEach(zone => {
      html += `<th style="padding: 12px; border: 1px solid rgba(255,255,255,0.2); position: sticky; top: 0; background: #8b5cf6; z-index: 2; font-weight: 600;">Zone ${zone}</th>`;
    });
    html += '</tr></thead><tbody>';
    
    for (let oz = 1; oz <= maxOunceWeight; oz++) {
      const weight = oz / 16; // Convert to pounds for calculation
      html += '<tr style="transition: background 0.2s;" onmouseover="this.style.background=\'#f8f9fa\'" onmouseout="this.style.background=\'white\'">';
      html += `<td style="padding: 10px; border: 1px solid #e9ecef; font-weight: 600; background: #ede9fe; position: sticky; left: 0; z-index: 1; text-align: center;">${oz} oz</td>`;
      
      zones.forEach(zone => {
        const prices = calculatePricesForCell(weight, zone, serviceType, suppliers, dasLevel, selectedAHS, demandEnabled, signatureType, fuelRates, true);
        html += `<td style="padding: 10px; border: 1px solid #e9ecef; vertical-align: top; background: white;">${formatPricesCell(prices, suppliers)}</td>`;
      });
      
      html += '</tr>';
    }
    
    html += '</tbody></table></div>';
  }
  
  // Generate pound rates table
  html += '<h3 style="margin-top: 0; margin-bottom: 15px; color: #374151;">📦 Pound Rates</h3>';
  html += '<div style="max-height: 600px; overflow-y: auto; overflow-x: auto; position: relative; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">';
  html += '<table class="data-table" style="font-size: 12px; border-collapse: collapse; width: 100%;">';
  html += '<thead><tr style="background: #6b7280; color: white;">';
  html += '<th style="padding: 12px; border: 1px solid rgba(255,255,255,0.2); position: sticky; left: 0; top: 0; background: #6b7280; z-index: 3; font-weight: 600;">Weight (lbs)</th>';
  zones.forEach(zone => {
    html += `<th style="padding: 12px; border: 1px solid rgba(255,255,255,0.2); position: sticky; top: 0; background: #6b7280; z-index: 2; font-weight: 600;">Zone ${zone}</th>`;
  });
  html += '</tr></thead><tbody>';
  
  const poundWeights = Array.from({length: maxPoundWeight}, (_, i) => i + 1);
  poundWeights.forEach(weight => {
    html += '<tr style="transition: background 0.2s;" onmouseover="this.style.background=\'#f8f9fa\'" onmouseout="this.style.background=\'white\'">';
    html += `<td style="padding: 10px; border: 1px solid #e9ecef; font-weight: 600; background: #e5e7eb; position: sticky; left: 0; z-index: 1; text-align: center;">${weight}</td>`;
    
    zones.forEach(zone => {
      const prices = calculatePricesForCell(weight, zone, serviceType, suppliers, dasLevel, selectedAHS, demandEnabled, signatureType, fuelRates, false);
      html += `<td style="padding: 10px; border: 1px solid #e9ecef; vertical-align: top; background: white;">${formatPricesCell(prices, suppliers)}</td>`;
    });
    
    html += '</tr>';
  });
  
  html += '</tbody></table></div>';
  return html;
}

function calculatePricesForCell(weight, zone, serviceType, suppliers, dasLevel, selectedAHS, demandEnabled, signatureType, fuelRates, isOunce = false) {
  const prices = [];
  
  suppliers.forEach(supplier => {
    let totalCost = 0;
    let breakdown = [];
    
    // Get supplier object to access category
    const supplierObj = supplierData?.suppliers?.find(s => s.id === supplier);
    if (!supplierObj) return;
    
    // Get fuel percentage for this supplier's category
    const fuelPercentage = fuelRates[supplierObj.category] || 0;
    
    // Apply rated weight adjustments based on AHS FIRST (before getting base rate)
    let ratedWeight = weight;
    if (selectedAHS.includes('oversize')) {
      ratedWeight = Math.max(ratedWeight, 90);
    } else if (selectedAHS.includes('ahs_dimension')) {
      ratedWeight = Math.max(ratedWeight, 40);
    }
    
    // Get base rate using the RATED weight (not actual weight)
    const baseRate = getBaseRateForSupplier(supplier, ratedWeight, zone, serviceType);
    if (baseRate === null) return; // Skip if supplier doesn't have this rate
    
    totalCost += baseRate;
    if (ratedWeight !== weight) {
      breakdown.push(`Base: $${baseRate.toFixed(2)} (@${ratedWeight}lb)`);
    } else {
      breakdown.push(`Base: $${baseRate.toFixed(2)}`);
    }
    
    // Pickup fee per lb (UNIUNI only)
    if (supplierObj.category === 'UNIUNI' && supplierObj.pickup_fee_per_lb && supplierObj.pickup_fee_per_lb > 0) {
      const poundsForPickup = Math.ceil(weight); // Charge per full pound (round up)
      const pickupFee = poundsForPickup * supplierObj.pickup_fee_per_lb;
      totalCost += pickupFee;
      breakdown.push(`Pickup: $${pickupFee.toFixed(2)} (@${poundsForPickup}lb)`);
    }
    
    // Residential surcharge for Home Delivery
    if (serviceType === 'home_delivery') {
      const residentialCharge = getSupplierSurcharge(supplier, 'residential', zone);
      if (residentialCharge) {
        totalCost += residentialCharge;
        breakdown.push(`Resi: $${residentialCharge.toFixed(2)}`);
      }
    }
    
    // Signature surcharges
    if (signatureType === 'direct') {
      const signatureCharge = getSupplierSurcharge(supplier, 'Direct Signature', zone);
      if (signatureCharge) {
        totalCost += signatureCharge;
        breakdown.push(`DSig: $${signatureCharge.toFixed(2)}`);
      }
    } else if (signatureType === 'adult') {
      const signatureCharge = getSupplierSurcharge(supplier, 'Adult Signature', zone);
      if (signatureCharge) {
        totalCost += signatureCharge;
        breakdown.push(`ASig: $${signatureCharge.toFixed(2)}`);
      }
    }
    
    // DAS surcharges
    if (dasLevel !== 'none') {
      const dasName = serviceType === 'home_delivery' 
        ? (dasLevel === 'das1' ? 'DAS Resi' : dasLevel === 'das2' ? 'DAS Extended Resi' : 'DAS Remote Residential')
        : (dasLevel === 'das1' ? 'DAS Comm' : dasLevel === 'das2' ? 'DAS Extended Comm' : 'DAS Remote Comm');
      const dasCharge = getSupplierSurcharge(supplier, dasName, zone);
      if (dasCharge) {
        totalCost += dasCharge;
        breakdown.push(`DAS: $${dasCharge.toFixed(2)}`);
      }
    }
    
    // AHS surcharges - only charge the highest
    let maxAHS = 0;
    let ahsName = '';
    
    // AHS - Weight (auto for >= 50 lbs)
    if (weight >= 50) {
      const ahsWeight = getSupplierSurcharge(supplier, 'AHS - Weight', zone);
      if (ahsWeight && ahsWeight > maxAHS) {
        maxAHS = ahsWeight;
        ahsName = 'AHS-W';
      }
    }
    
    // Check selected AHS options
    if (selectedAHS.includes('oversize')) {
      const oversizeCharge = getSupplierSurcharge(supplier, 'Oversize Charge', zone);
      if (oversizeCharge && oversizeCharge > maxAHS) {
        maxAHS = oversizeCharge;
        ahsName = 'Oversize';
      }
    }
    
    if (selectedAHS.includes('ahs_dimension')) {
      const ahsDim = getSupplierSurcharge(supplier, 'AHS - Dimensions', zone);
      if (ahsDim && ahsDim > maxAHS) {
        maxAHS = ahsDim;
        ahsName = 'AHS-D';
      }
    }
    
    if (selectedAHS.includes('additional_handling')) {
      const ahsReg = getSupplierSurcharge(supplier, 'Additional Handling', zone);
      if (ahsReg && ahsReg > maxAHS) {
        maxAHS = ahsReg;
        ahsName = 'AHS';
      }
    }
    
    if (maxAHS > 0) {
      totalCost += maxAHS;
      breakdown.push(`${ahsName}: $${maxAHS.toFixed(2)}`);
    }
    
    // Demand surcharges - applied from SUPPLIER's demand surcharges (not FedEx contract)
    // demandEnabled is now a boolean (true/false) instead of an array
    if (demandEnabled && supplierObj) {
      // Get demand surcharges from this supplier's fixed_surcharges
      const supplierDemandResi = getSupplierSurcharge(supplier, 'Demand Surcharge', zone);
      const supplierDemandAHS = getSupplierSurcharge(supplier, "Demand-Add'l Handling", zone);
      const supplierDemandOS = getSupplierSurcharge(supplier, 'Demand-Oversize', zone);
      
      // 1. Demand Surcharge (for Residential/Home Delivery)
      if (serviceType === 'home_delivery' && supplierDemandResi) {
        totalCost += supplierDemandResi;
        breakdown.push(`Demand: $${supplierDemandResi.toFixed(2)}`);
      }
      
      // 2. Check if Oversize is triggered (overrides AHS demand)
      if (selectedAHS.includes('oversize') && supplierDemandOS) {
        totalCost += supplierDemandOS;
        breakdown.push(`Demand-OS: $${supplierDemandOS.toFixed(2)}`);
      } 
      // 3. If NOT oversize, check if AHS is triggered
      else if ((weight >= 50 || selectedAHS.includes('ahs_dimension') || selectedAHS.includes('additional_handling')) && supplierDemandAHS) {
        totalCost += supplierDemandAHS;
        breakdown.push(`Demand-AH: $${supplierDemandAHS.toFixed(2)}`);
      }
    }
    
    // Fuel surcharge
    let fuelCharge = 0;
    
    // Check if supplier has custom fuel settings
    if (supplierData && supplierData.suppliers) {
        const supplierObj = supplierData.suppliers.find(s => s.id === supplier);
        if (supplierObj) {
          // Check if this supplier has no fuel surcharge for Home Delivery
          if (supplierObj.no_fuel_home_delivery && serviceType === 'home_delivery') {
            // No fuel surcharge for Home Delivery
            breakdown.push(`Fuel: $0.00 (HD exempt)`);
          } else if (supplierObj.fuel_type === 'discount' && supplierObj.fuel_discount !== undefined) {
            // Apply discount: effective rate = fuelPercentage * (1 - discount%)
            const effectiveRate = fuelPercentage * (1 - supplierObj.fuel_discount / 100);
            fuelCharge = totalCost * (effectiveRate / 100);
            breakdown.push(`Fuel: $${fuelCharge.toFixed(2)} (${effectiveRate.toFixed(1)}%)`);
          } else if (supplierObj.fuel_type === 'fixed' && supplierObj.fuel_fixed !== undefined) {
            // Use fixed rate regardless of market fuel percentage
            fuelCharge = totalCost * (supplierObj.fuel_fixed / 100);
            breakdown.push(`Fuel: $${fuelCharge.toFixed(2)} (${supplierObj.fuel_fixed}%)`);
          } else {
            // Default: use market fuel percentage
            fuelCharge = totalCost * (fuelPercentage / 100);
            breakdown.push(`Fuel: $${fuelCharge.toFixed(2)}`);
          }
        } else {
          // Supplier not found, use default
          fuelCharge = totalCost * (fuelPercentage / 100);
          breakdown.push(`Fuel: $${fuelCharge.toFixed(2)}`);
        }
      } else {
        // No supplier data: use market fuel percentage
        fuelCharge = totalCost * (fuelPercentage / 100);
        breakdown.push(`Fuel: $${fuelCharge.toFixed(2)}`);
      }
      
      totalCost += fuelCharge;
    
    prices.push({
      supplier: supplier,
      total: totalCost,
      breakdown: breakdown
    });
  });
  
  // Sort by price (ascending - cheapest first)
  prices.sort((a, b) => a.total - b.total);
  
  return prices;
}

// Color palette for suppliers (distinct, vibrant colors)
const supplierColors = [
  { bg: '#667eea', border: '#5568d3', text: '#ffffff' }, // Purple
  { bg: '#f093fb', border: '#e57fe8', text: '#ffffff' }, // Pink
  { bg: '#4facfe', border: '#3b9aec', text: '#ffffff' }, // Blue
  { bg: '#43e97b', border: '#38d66c', text: '#ffffff' }, // Green
  { bg: '#fa709a', border: '#e85d87', text: '#ffffff' }, // Rose
  { bg: '#fee140', border: '#ebd12f', text: '#2c3e50' }, // Yellow
  { bg: '#30cfd0', border: '#2ab8b9', text: '#ffffff' }, // Cyan
  { bg: '#a8edea', border: '#96dbd9', text: '#2c3e50' }, // Light cyan
];

function getSupplierColor(supplierIndex) {
  return supplierColors[supplierIndex % supplierColors.length];
}

function formatPricesCell(prices, suppliers) {
  if (prices.length === 0) return '<span style="color: #999;">N/A</span>';
  
  // Find the maximum price for calculating relative bar widths
  const maxPrice = prices.length > 0 ? Math.max(...prices.map(p => p.total)) : 0;
  
  let html = '<div style="font-size: 11px;">';
  prices.forEach((price, idx) => {
    let supplierName = price.supplier;
    
    // Get actual supplier name
    if (supplierData && supplierData.suppliers) {
      const supplierObj = supplierData.suppliers.find(s => s.id === price.supplier);
      if (supplierObj) {
        supplierName = supplierObj.name;
      }
    }
    
    // Get supplier index for color assignment
    const supplierIndex = suppliers.indexOf(price.supplier);
    const colorScheme = getSupplierColor(supplierIndex);
    
    // Cheapest gets full color, others get muted
    const isCheapest = idx === 0;
    const opacity = isCheapest ? '1' : '0.5';
    const fontSize = isCheapest ? '12px' : '11px';
    const fontWeight = isCheapest ? '700' : '500';
    const borderWidth = isCheapest ? '2px' : '1px';
    
    // Calculate bar width as percentage of max price (minimum 30% for visibility)
    const barWidth = maxPrice > 0 ? Math.max(30, (price.total / maxPrice) * 100) : 100;
    
    // Use dark text color that's visible on both colored and white backgrounds
    const textColor = '#1f2937';
    const breakdownColor = '#4b5563';
    
    html += `<div style="margin-bottom: 5px; padding: 6px 8px; background: linear-gradient(to right, ${colorScheme.bg} 0%, ${colorScheme.bg} ${barWidth}%, transparent ${barWidth}%, transparent 100%); opacity: ${opacity}; border-left: ${borderWidth} solid ${colorScheme.border}; border-radius: 5px; position: relative;" class="price-item">`;
    html += `<div style="color: ${textColor}; font-weight: ${fontWeight}; font-size: ${fontSize};">`;
    html += `${supplierName}: $${price.total.toFixed(2)}</div>`;
    html += `<div style="color: ${breakdownColor}; font-size: 9px; opacity: 0.85; margin-top: 2px;" class="breakdown-detail">${price.breakdown.join(' + ')}</div>`;
    html += `</div>`;
  });
  html += '</div>';
  
  return html;
}

function getBaseRateForSupplier(supplier, weight, zone, serviceType = 'home_delivery') {
  if (!supplierData || !supplierData.suppliers) return null;
  
  const supplierObj = supplierData.suppliers.find(s => s.id === supplier);
  if (!supplierObj) return null;
  
  // Determine service prefix ('hd' or 'ground')
  const service = serviceType === 'home_delivery' ? 'hd' : 'ground';
  
  // If Ground doesn't have separate rates, use HD rates
  let actualService = service;
  if (service === 'ground' && (!supplierObj.ground_base_rates_lb || supplierObj.ground_base_rates_lb.length === 0)) {
    actualService = 'hd';
  }
  
  // Determine unit (oz or lb)
  let unit = 'lb';
  let lookupWeight = weight;
  
  // Try ounce rates for weights < 1 lb (no service prefix for ounces)
  if (weight < 1) {
    const ozRatesKey = 'base_rates_oz';
    if (supplierObj[ozRatesKey] && supplierObj[ozRatesKey].length > 0) {
      unit = 'oz';
      lookupWeight = Math.ceil(weight * 16); // Convert to ounces
      
      // For ounces, use simple key structure
      const ozZones = supplierObj.zones_oz || [2, 3, 4, 5, 6, 7, 8];
      const ozWeightStart = supplierObj.weight_start_oz || 1;
      const ozWeightEnd = supplierObj.weight_end_oz || supplierObj[ozRatesKey].length;
      
      if (lookupWeight < ozWeightStart || lookupWeight > ozWeightEnd) return null;
      
      const ozZoneIdx = ozZones.indexOf(zone);
      if (ozZoneIdx === -1) return null;
      
      const ozWeightIdx = lookupWeight - ozWeightStart;
      if (ozWeightIdx < 0 || ozWeightIdx >= supplierObj[ozRatesKey].length) return null;
      
      const ozRow = supplierObj[ozRatesKey][ozWeightIdx];
      if (!ozRow || ozZoneIdx >= ozRow.length) return null;
      
      let ozRate = parseFloat(ozRow[ozZoneIdx]);
      if (isNaN(ozRate) || ozRate === 0) return null;
      
      // Apply markup to ounce rate
      const markup = parseFloat(supplierObj.markup) || 0;
      if (markup > 0) {
        ozRate = ozRate * (1 + markup / 100);
      }
      
      return ozRate;
    }
  }
  
  // Get rate metadata (for pounds only, ounces handled above)
  const ratesKey = `${actualService}_base_rates_${unit}`;
  const zonesKey = `${actualService}_zones_${unit}`;
  const weightStartKey = `${actualService}_weight_start_${unit}`;
  const weightEndKey = `${actualService}_weight_end_${unit}`;
  
  const rates = supplierObj[ratesKey];
  if (!rates || rates.length === 0) return null;
  
  // Check if supplier covers this weight range
  const weightStart = supplierObj[weightStartKey] || 1;
  const weightEnd = supplierObj[weightEndKey] || rates.length;
  if (lookupWeight < weightStart || lookupWeight > weightEnd) return null;
  
  // Check if supplier covers this zone
  const zones = supplierObj[zonesKey] || [2, 3, 4, 5, 6, 7, 8];
  const zoneIdx = zones.indexOf(zone);
  if (zoneIdx === -1) return null;
  
  // Get the rate
  const weightIdx = lookupWeight - weightStart;
  if (weightIdx < 0 || weightIdx >= rates.length) return null;
  
  const row = rates[weightIdx];
  if (!row || zoneIdx >= row.length) return null;
  
  let rate = parseFloat(row[zoneIdx]);
  if (isNaN(rate) || rate === 0) return null;
  
  // Apply markup
  const markup = parseFloat(supplierObj.markup) || 0;
  if (markup > 0) {
    rate = rate * (1 + markup / 100);
  }
  
  return rate;
}

function getSupplierSurcharge(supplier, surchargeName, zone = null) {
  // Normalize the search name
  const searchName = surchargeName.toLowerCase();
  
  // Look up in supplierData
  if (supplierData && supplierData.suppliers) {
    const supplierObj = supplierData.suppliers.find(s => s.id === supplier);
    if (!supplierObj) return null;
    
    let surchargeAmount = null;
    
    // Check zone-based surcharges first if zone is provided
    if (zone !== null && supplierObj.zone_based_surcharges) {
      const zoneBased = supplierObj.zone_based_surcharges.find(s => {
        const desc = s.description.toLowerCase();
        return desc === searchName || desc.includes(searchName.replace(' - ', ' '));
      });
      
      if (zoneBased && zoneBased.zone_rates) {
        surchargeAmount = getZoneBasedAmount(zoneBased, zone);
      }
    }
    
    // Check fixed surcharges if not found
    if (surchargeAmount === null && supplierObj.fixed_surcharges) {
      const fixed = supplierObj.fixed_surcharges.find(s => {
        const desc = s.description.toLowerCase();
        return desc === searchName || desc.includes(searchName.replace(' - ', ' '));
      });
      
      if (fixed) {
        surchargeAmount = parseFloat(fixed.amount) || 0;
      }
    }
    
    // Apply markup if surcharge found
    if (surchargeAmount !== null) {
      const markup = parseFloat(supplierObj.markup) || 0;
      if (markup > 0) {
        surchargeAmount = surchargeAmount * (1 + markup / 100);
      }
      return surchargeAmount;
    }
  }
  
  return null; // Supplier doesn't have this surcharge
}

function getZoneBasedAmount(surcharge, zone) {
  if (!zone) return null;
  
  const zoneRates = surcharge.zone_rates || {};
  
  // Try exact match first
  if (zoneRates[zone.toString()]) {
    return parseFloat(zoneRates[zone.toString()]);
  }
  
  // Try zone ranges (e.g., "3-4")
  for (const zoneKey in zoneRates) {
    if (zoneKey.includes('-')) {
      const [start, end] = zoneKey.split('-').map(Number);
      if (zone >= start && zone <= end) {
        return parseFloat(zoneRates[zoneKey]);
      }
    }
  }
  
  return null;
}

// ===============================
// Customer Quote Logic
// ===============================

let quoteInputMode = 'single';
let quoteUnits = 'cm_kg';

async function initCustomerQuoteTab() {
  // Load warehouse ops data for fee calculations
  try {
    const res = await fetch('/api/warehouse_ops');
    window._warehouseOpsData = await res.json();
  } catch (e) {
    console.error('Error loading warehouse ops data:', e);
    window._warehouseOpsData = {};
  }
  
  const generateBtn = document.getElementById('generate-quote-btn');
  const clearBtn = document.getElementById('clear-quote-btn');
  
  if (generateBtn) {
    generateBtn.addEventListener('click', handleGenerateQuote);
  }
  
  if (clearBtn) {
    clearBtn.addEventListener('click', handleClearQuote);
  }
  
  // Input mode toggle
  const modeRadios = document.querySelectorAll('input[name="quote-input-mode"]');
  modeRadios.forEach(radio => {
    radio.addEventListener('change', function() {
      quoteInputMode = this.value;
      updateQuoteInputMode();
    });
  });
  
  // Units selector
  const unitsSelect = document.getElementById('quote-units');
  if (unitsSelect) {
    unitsSelect.addEventListener('change', function() {
      quoteUnits = this.value;
      updateUnitLabels();
    });
  }
  
  // Bulk input: Add row button
  const addRowBtn = document.getElementById('quote-bulk-add-row');
  if (addRowBtn) {
    addRowBtn.addEventListener('click', handleAddBulkRow);
  }
  
  // Bulk input: Paste from Excel button
  const pasteExcelBtn = document.getElementById('quote-bulk-paste-excel');
  if (pasteExcelBtn) {
    pasteExcelBtn.addEventListener('click', handleBulkPasteFromExcel);
  }
  
  // Bulk input: Remove row buttons (delegated)
  const bulkTbody = document.getElementById('quote-bulk-tbody');
  if (bulkTbody) {
    bulkTbody.addEventListener('click', function(e) {
      if (e.target.classList.contains('bulk-remove-row')) {
        const row = e.target.closest('tr');
        if (row && bulkTbody.children.length > 1) {
          row.remove();
          renumberBulkRows();
        } else if (bulkTbody.children.length === 1) {
          // Clear the last row instead of removing
          row.querySelectorAll('input').forEach(inp => inp.value = '');
        }
      }
    });
  }
  
  // Live DIM weight preview
  const dimInputs = ['quote-weight', 'quote-length', 'quote-width', 'quote-height'];
  dimInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', updateDimPreview);
    }
  });
}

function handleAddBulkRow() {
  const tbody = document.getElementById('quote-bulk-tbody');
  if (!tbody) return;
  
  const rowCount = tbody.children.length + 1;
  const newRow = document.createElement('tr');
  newRow.setAttribute('data-row', rowCount);
  newRow.innerHTML = `
    <td style="padding: 8px; text-align: center; border-bottom: 1px solid #e5e7eb;">${rowCount}</td>
    <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><input type="number" class="bulk-weight" step="0.01" min="0" placeholder="Weight" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"></td>
    <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><input type="number" class="bulk-length" step="0.1" min="0" placeholder="Length" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"></td>
    <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><input type="number" class="bulk-width" step="0.1" min="0" placeholder="Width" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"></td>
    <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><input type="number" class="bulk-height" step="0.1" min="0" placeholder="Height" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"></td>
    <td style="padding: 8px; text-align: center; border-bottom: 1px solid #e5e7eb;"><button class="bulk-remove-row" style="background: #ef4444; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer;">✕</button></td>
  `;
  tbody.appendChild(newRow);
}

function renumberBulkRows() {
  const tbody = document.getElementById('quote-bulk-tbody');
  if (!tbody) return;
  
  Array.from(tbody.children).forEach((row, index) => {
    row.setAttribute('data-row', index + 1);
    row.querySelector('td:first-child').textContent = index + 1;
  });
}

function handleBulkPasteFromExcel() {
  const pasteData = prompt(
    'Paste data from Excel (tab-separated or comma-separated).\n\n' +
    'Format: Weight, Length, Width, Height (one package per row)\n' +
    'Example:\n2.5\t30\t20\t15\n1.8\t25\t18\t12'
  );
  
  if (!pasteData) return;
  
  const tbody = document.getElementById('quote-bulk-tbody');
  if (!tbody) return;
  
  const lines = pasteData.trim().split('\n').filter(line => line.trim());
  
  if (lines.length === 0) {
    alert('No valid data found.');
    return;
  }
  
  // Clear existing rows
  tbody.innerHTML = '';
  
  let importedCount = 0;
  for (const line of lines) {
    // Parse CSV or tab-separated
    const parts = line.split(/[,\t]+/).map(p => parseFloat(p.trim())).filter(p => !isNaN(p));
    
    if (parts.length >= 4) {
      const [weight, length, width, height] = parts;
      const rowNum = importedCount + 1;
      
      const newRow = document.createElement('tr');
      newRow.setAttribute('data-row', rowNum);
      newRow.innerHTML = `
        <td style="padding: 8px; text-align: center; border-bottom: 1px solid #e5e7eb;">${rowNum}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><input type="number" class="bulk-weight" step="0.01" min="0" value="${weight}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"></td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><input type="number" class="bulk-length" step="0.1" min="0" value="${length}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"></td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><input type="number" class="bulk-width" step="0.1" min="0" value="${width}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"></td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><input type="number" class="bulk-height" step="0.1" min="0" value="${height}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"></td>
        <td style="padding: 8px; text-align: center; border-bottom: 1px solid #e5e7eb;"><button class="bulk-remove-row" style="background: #ef4444; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer;">✕</button></td>
      `;
      tbody.appendChild(newRow);
      importedCount++;
    }
  }
  
  if (importedCount === 0) {
    // Add at least one empty row
    handleAddBulkRow();
    alert('Could not parse any valid packages. Format: Weight, Length, Width, Height (one per row)');
  } else {
    alert(`Imported ${importedCount} package(s) successfully.`);
  }
}

function updateQuoteInputMode() {
  const singleSection = document.getElementById('single-input-section');
  const bulkSection = document.getElementById('bulk-input-section');
  const dimPreview = document.getElementById('quote-dim-preview');
  
  // Update radio button styles
  const labels = document.querySelectorAll('input[name="quote-input-mode"]');
  labels.forEach(radio => {
    const label = radio.closest('label');
    if (radio.value === quoteInputMode) {
      label.style.background = '#3b82f6';
      label.style.color = 'white';
    } else {
      label.style.background = '#e5e7eb';
      label.style.color = '#374151';
    }
  });
  
  if (quoteInputMode === 'single') {
    singleSection.style.display = 'block';
    bulkSection.style.display = 'none';
  } else {
    singleSection.style.display = 'none';
    bulkSection.style.display = 'block';
    dimPreview.style.display = 'none';
  }
}

function updateUnitLabels() {
  const weightLabel = document.getElementById('weight-unit-label');
  const dimLabel = document.getElementById('dim-unit-label');
  
  // Also update bulk table header units
  const bulkWeightUnits = document.querySelectorAll('.bulk-weight-unit');
  const bulkDimUnits = document.querySelectorAll('.bulk-dim-unit');
  
  if (quoteUnits === 'cm_kg') {
    if (weightLabel) weightLabel.textContent = 'kg';
    if (dimLabel) dimLabel.textContent = 'cm';
    bulkWeightUnits.forEach(el => el.textContent = 'kg');
    bulkDimUnits.forEach(el => el.textContent = 'cm');
  } else {
    if (weightLabel) weightLabel.textContent = 'lbs';
    if (dimLabel) dimLabel.textContent = 'inches';
    bulkWeightUnits.forEach(el => el.textContent = 'lbs');
    bulkDimUnits.forEach(el => el.textContent = 'in');
  }
}

function updateDimPreview() {
  let weight = parseFloat(document.getElementById('quote-weight')?.value) || 0;
  let length = parseFloat(document.getElementById('quote-length')?.value) || 0;
  let width = parseFloat(document.getElementById('quote-width')?.value) || 0;
  let height = parseFloat(document.getElementById('quote-height')?.value) || 0;
  
  const previewDiv = document.getElementById('quote-dim-preview');
  
  if (weight > 0 && length > 0 && width > 0 && height > 0) {
    // Convert to inches/lbs if in cm/kg mode
    if (quoteUnits === 'cm_kg' && window.CustomerQuote) {
      const converted = window.CustomerQuote.convertToInchLb(weight, length, width, height);
      weight = converted.weight;
      length = converted.length;
      width = converted.width;
      height = converted.height;
    }
    
    // Calculate DIM weights for all three divisors
    const volume = Math.ceil(length) * Math.ceil(width) * Math.ceil(height);
    const actualWeightRounded = Math.ceil(weight);
    
    const dimWeight166 = Math.ceil(volume / 166);
    const dimWeight225 = Math.ceil(volume / 225);
    const dimWeight250 = Math.ceil(volume / 250);
    
    const billedWeight166 = Math.max(actualWeightRounded, dimWeight166);
    const billedWeight225 = Math.max(actualWeightRounded, dimWeight225);
    const billedWeight250 = Math.max(actualWeightRounded, dimWeight250);
    
    const perimeter = Math.ceil(length) + (Math.ceil(width) + Math.ceil(height)) * 2;
    
    // Check for ounce-based pricing eligibility
    const actualWeightOz = Math.ceil(weight * 16);
    const isOunceEligible = actualWeightOz <= 15;
    
    document.getElementById('preview-actual-weight').textContent = weight.toFixed(2);
    
    // Show ounce weight if eligible
    if (isOunceEligible) {
      document.getElementById('preview-actual-weight-rounded').textContent = actualWeightOz + ' oz';
      document.getElementById('preview-actual-weight-rounded').style.color = '#059669';
    } else {
      document.getElementById('preview-actual-weight-rounded').textContent = actualWeightRounded + ' lbs';
      document.getElementById('preview-actual-weight-rounded').style.color = '';
    }
    
    document.getElementById('preview-perimeter').textContent = perimeter.toFixed(1);
    document.getElementById('preview-volume').textContent = volume;
    
    // Update three DIM weight displays
    if (isOunceEligible) {
      document.getElementById('preview-dim-166').textContent = '⚡ ' + actualWeightOz + ' oz';
      document.getElementById('preview-billed-166').textContent = actualWeightOz + ' oz';
    } else {
      document.getElementById('preview-dim-166').textContent = dimWeight166 + ' lbs';
      document.getElementById('preview-billed-166').textContent = billedWeight166 + ' lbs';
    }
    document.getElementById('preview-dim-225').textContent = dimWeight225 + ' lbs';
    document.getElementById('preview-billed-225').textContent = billedWeight225 + ' lbs';
    document.getElementById('preview-dim-250').textContent = dimWeight250 + ' lbs';
    document.getElementById('preview-billed-250').textContent = billedWeight250 + ' lbs';
    
    previewDiv.style.display = 'block';
  } else {
    previewDiv.style.display = 'none';
  }
}

async function handleGenerateQuote() {
  const resultsContainer = document.getElementById('quote-results');
  
  // Get fuel rates
  const fuelRates = {
    fedex: parseFloat(document.getElementById('quote-fuel-fedex')?.value) || 21.25,
    ups: parseFloat(document.getElementById('quote-fuel-ups')?.value) || 20.75
  };
  
  let packages = [];
  let serviceType = 'residential';
  let signature = false;
  
  if (quoteInputMode === 'single') {
    // Single package mode
    let weight = parseFloat(document.getElementById('quote-weight')?.value) || 0;
    let length = parseFloat(document.getElementById('quote-length')?.value) || 0;
    let width = parseFloat(document.getElementById('quote-width')?.value) || 0;
    let height = parseFloat(document.getElementById('quote-height')?.value) || 0;
    
    // Validate inputs
    if (weight <= 0) {
      alert('Please enter a valid weight.');
      return;
    }
    if (length <= 0 || width <= 0 || height <= 0) {
      alert('Please enter valid dimensions (length, width, height).');
      return;
    }
    
    // Convert to inches/lbs if in cm/kg mode
    if (quoteUnits === 'cm_kg' && window.CustomerQuote) {
      const converted = window.CustomerQuote.convertToInchLb(weight, length, width, height);
      weight = converted.weight;
      length = converted.length;
      width = converted.width;
      height = converted.height;
    }
    
    packages = [{ weight, length, width, height }];
    serviceType = document.getElementById('quote-service-type')?.value || 'residential';
    signature = document.getElementById('quote-signature')?.checked || false;
    
  } else {
    // Bulk mode - read from row-based table
    const tbody = document.getElementById('quote-bulk-tbody');
    const rows = tbody ? tbody.querySelectorAll('tr') : [];
    
    if (rows.length === 0) {
      alert('Please add at least one package row.');
      return;
    }
    
    for (const row of rows) {
      let weight = parseFloat(row.querySelector('.bulk-weight')?.value) || 0;
      let length = parseFloat(row.querySelector('.bulk-length')?.value) || 0;
      let width = parseFloat(row.querySelector('.bulk-width')?.value) || 0;
      let height = parseFloat(row.querySelector('.bulk-height')?.value) || 0;
      
      if (weight > 0 && length > 0 && width > 0 && height > 0) {
        // Convert to inches/lbs if in cm/kg mode
        if (quoteUnits === 'cm_kg' && window.CustomerQuote) {
          const converted = window.CustomerQuote.convertToInchLb(weight, length, width, height);
          weight = converted.weight;
          length = converted.length;
          width = converted.width;
          height = converted.height;
        }
        
        packages.push({ weight, length, width, height });
      }
    }
    
    if (packages.length === 0) {
      alert('Please enter valid package data (weight, length, width, height) in at least one row.');
      return;
    }
    
    serviceType = document.getElementById('quote-bulk-service-type')?.value || 'residential';
    // Override fuel rates from bulk inputs (now separate for FedEx and UPS)
    const bulkFuelFedex = parseFloat(document.getElementById('quote-bulk-fuel-fedex')?.value) || 21.25;
    const bulkFuelUps = parseFloat(document.getElementById('quote-bulk-fuel-ups')?.value) || 20.75;
    fuelRates.fedex = bulkFuelFedex;
    fuelRates.ups = bulkFuelUps;
  }
  
  resultsContainer.innerHTML = `
    <div style="text-align: center; padding: 40px;">
      <div style="font-size: 24px; margin-bottom: 10px;">⏳</div>
      <p>Generating quote matrix for ${packages.length} package(s)...</p>
    </div>
  `;
  
  try {
    const options = {
      serviceType,
      signature,
      fuelRates
    };
    
    // Check if user has permission to see cost/profit
    const canViewCostProfit = window.USER_PERMISSIONS?.includes('view_cost_profit');
    const showProfitData = canViewCostProfit;
    
    // Fetch suppliers if user has permission to see cost/profit
    let suppliers = [];
    if (showProfitData) {
      try {
        const suppliersRes = await fetch('/api/suppliers');
        const suppliersData = await suppliersRes.json();
        suppliers = suppliersData.suppliers || [];
      } catch (e) {
        console.warn('Could not load suppliers for profit calculation:', e);
      }
    }
    
    // Generate quote matrix using the customerQuote module
    if (packages.length === 1) {
      const pkg = packages[0];
      let matrix = await window.CustomerQuote.generateQuoteMatrix(
        pkg.weight, pkg.length, pkg.width, pkg.height, options
      );
      
      // Enrich with profit data if permitted and suppliers available
      if (showProfitData && suppliers.length > 0) {
        const isResidential = serviceType === 'residential';
        matrix = await window.CustomerQuote.calculateProfitMatrix(matrix, suppliers, fuelRates, isResidential);
      }
      
      // Pass permission flags to render function
      window.CustomerQuote.renderQuoteMatrix(matrix, resultsContainer, pkg, { canViewCost: canViewCostProfit, canViewProfit: canViewCostProfit });
    } else {
      // Bulk mode - generate for all packages
      let bulkResults = await window.CustomerQuote.generateBulkQuotes(packages, options);
      
      // Enrich with profit data if permitted
      if (showProfitData && suppliers.length > 0) {
        const isResidential = serviceType === 'residential';
        const enrichedResults = [];
        for (const result of bulkResults) {
          enrichedResults.push(await window.CustomerQuote.calculateProfitMatrix(result, suppliers, fuelRates, isResidential));
        }
        bulkResults = enrichedResults;
      }
      
      window.CustomerQuote.renderBulkResults(bulkResults, resultsContainer, { canViewCost: canViewCostProfit, canViewProfit: canViewCostProfit });
    }
  } catch (err) {
    console.error('Error generating quotes:', err);
    resultsContainer.innerHTML = `
      <div style="text-align: center; color: #dc2626; padding: 40px;">
        <div style="font-size: 48px; margin-bottom: 15px;">⚠️</div>
        <p style="font-size: 16px;">Error generating quotes: ${err.message}</p>
      </div>
    `;
  }
}

function handleClearQuote() {
  // Clear single inputs
  const singleInputs = ['quote-weight', 'quote-length', 'quote-width', 'quote-height'];
  singleInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  
  // Reset options
  const serviceType = document.getElementById('quote-service-type');
  if (serviceType) serviceType.value = 'residential';
  
  const signature = document.getElementById('quote-signature');
  if (signature) signature.checked = false;
  
  // Clear bulk input table - reset to single empty row
  const tbody = document.getElementById('quote-bulk-tbody');
  if (tbody) {
    tbody.innerHTML = `
      <tr data-row="1">
        <td style="padding: 8px; text-align: center; border-bottom: 1px solid #e5e7eb;">1</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><input type="number" class="bulk-weight" step="0.01" min="0" placeholder="Weight" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"></td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><input type="number" class="bulk-length" step="0.1" min="0" placeholder="Length" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"></td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><input type="number" class="bulk-width" step="0.1" min="0" placeholder="Width" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"></td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><input type="number" class="bulk-height" step="0.1" min="0" placeholder="Height" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"></td>
        <td style="padding: 8px; text-align: center; border-bottom: 1px solid #e5e7eb;"><button class="bulk-remove-row" style="background: #ef4444; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer;">✕</button></td>
      </tr>
    `;
  }
  
  // Hide preview
  const dimPreview = document.getElementById('quote-dim-preview');
  if (dimPreview) dimPreview.style.display = 'none';
  
  // Reset results
  document.getElementById('quote-results').innerHTML = `
    <div style="text-align: center; color: #666; padding: 60px 20px; background: #f8fafc; border-radius: 12px; border: 2px dashed #e5e7eb;">
      <div style="font-size: 48px; margin-bottom: 15px;">📊</div>
      <p style="font-size: 16px; margin: 0 0 10px 0;">Enter package details and click "Generate Quote Matrix"</p>
      <p style="font-size: 13px; color: #9ca3af; margin: 0;">Results will show the best price for each Zone (columns) × DAS option (rows)</p>
    </div>
  `;
}

// ===============================
// Quote Carrier Pricing Management
// ===============================

let quotePricingData = null;
let currentQuoteCarrier = null;

async function loadQuotePricingData() {
  try {
    const res = await fetch('/api/quote-pricing');
    quotePricingData = await res.json();
    return quotePricingData;
  } catch (error) {
    console.error('Error loading quote pricing:', error);
    quotePricingData = { version: "1.0", fuelRates: {}, carriers: {} };
    return quotePricingData;
  }
}

async function saveQuotePricingData(data) {
  try {
    const res = await fetch('/api/quote-pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.json();
  } catch (error) {
    console.error('Error saving quote pricing:', error);
    throw error;
  }
}

async function initQuotePricingSettings() {
  const carrierSelect = document.getElementById('quote-carrier-select');
  const saveFuelBtn = document.getElementById('save-quote-fuel-btn');
  const saveCarrierBtn = document.getElementById('save-quote-carrier-btn');
  const addWeightRowBtn = document.getElementById('quote-add-weight-row');
  const importRatesBtn = document.getElementById('quote-import-rates');
  const importOunceRatesBtn = document.getElementById('quote-import-ounce-rates');
  const enabledCheckbox = document.getElementById('quote-carrier-enabled');
  
  if (carrierSelect) {
    carrierSelect.addEventListener('change', handleQuoteCarrierSelect);
  }
  
  if (saveFuelBtn) {
    saveFuelBtn.addEventListener('click', handleSaveQuoteFuelRates);
  }
  
  if (saveCarrierBtn) {
    saveCarrierBtn.addEventListener('click', handleSaveQuoteCarrier);
  }
  
  if (addWeightRowBtn) {
    addWeightRowBtn.addEventListener('click', handleAddQuoteWeightRow);
  }
  
  if (importRatesBtn) {
    importRatesBtn.addEventListener('click', handleImportQuoteRates);
  }
  
  if (importOunceRatesBtn) {
    importOunceRatesBtn.addEventListener('click', handleImportQuoteOunceRates);
  }
  
  if (enabledCheckbox) {
    enabledCheckbox.addEventListener('change', function() {
      if (currentQuoteCarrier && quotePricingData?.carriers?.[currentQuoteCarrier]) {
        quotePricingData.carriers[currentQuoteCarrier].enabled = this.checked;
      }
    });
  }
  
  // Load quote pricing data on init
  if (!quotePricingData) {
    await loadQuotePricingData();
    populateQuoteFuelRates();
  }
}

function populateQuoteFuelRates() {
  if (!quotePricingData?.fuelRates) return;
  
  const fedexInput = document.getElementById('quote-config-fuel-fedex');
  const upsInput = document.getElementById('quote-config-fuel-ups');
  
  if (fedexInput && quotePricingData.fuelRates.fedex !== undefined) {
    fedexInput.value = quotePricingData.fuelRates.fedex;
  }
  if (upsInput && quotePricingData.fuelRates.ups !== undefined) {
    upsInput.value = quotePricingData.fuelRates.ups;
  }
}

async function handleSaveQuoteFuelRates() {
  const fedexRate = parseFloat(document.getElementById('quote-config-fuel-fedex')?.value) || 21.25;
  const upsRate = parseFloat(document.getElementById('quote-config-fuel-ups')?.value) || 20.75;
  
  try {
    const res = await fetch('/api/quote-pricing/fuel-rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fedex: fedexRate, ups: upsRate })
    });
    const result = await res.json();
    
    if (result.success) {
      alert('Fuel rates saved successfully!');
      // Update local data
      if (quotePricingData) {
        quotePricingData.fuelRates = { fedex: fedexRate, ups: upsRate };
      }
    } else {
      alert('Error saving fuel rates: ' + (result.error || 'Unknown error'));
    }
  } catch (error) {
    alert('Error saving fuel rates: ' + error.message);
  }
}

async function handleQuoteCarrierSelect() {
  const carrierId = document.getElementById('quote-carrier-select').value;
  const editor = document.getElementById('quote-carrier-editor');
  const placeholder = document.getElementById('quote-carrier-placeholder');
  
  if (!carrierId) {
    editor.style.display = 'none';
    placeholder.style.display = 'block';
    currentQuoteCarrier = null;
    return;
  }
  
  currentQuoteCarrier = carrierId;
  
  // Load data if not loaded
  if (!quotePricingData) {
    await loadQuotePricingData();
  }
  
  const carrierConfig = quotePricingData?.carriers?.[carrierId] || {};
  
  // Update enabled checkbox
  document.getElementById('quote-carrier-enabled').checked = carrierConfig.enabled !== false;
  
  // Update carrier info
  document.getElementById('quote-carrier-dim').textContent = carrierConfig.dimDivisor || '-';
  document.getElementById('quote-carrier-weight').textContent = 
    (carrierConfig.minWeight || 0) + ' - ' + (carrierConfig.maxWeight || '-') + ' lbs';
  document.getElementById('quote-carrier-zones').textContent = 
    carrierConfig.zones ? carrierConfig.zones.join(', ') : '-';
  document.getElementById('quote-carrier-fuel').textContent = 
    carrierConfig.hasFuel ? 'Yes (' + (carrierConfig.fuelCategory || 'fedex') + ')' : 'No';
  document.getElementById('quote-carrier-notes').textContent = carrierConfig.notes || '-';
  
  // Show/hide ounce rates section for UNIUNI, GOFO, USPS
  const ounceRatesSection = document.getElementById('quote-ounce-rates-section');
  const hasOunceRates = ['UNIUNI', 'GOFO', 'USPS'].includes(carrierId);
  if (ounceRatesSection) {
    ounceRatesSection.style.display = hasOunceRates ? 'block' : 'none';
  }
  
  // Render ounce rates table if applicable
  if (hasOunceRates) {
    renderQuoteOunceRatesTable(carrierConfig);
  }
  
  // Render rates table
  renderQuoteRatesTable(carrierConfig);
  
  // Render surcharges editor
  renderQuoteSurchargesEditor(carrierId, carrierConfig);
  
  editor.style.display = 'block';
  placeholder.style.display = 'none';
}

function renderQuoteOunceRatesTable(carrierConfig) {
  const thead = document.getElementById('quote-ounce-rates-thead');
  const tbody = document.getElementById('quote-ounce-rates-tbody');
  
  if (!thead || !tbody) return;
  
  const zones = carrierConfig.zones || [1, 2, 3, 4, 5, 6, 7, 8];
  const ounceRates = carrierConfig.ounceRates || { zones: zones, rates: [] };
  
  // Build header
  let headerHtml = '<tr style="background: #fef3c7; position: sticky; top: 0;">';
  headerHtml += '<th style="padding: 8px; min-width: 70px;">Ounces</th>';
  for (const zone of zones) {
    headerHtml += '<th style="padding: 8px; min-width: 70px; text-align: center;">Zone ' + zone + '</th>';
  }
  headerHtml += '</tr>';
  thead.innerHTML = headerHtml;
  
  // Build rows (1-15 oz)
  let bodyHtml = '';
  const rates = ounceRates.rates || [];
  
  for (let oz = 1; oz <= 15; oz++) {
    const rowIndex = oz - 1;
    bodyHtml += '<tr>';
    bodyHtml += '<td style="padding: 4px; background: #fef3c7; font-weight: 600; text-align: center;">' + oz + ' oz</td>';
    
    for (let z = 0; z < zones.length; z++) {
      const rate = rates[rowIndex]?.[z] ?? '';
      bodyHtml += '<td style="padding: 2px;">';
      bodyHtml += '<input type="number" step="0.01" value="' + rate + '" ';
      bodyHtml += 'data-oz="' + oz + '" data-col="' + z + '" ';
      bodyHtml += 'style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; text-align: right; font-size: 12px;" ';
      bodyHtml += 'onchange="updateQuoteOunceRate(this)">';
      bodyHtml += '</td>';
    }
    bodyHtml += '</tr>';
  }
  
  tbody.innerHTML = bodyHtml;
}

function updateQuoteOunceRate(input) {
  if (!currentQuoteCarrier || !quotePricingData?.carriers?.[currentQuoteCarrier]) return;
  
  const oz = parseInt(input.dataset.oz);
  const col = parseInt(input.dataset.col);
  const value = parseFloat(input.value) || 0;
  
  const carrier = quotePricingData.carriers[currentQuoteCarrier];
  if (!carrier.ounceRates) {
    carrier.ounceRates = { zones: carrier.zones || [1,2,3,4,5,6,7,8], rates: [] };
  }
  
  // Ensure rates array has enough rows
  while (carrier.ounceRates.rates.length < 15) {
    carrier.ounceRates.rates.push([]);
  }
  
  const rowIndex = oz - 1;
  if (!carrier.ounceRates.rates[rowIndex]) {
    carrier.ounceRates.rates[rowIndex] = [];
  }
  carrier.ounceRates.rates[rowIndex][col] = value;
}

// Expose globally for inline handlers
window.updateQuoteOunceRate = updateQuoteOunceRate;

function renderQuoteRatesTable(carrierConfig) {
  const thead = document.getElementById('quote-rates-thead');
  const tbody = document.getElementById('quote-rates-tbody');
  
  const zones = carrierConfig.zones || [2, 3, 4, 5, 6, 7, 8];
  const baseRates = carrierConfig.baseRates || { weightStart: 1, zones: zones, rates: [] };
  
  // Build header
  let headerHtml = '<tr style="background: #f1f5f9; position: sticky; top: 0;">';
  headerHtml += '<th style="padding: 8px; min-width: 80px;">Weight (lb)</th>';
  for (const zone of zones) {
    headerHtml += '<th style="padding: 8px; min-width: 70px; text-align: center;">Zone ' + zone + '</th>';
  }
  headerHtml += '<th style="padding: 8px; width: 40px;"></th>';
  headerHtml += '</tr>';
  thead.innerHTML = headerHtml;
  
  // Build rows
  let bodyHtml = '';
  const weightStart = baseRates.weightStart || 1;
  const rates = baseRates.rates || [];
  
  for (let i = 0; i < rates.length; i++) {
    const weight = weightStart + i;
    bodyHtml += '<tr>';
    bodyHtml += '<td style="padding: 4px; background: #f8fafc; font-weight: 600; text-align: center;">' + weight + '</td>';
    
    for (let z = 0; z < zones.length; z++) {
      const rate = rates[i]?.[z] ?? '';
      bodyHtml += '<td style="padding: 2px;">';
      bodyHtml += '<input type="number" step="0.01" value="' + rate + '" ';
      bodyHtml += 'data-row="' + i + '" data-col="' + z + '" ';
      bodyHtml += 'style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; text-align: right; font-size: 12px;" ';
      bodyHtml += 'onchange="updateQuoteRate(this)">';
      bodyHtml += '</td>';
    }
    
    bodyHtml += '<td style="padding: 4px;">';
    bodyHtml += '<button class="btn-remove" style="padding: 4px 8px; font-size: 11px;" onclick="removeQuoteWeightRow(' + i + ')">×</button>';
    bodyHtml += '</td>';
    bodyHtml += '</tr>';
  }
  
  if (rates.length === 0) {
    bodyHtml = '<tr><td colspan="' + (zones.length + 2) + '" style="text-align: center; padding: 20px; color: #666;">No rates configured. Click "+ Add Weight Row" to add rates.</td></tr>';
  }
  
  tbody.innerHTML = bodyHtml;
}

function updateQuoteRate(input) {
  if (!currentQuoteCarrier || !quotePricingData?.carriers?.[currentQuoteCarrier]) return;
  
  const row = parseInt(input.dataset.row);
  const col = parseInt(input.dataset.col);
  const value = parseFloat(input.value) || 0;
  
  const carrier = quotePricingData.carriers[currentQuoteCarrier];
  if (!carrier.baseRates) carrier.baseRates = { weightStart: 1, zones: carrier.zones || [2,3,4,5,6,7,8], rates: [] };
  if (!carrier.baseRates.rates[row]) carrier.baseRates.rates[row] = [];
  
  carrier.baseRates.rates[row][col] = value;
}

function handleAddQuoteWeightRow() {
  if (!currentQuoteCarrier || !quotePricingData?.carriers?.[currentQuoteCarrier]) return;
  
  const carrier = quotePricingData.carriers[currentQuoteCarrier];
  if (!carrier.baseRates) {
    carrier.baseRates = { 
      weightStart: 1, 
      zones: carrier.zones || [2,3,4,5,6,7,8], 
      rates: [] 
    };
  }
  
  // Add empty row
  const zoneCount = carrier.baseRates.zones.length;
  carrier.baseRates.rates.push(new Array(zoneCount).fill(0));
  
  renderQuoteRatesTable(carrier);
}

function removeQuoteWeightRow(rowIndex) {
  if (!currentQuoteCarrier || !quotePricingData?.carriers?.[currentQuoteCarrier]) return;
  
  const carrier = quotePricingData.carriers[currentQuoteCarrier];
  if (carrier.baseRates?.rates) {
    carrier.baseRates.rates.splice(rowIndex, 1);
    renderQuoteRatesTable(carrier);
  }
}

function handleImportQuoteRates() {
  const textarea = prompt(
    'Paste rates from Excel (tab-separated).\n' +
    'Format: Each row is a weight, each column is a zone.\n' +
    'Example:\n4.25\t4.50\t4.75\t5.25\t5.75\t6.25\t7.00\n4.50\t4.75\t5.00\t5.50\t6.00\t6.50\t7.25'
  );
  
  if (!textarea || !currentQuoteCarrier) return;
  
  const carrier = quotePricingData.carriers[currentQuoteCarrier];
  if (!carrier.baseRates) {
    carrier.baseRates = { weightStart: 1, zones: carrier.zones || [2,3,4,5,6,7,8], rates: [] };
  }
  
  const lines = textarea.trim().split('\n');
  const rates = [];
  
  for (const line of lines) {
    const values = line.split('\t').map(v => parseFloat(v.trim()) || 0);
    if (values.length > 0) {
      rates.push(values);
    }
  }
  
  if (rates.length > 0) {
    carrier.baseRates.rates = rates;
    renderQuoteRatesTable(carrier);
    alert('Imported ' + rates.length + ' rows of rates.');
  }
}

function handleImportQuoteOunceRates() {
  const textarea = prompt(
    'Paste ounce rates from Excel (tab-separated).\n' +
    'Format: 15 rows (1-15 oz), each column is a zone.\n' +
    'Example:\n2.00\t2.10\t2.20\t2.30\t2.40\n2.05\t2.15\t2.25\t2.35\t2.45'
  );
  
  if (!textarea || !currentQuoteCarrier) return;
  
  const carrier = quotePricingData.carriers[currentQuoteCarrier];
  if (!carrier.ounceRates) {
    carrier.ounceRates = { zones: carrier.zones || [1,2,3,4,5,6,7,8], rates: [] };
  }
  
  const lines = textarea.trim().split('\n');
  const rates = [];
  
  for (const line of lines) {
    const values = line.split('\t').map(v => parseFloat(v.trim()) || 0);
    if (values.length > 0) {
      rates.push(values);
    }
  }
  
  // Ensure exactly 15 rows (1-15 oz)
  while (rates.length < 15) {
    rates.push([]);
  }
  if (rates.length > 15) {
    rates.length = 15;
  }
  
  carrier.ounceRates.rates = rates;
  renderQuoteOunceRatesTable(carrier);
  alert('Imported ounce rates for ' + Math.min(rates.length, 15) + ' ounce levels.');
}

function renderQuoteSurchargesEditor(carrierId, carrierConfig) {
  const container = document.getElementById('quote-surcharges-editor');
  const surcharges = carrierConfig.surcharges || {};
  
  let html = '';
  
  // Different surcharge fields based on carrier type
  if (carrierId === 'UNIUNI') {
    html += renderSurchargeField('AHS - Dimensions', 'oversize', surcharges.oversize, 'Any dim >18in or perimeter >150cm');
    html += renderSurchargeField('Oversize Surcharge', 'oversizeLarge', surcharges.oversizeLarge, 'Volume >1728 cu in');
    html += renderSurchargeField('AHS - Weight ($/lb over threshold)', 'overweightPerLb', surcharges.overweightPerLb);
    html += renderSurchargeField('AHS - Weight Threshold (lbs)', 'overweightThreshold', surcharges.overweightThreshold);
  } else if (carrierId === 'GOFO') {
    html += renderSurchargeField('AHS - Dimensions', 'oversize', surcharges.oversize, 'Exceeds 19x15x11in');
    html += renderSurchargeField('AHS - Weight', 'overweight', surcharges.overweight, '>10lbs');
    html += renderSurchargeField('AHS - Weight Threshold', 'overweightThreshold', surcharges.overweightThreshold);
  } else if (carrierId === 'SmartPost') {
    html += renderSurchargeField('AHS - Dimensions', 'oversize', surcharges.oversize);
  } else if (carrierId === 'UPS' || carrierId === 'FedEx') {
    html += renderSurchargeField('Residential', 'residential', surcharges.residential);
    html += renderDasSurchargeFields(surcharges);
  } else if (carrierId === 'FedExAHS') {
    html += '<div style="grid-column: 1 / -1; background: #fff7ed; padding: 10px; border-radius: 6px; margin-bottom: 10px;">';
    html += '<strong>Residential Surcharges:</strong>';
    html += '</div>';
    html += renderSurchargeField('Residential (under 70lbs)', 'residential.under70', surcharges.residential?.under70);
    html += renderSurchargeField('Residential (over 70lbs)', 'residential.over70', surcharges.residential?.over70);
    html += renderDasSurchargeFields(surcharges);
    html += renderAhsZoneBasedEditor(surcharges);
  } else if (carrierId === 'FedExOS') {
    html += renderSurchargeField('Residential', 'residential', surcharges.residential);
    html += renderDasSurchargeFields(surcharges);
    html += renderOversizeZoneBasedEditor(surcharges);
  }
  
  container.innerHTML = html;
}

function renderAhsZoneBasedEditor(surcharges) {
  const ahsZoneBased = surcharges.ahsZoneBased || {};
  return `
    <div style="grid-column: 1 / -1; background: #f0f9ff; padding: 15px; border-radius: 6px; margin-top: 10px;">
      <strong style="display: block; margin-bottom: 10px;">📊 AHS Zone-Based Surcharges:</strong>
      <p style="font-size: 12px; color: #666; margin-bottom: 10px;">Note: Oversize packages (perimeter ≥320cm, volume >17280 cu in, or weight >110lbs) use FedEx OS instead.</p>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="background: #e0f2fe;">
            <th style="padding: 8px; border: 1px solid #bae6fd;">Zone</th>
            <th style="padding: 8px; border: 1px solid #bae6fd;">AHS-Weight (>50lbs)</th>
            <th style="padding: 8px; border: 1px solid #bae6fd;">AHS-Dim</th>
          </tr>
        </thead>
        <tbody>
          ${[2,3,4,5,6,7,8].map(zone => `
            <tr>
              <td style="padding: 6px; border: 1px solid #bae6fd; text-align: center; font-weight: 600;">${zone}</td>
              <td style="padding: 4px; border: 1px solid #bae6fd;">
                <input type="number" step="0.01" value="${ahsZoneBased[zone]?.ahsWeight ?? ''}" 
                       data-surcharge="ahsZoneBased.${zone}.ahsWeight" onchange="updateQuoteSurcharge(this)"
                       style="width: 100%; padding: 4px; border: 1px solid #ddd; border-radius: 3px; text-align: right;">
              </td>
              <td style="padding: 4px; border: 1px solid #bae6fd;">
                <input type="number" step="0.01" value="${ahsZoneBased[zone]?.ahsDim ?? ''}" 
                       data-surcharge="ahsZoneBased.${zone}.ahsDim" onchange="updateQuoteSurcharge(this)"
                       style="width: 100%; padding: 4px; border: 1px solid #ddd; border-radius: 3px; text-align: right;">
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderOversizeZoneBasedEditor(surcharges) {
  const oversizeZoneBased = surcharges.oversizeZoneBased || {};
  return `
    <div style="grid-column: 1 / -1; background: #fef3c7; padding: 15px; border-radius: 6px; margin-top: 10px;">
      <strong style="display: block; margin-bottom: 10px;">📦 Oversize Zone-Based Surcharges:</strong>
      <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px;">
        ${[2,3,4,5,6,7,8].map(zone => `
          <div style="text-align: center;">
            <label style="display: block; font-weight: 600; font-size: 12px; margin-bottom: 4px;">Zone ${zone}</label>
            <input type="number" step="0.01" value="${oversizeZoneBased[zone] ?? ''}" 
                   data-surcharge="oversizeZoneBased.${zone}" onchange="updateQuoteSurcharge(this)"
                   style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; text-align: center;">
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderSurchargeField(label, key, value, hint) {
  return `
    <div style="background: #f8fafc; padding: 12px; border-radius: 6px;">
      <label style="display: block; font-weight: 600; margin-bottom: 5px;">${label}:</label>
      <input type="number" step="0.01" value="${value ?? ''}" 
             data-surcharge="${key}"
             onchange="updateQuoteSurcharge(this)"
             style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
      ${hint ? '<small style="color: #666; display: block; margin-top: 4px;">' + hint + '</small>' : ''}
    </div>
  `;
}

function renderDasSurchargeFields(surcharges) {
  return `
    <div style="grid-column: 1 / -1; background: #fefce8; padding: 10px; border-radius: 6px; margin-top: 10px;">
      <strong>DAS Surcharges:</strong>
    </div>
    <div style="background: #f8fafc; padding: 12px; border-radius: 6px;">
      <label style="display: block; font-weight: 600; margin-bottom: 5px;">DAS (Residential):</label>
      <input type="number" step="0.01" value="${surcharges.das?.residential ?? ''}" 
             data-surcharge="das.residential" onchange="updateQuoteSurcharge(this)"
             style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
    </div>
    <div style="background: #f8fafc; padding: 12px; border-radius: 6px;">
      <label style="display: block; font-weight: 600; margin-bottom: 5px;">DAS (Commercial):</label>
      <input type="number" step="0.01" value="${surcharges.das?.commercial ?? ''}" 
             data-surcharge="das.commercial" onchange="updateQuoteSurcharge(this)"
             style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
    </div>
    <div style="background: #f8fafc; padding: 12px; border-radius: 6px;">
      <label style="display: block; font-weight: 600; margin-bottom: 5px;">DAS Extended (Residential):</label>
      <input type="number" step="0.01" value="${surcharges.dasExtended?.residential ?? ''}" 
             data-surcharge="dasExtended.residential" onchange="updateQuoteSurcharge(this)"
             style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
    </div>
    <div style="background: #f8fafc; padding: 12px; border-radius: 6px;">
      <label style="display: block; font-weight: 600; margin-bottom: 5px;">DAS Extended (Commercial):</label>
      <input type="number" step="0.01" value="${surcharges.dasExtended?.commercial ?? ''}" 
             data-surcharge="dasExtended.commercial" onchange="updateQuoteSurcharge(this)"
             style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
    </div>
    <div style="background: #f8fafc; padding: 12px; border-radius: 6px;">
      <label style="display: block; font-weight: 600; margin-bottom: 5px;">DAS Remote:</label>
      <input type="number" step="0.01" value="${surcharges.dasRemote ?? ''}" 
             data-surcharge="dasRemote" onchange="updateQuoteSurcharge(this)"
             style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
    </div>
  `;
}

function updateQuoteSurcharge(input) {
  if (!currentQuoteCarrier || !quotePricingData?.carriers?.[currentQuoteCarrier]) return;
  
  const key = input.dataset.surcharge;
  const value = parseFloat(input.value) || 0;
  
  const carrier = quotePricingData.carriers[currentQuoteCarrier];
  if (!carrier.surcharges) carrier.surcharges = {};
  
  // Handle nested keys like "das.residential" or "ahsZoneBased.2.ahsWeight" or "oversizeZoneBased.2"
  const parts = key.split('.');
  if (parts.length === 1) {
    carrier.surcharges[key] = value;
  } else if (parts.length === 2) {
    const [parent, child] = parts;
    if (!carrier.surcharges[parent]) carrier.surcharges[parent] = {};
    carrier.surcharges[parent][child] = value;
  } else if (parts.length === 3) {
    const [grandparent, parent, child] = parts;
    if (!carrier.surcharges[grandparent]) carrier.surcharges[grandparent] = {};
    if (!carrier.surcharges[grandparent][parent]) carrier.surcharges[grandparent][parent] = {};
    carrier.surcharges[grandparent][parent][child] = value;
  }
}

async function handleSaveQuoteCarrier() {
  if (!currentQuoteCarrier || !quotePricingData?.carriers?.[currentQuoteCarrier]) {
    alert('No carrier selected');
    return;
  }
  
  const statusSpan = document.getElementById('quote-save-status');
  statusSpan.textContent = 'Saving...';
  statusSpan.style.color = '#666';
  
  try {
    const res = await fetch('/api/quote-pricing/carrier/' + currentQuoteCarrier, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(quotePricingData.carriers[currentQuoteCarrier])
    });
    const result = await res.json();
    
    if (result.success) {
      statusSpan.textContent = '✓ Saved successfully!';
      statusSpan.style.color = '#059669';
      setTimeout(() => { statusSpan.textContent = ''; }, 3000);
    } else {
      statusSpan.textContent = '✗ Error: ' + (result.error || 'Unknown');
      statusSpan.style.color = '#dc2626';
    }
  } catch (error) {
    statusSpan.textContent = '✗ Error: ' + error.message;
    statusSpan.style.color = '#dc2626';
  }
}

// Expose functions globally for inline handlers
window.updateQuoteRate = updateQuoteRate;
window.removeQuoteWeightRow = removeQuoteWeightRow;
window.updateQuoteSurcharge = updateQuoteSurcharge;

// ===============================
// Supplier Management Logic
// ===============================

let supplierData = null;
let currentSupplier = null;

async function getSupplierData() {
  try {
    const res = await fetch('/api/suppliers');
    return res.json();
  } catch (error) {
    console.error('Error loading supplier data:', error);
    return { suppliers: [] };
  }
}

async function saveSupplierData(data) {
  try {
    const res = await fetch('/api/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.json();
  } catch (error) {
    console.error('Error saving supplier data:', error);
    throw error;
  }
}

function initSupplierManagement() {
  const supplierSelect = document.getElementById('supplier-select');
  const addBtn = document.getElementById('add-supplier-btn');
  const deleteBtn = document.getElementById('delete-supplier-btn');
  const saveBtn = document.getElementById('save-supplier');

  if (!supplierSelect) return;

  // Load supplier data
  getSupplierData().then(data => {
    supplierData = data;
    refreshSupplierSelect();
  });

  // Carrier filter event listener
  const carrierFilter = document.getElementById('supplier-carrier-filter');
  if (carrierFilter) {
    carrierFilter.addEventListener('change', () => {
      refreshSupplierSelect();
      // Hide editor when filter changes
      document.getElementById('supplier-editor').style.display = 'none';
    });
  }

  // Event listeners
  supplierSelect.addEventListener('change', () => {
    const supplierId = supplierSelect.value;
    if (supplierId) {
      loadSupplier(supplierId);
    } else {
      document.getElementById('supplier-editor').style.display = 'none';
    }
  });

  if (addBtn) {
    addBtn.addEventListener('click', addNewSupplier);
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', deleteSupplier);
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', saveCurrentSupplier);
  }

  // Add surcharge buttons
  const addFixedBtn = document.getElementById('add-fixed-surcharge');
  if (addFixedBtn) {
    addFixedBtn.addEventListener('click', addFixedSurcharge);
  }

  const addZoneBtn = document.getElementById('add-zone-surcharge');
  if (addZoneBtn) {
    addZoneBtn.addEventListener('click', addZoneSurcharge);
  }

  // Fuel type radio buttons
  document.getElementById('fuel-discount-radio')?.addEventListener('change', toggleFuelInputs);
  document.getElementById('fuel-fixed-radio')?.addEventListener('change', toggleFuelInputs);
  
  // Carrier change handler for fuel surcharge logic
  document.getElementById('supplier-category')?.addEventListener('change', updateFuelSectionByCarrier);
}

// Update fuel surcharge section based on carrier type
function updateFuelSectionByCarrier() {
  const carrier = document.getElementById('supplier-category')?.value || '';
  const fuelSection = document.getElementById('supplier-fuel-section');
  const fuelNote = document.getElementById('supplier-fuel-note');
  const pickupFeeContainer = document.getElementById('supplier-pickup-fee-container');
  
  // Show pickup fee field only for UNIUNI
  if (pickupFeeContainer) {
    pickupFeeContainer.style.display = (carrier === 'UNIUNI') ? 'block' : 'none';
  }
  
  // Carriers that use FedEx fuel rate
  const fedexFuelCarriers = ['FedEx', 'FedExAHS', 'FedExOS', 'SmartPost'];
  // Carriers with their own fuel rate
  const upsFuelCarriers = ['UPS'];
  // Carriers with no fuel (0%)
  const noFuelCarriers = ['UNIUNI', 'GOFO', 'USPS'];
  
  if (noFuelCarriers.includes(carrier)) {
    // No fuel surcharge for these carriers
    fuelNote.innerHTML = '<strong style="color: #16a34a;">✓ No fuel surcharge for ' + carrier + '</strong> - This carrier does not charge fuel surcharge.';
    fuelNote.style.background = '#dcfce7';
    // Disable inputs
    document.getElementById('fuel-discount-radio').disabled = true;
    document.getElementById('fuel-fixed-radio').disabled = true;
    document.getElementById('supplier-fuel-discount').disabled = true;
    document.getElementById('supplier-fuel-fixed').disabled = true;
    // Set values to 0
    document.getElementById('supplier-fuel-discount').value = 0;
    document.getElementById('supplier-fuel-fixed').value = 0;
  } else {
    // Enable inputs
    document.getElementById('fuel-discount-radio').disabled = false;
    document.getElementById('fuel-fixed-radio').disabled = false;
    document.getElementById('supplier-fuel-discount').disabled = false;
    document.getElementById('supplier-fuel-fixed').disabled = false;
    
    if (fedexFuelCarriers.includes(carrier)) {
      fuelNote.innerHTML = '<strong>FedEx Fuel Group:</strong> This carrier (' + carrier + ') uses FedEx fuel surcharge rate. Enter the discount or fixed rate from your supplier contract.';
      fuelNote.style.background = '#fef3c7';
    } else if (upsFuelCarriers.includes(carrier)) {
      fuelNote.innerHTML = '<strong>UPS Fuel Group:</strong> UPS has its own fuel surcharge rate. Enter the discount or fixed rate from your supplier contract.';
      fuelNote.style.background = '#e0f2fe';
    } else {
      fuelNote.innerHTML = '<strong>Note:</strong> Fuel surcharge is automatically determined by carrier type.';
      fuelNote.style.background = '#f0f9ff';
    }
  }
}

function refreshSupplierSelect() {
  const select = document.getElementById('supplier-select');
  const carrierFilter = document.getElementById('supplier-carrier-filter');
  if (!select || !supplierData) return;

  const selectedCarrier = carrierFilter?.value || '';
  
  // Filter suppliers by carrier if filter is set
  const filteredSuppliers = selectedCarrier 
    ? supplierData.suppliers.filter(s => (s.category || 'FedEx') === selectedCarrier)
    : supplierData.suppliers;

  select.innerHTML = '<option value="">-- Select a supplier --</option>' +
    filteredSuppliers.map(s => 
      `<option value="${s.id}">${escapeHtml(s.name)}</option>`
    ).join('');
}

function addNewSupplier() {
  const name = prompt('Enter supplier name:');
  if (!name || !name.trim()) return;

  // Use currently selected carrier filter as default category
  const carrierFilter = document.getElementById('supplier-carrier-filter');
  const defaultCategory = carrierFilter?.value || 'FedEx';

  const newSupplier = {
    id: 'supplier_' + Date.now(),
    name: name.trim(),
    category: defaultCategory,
    notes: '',
    markup: 0,
    pickup_fee_per_lb: 0,
    fuel_type: 'discount',
    fuel_discount: 0,
    fuel_fixed: 0,
    fixed_surcharges: [],
    zone_based_surcharges: []
  };

  supplierData.suppliers.push(newSupplier);
  refreshSupplierSelect();
  document.getElementById('supplier-select').value = newSupplier.id;
  loadSupplier(newSupplier.id);
}

function deleteSupplier() {
  const select = document.getElementById('supplier-select');
  const supplierId = select.value;
  if (!supplierId) {
    alert('Please select a supplier to delete');
    return;
  }

  const supplier = supplierData.suppliers.find(s => s.id === supplierId);
  if (!confirm(`Are you sure you want to delete supplier "${supplier.name}"?`)) {
    return;
  }

  supplierData.suppliers = supplierData.suppliers.filter(s => s.id !== supplierId);
  saveSupplierData(supplierData).then(() => {
    refreshSupplierSelect();
    document.getElementById('supplier-editor').style.display = 'none';
    alert('Supplier deleted successfully');
  }).catch(err => {
    alert('Error deleting supplier: ' + err.message);
  });
}

function loadSupplier(supplierId) {
  currentSupplier = supplierData.suppliers.find(s => s.id === supplierId);
  if (!currentSupplier) return;

  // Show editor
  document.getElementById('supplier-editor').style.display = 'block';

  // Load basic info
  document.getElementById('supplier-name').value = currentSupplier.name || '';
  document.getElementById('supplier-notes').value = currentSupplier.notes || '';
  document.getElementById('supplier-markup').value = currentSupplier.markup || 0;
  document.getElementById('supplier-category').value = currentSupplier.category || 'FedEx';
  document.getElementById('supplier-pickup-fee-per-lb').value = currentSupplier.pickup_fee_per_lb || 0;

  // Load fuel settings
  const fuelType = currentSupplier.fuel_type || 'discount';
  document.getElementById('fuel-discount-radio').checked = fuelType === 'discount';
  document.getElementById('fuel-fixed-radio').checked = fuelType === 'fixed';
  document.getElementById('supplier-fuel-discount').value = currentSupplier.fuel_discount || 0;
  document.getElementById('supplier-fuel-fixed').value = currentSupplier.fuel_fixed || 0;
  document.getElementById('no-fuel-home-delivery').checked = currentSupplier.no_fuel_home_delivery || false;
  toggleFuelInputs();
  updateFuelSectionByCarrier(); // Update fuel section based on carrier type

  // Setup paste areas
  setupPasteArea('hd', 'lb');
  setupPasteArea('ground', 'lb');
  setupPasteAreaSimple('oz');
  
  // Setup enable checkboxes
  setupEnableGroundCheckbox();
  setupEnableOunceCheckbox();
  
  // Setup import (paste from Excel) buttons
  setupImportButtons();
  
  // Render base rates (applies to both HD and Ground by default)
  if (currentSupplier.hd_base_rates_lb && currentSupplier.hd_base_rates_lb.length > 0) {
    renderBaseRatesTable('hd', 'lb');
    document.getElementById('supplier-hd-base-lb-paste-area').style.display = 'none';
    document.getElementById('supplier-hd-base-lb-container').style.display = 'block';
  } else {
    document.getElementById('supplier-hd-base-lb-paste-area').style.display = 'block';
    document.getElementById('supplier-hd-base-lb-container').style.display = 'none';
  }
  
  // Check if ground has different rates
  const hasDifferentGround = currentSupplier.ground_base_rates_lb && currentSupplier.ground_base_rates_lb.length > 0;
  document.getElementById('enable-different-ground-lb').checked = hasDifferentGround;
  
  if (hasDifferentGround) {
    document.getElementById('supplier-ground-base-lb-section').style.display = 'block';
    renderBaseRatesTable('ground', 'lb');
    document.getElementById('supplier-ground-base-lb-paste-area').style.display = 'none';
    document.getElementById('supplier-ground-base-lb-container').style.display = 'block';
  } else {
    document.getElementById('supplier-ground-base-lb-section').style.display = 'none';
  }
  
  // Check if has ounce rates
  const hasOunceRates = currentSupplier.base_rates_oz && currentSupplier.base_rates_oz.length > 0;
  document.getElementById('enable-ounce-rates').checked = hasOunceRates;
  
  if (hasOunceRates) {
    document.getElementById('supplier-base-oz-section').style.display = 'block';
    renderBaseRatesTableSimple('oz');
    document.getElementById('supplier-base-oz-paste-area').style.display = 'none';
    document.getElementById('supplier-base-oz-container').style.display = 'block';
  } else {
    document.getElementById('supplier-base-oz-section').style.display = 'none';
  }

  // Render surcharges
  renderSupplierFixedSurcharges();
  renderSupplierZoneSurcharges();
}

function setupPasteArea(service, unit) {
  const pasteArea = document.getElementById(`supplier-${service}-base-${unit}-paste-area`);
  if (!pasteArea) return;
  
  // Remove old listeners
  const newPasteArea = pasteArea.cloneNode(true);
  pasteArea.parentNode.replaceChild(newPasteArea, pasteArea);
  
  // Add paste listener
  newPasteArea.addEventListener('paste', (e) => handleBaseRateTablePaste(e, service, unit));
  newPasteArea.addEventListener('click', () => {
    newPasteArea.focus();
  });
  newPasteArea.setAttribute('tabindex', '0');
}

function setupPasteAreaSimple(unit) {
  const pasteArea = document.getElementById(`supplier-base-${unit}-paste-area`);
  if (!pasteArea) return;
  
  // Remove old listeners
  const newPasteArea = pasteArea.cloneNode(true);
  pasteArea.parentNode.replaceChild(newPasteArea, pasteArea);
  
  // Add paste listener
  newPasteArea.addEventListener('paste', (e) => handleBaseRateTablePasteSimple(e, unit));
  newPasteArea.addEventListener('click', () => {
    newPasteArea.focus();
  });
  newPasteArea.setAttribute('tabindex', '0');
}

function setupEnableGroundCheckbox() {
  const checkbox = document.getElementById('enable-different-ground-lb');
  if (!checkbox) return;
  
  // Remove old listeners
  const newCheckbox = checkbox.cloneNode(true);
  checkbox.parentNode.replaceChild(newCheckbox, checkbox);
  
  newCheckbox.addEventListener('change', () => {
    if (!currentSupplier) return;
    
    const section = document.getElementById('supplier-ground-base-lb-section');
    
    if (newCheckbox.checked) {
      // Show Ground section
      section.style.display = 'block';
      
      // If ground rates exist, show table, otherwise show paste area
      if (currentSupplier.ground_base_rates_lb && currentSupplier.ground_base_rates_lb.length > 0) {
        renderBaseRatesTable('ground', 'lb');
        document.getElementById('supplier-ground-base-lb-paste-area').style.display = 'none';
        document.getElementById('supplier-ground-base-lb-container').style.display = 'block';
      } else {
        document.getElementById('supplier-ground-base-lb-paste-area').style.display = 'block';
        document.getElementById('supplier-ground-base-lb-container').style.display = 'none';
      }
    } else {
      // Hide Ground section and clear ground rates
      section.style.display = 'none';
      delete currentSupplier.ground_base_rates_lb;
      delete currentSupplier.ground_zones_lb;
      delete currentSupplier.ground_weight_start_lb;
      delete currentSupplier.ground_weight_end_lb;
    }
  });
}

function setupEnableOunceCheckbox() {
  const checkbox = document.getElementById('enable-ounce-rates');
  if (!checkbox) return;
  
  // Remove old listeners
  const newCheckbox = checkbox.cloneNode(true);
  checkbox.parentNode.replaceChild(newCheckbox, checkbox);
  
  newCheckbox.addEventListener('change', () => {
    if (!currentSupplier) return;
    
    const section = document.getElementById('supplier-base-oz-section');
    
    if (newCheckbox.checked) {
      // Show ounce section
      section.style.display = 'block';
      
      // If ounce rates exist, show table, otherwise show paste area
      if (currentSupplier.base_rates_oz && currentSupplier.base_rates_oz.length > 0) {
        renderBaseRatesTableSimple('oz');
        document.getElementById('supplier-base-oz-paste-area').style.display = 'none';
        document.getElementById('supplier-base-oz-container').style.display = 'block';
      } else {
        document.getElementById('supplier-base-oz-paste-area').style.display = 'block';
        document.getElementById('supplier-base-oz-container').style.display = 'none';
      }
    } else {
      // Hide ounce section and clear ounce rates
      section.style.display = 'none';
      delete currentSupplier.base_rates_oz;
      delete currentSupplier.zones_oz;
      delete currentSupplier.weight_start_oz;
      delete currentSupplier.weight_end_oz;
    }
  });
}

function setupImportButtons() {
  // Import HD base rates (lb)
  const importHdBtn = document.getElementById('supplier-import-hd-lb-btn');
  if (importHdBtn) {
    const newBtn = importHdBtn.cloneNode(true);
    importHdBtn.parentNode.replaceChild(newBtn, importHdBtn);
    
    newBtn.addEventListener('click', () => {
      if (!currentSupplier) return;
      const textarea = prompt(
        '从 Excel 粘贴磅费率\uff08Tab分隔\uff09\n' +
        '格式: 每行一个重量等级，每列一个区域\n' +
        '示例:\n4.25\t4.50\t4.75\t5.25\t5.75\t6.25\t7.00\n4.50\t4.75\t5.00\t5.50\t6.00\t6.50\t7.25'
      );
      if (!textarea) return;
      importSupplierRatesFromPrompt(textarea, 'hd', 'lb');
    });
  }
  
  // Import Ground base rates (lb)
  const importGroundBtn = document.getElementById('supplier-import-ground-lb-btn');
  if (importGroundBtn) {
    const newBtn = importGroundBtn.cloneNode(true);
    importGroundBtn.parentNode.replaceChild(newBtn, importGroundBtn);
    
    newBtn.addEventListener('click', () => {
      if (!currentSupplier) return;
      const textarea = prompt(
        '从 Excel 粘贴 Ground 磅费率\uff08Tab分隔\uff09\n' +
        '格式: 每行一个重量等级，每列一个区域\n' +
        '示例:\n4.25\t4.50\t4.75\t5.25\t5.75\t6.25\t7.00\n4.50\t4.75\t5.00\t5.50\t6.00\t6.50\t7.25'
      );
      if (!textarea) return;
      importSupplierRatesFromPrompt(textarea, 'ground', 'lb');
    });
  }
  
  // Import ounce rates
  const importOzBtn = document.getElementById('supplier-import-oz-btn');
  if (importOzBtn) {
    const newBtn = importOzBtn.cloneNode(true);
    importOzBtn.parentNode.replaceChild(newBtn, importOzBtn);
    
    newBtn.addEventListener('click', () => {
      if (!currentSupplier) return;
      const textarea = prompt(
        '从 Excel 粘贴盎司费率\uff08Tab分隔\uff09\n' +
        '格式: 每行一个盎司等级，每列一个区域\n' +
        '示例:\n2.00\t2.10\t2.20\t2.30\t2.40\n2.05\t2.15\t2.25\t2.35\t2.45'
      );
      if (!textarea) return;
      importSupplierRatesFromPrompt(textarea, null, 'oz');
    });
  }
}

function importSupplierRatesFromPrompt(pastedText, service, unit) {
  try {
    const lines = pastedText.trim().split('\n');
    
    // First pass: collect all rows with numeric values
    const rawRows = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      const values = trimmed.split('\t').length > 1 
        ? trimmed.split('\t').map(v => v.trim())
        : trimmed.split(/\s{2,}/).map(v => v.trim());
      
      const numericValues = [];
      for (const val of values) {
        if (!val) continue;
        const num = parseFloat(val);
        if (!isNaN(num)) numericValues.push(num);
      }
      
      if (numericValues.length > 1) {
        rawRows.push(numericValues);
      }
    }
    
    if (rawRows.length === 0) {
      alert('No valid rate data found');
      return;
    }
    
    // Second pass: check if first column consistently matches row numbers
    let hasWeightColumn = rawRows.length >= 3; // Need enough rows to detect pattern
    for (let i = 0; i < rawRows.length && hasWeightColumn; i++) {
      const firstVal = rawRows[i][0];
      // Check if first value matches expected weight (row index + 1)
      if (Math.abs(firstVal - (i + 1)) >= 0.01) {
        hasWeightColumn = false;
      }
    }
    
    // Apply weight column stripping consistently to all rows
    const newRates = hasWeightColumn 
      ? rawRows.map(row => row.slice(1))
      : rawRows;
    
    const numZones = newRates[0].length;
    let zones;
    if (numZones === 7) zones = [2, 3, 4, 5, 6, 7, 8];
    else if (numZones === 8) zones = [1, 2, 3, 4, 5, 6, 7, 8];
    else if (numZones === 9) zones = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    else zones = Array(numZones).fill(0).map((_, i) => i + 1);
    
    if (service) {
      // HD or Ground (lb)
      currentSupplier[`${service}_base_rates_${unit}`] = newRates;
      currentSupplier[`${service}_zones_${unit}`] = zones;
      currentSupplier[`${service}_weight_start_${unit}`] = 1;
      currentSupplier[`${service}_weight_end_${unit}`] = newRates.length;
      
      document.getElementById(`supplier-${service}-base-${unit}-paste-area`).style.display = 'none';
      document.getElementById(`supplier-${service}-base-${unit}-container`).style.display = 'block';
      renderBaseRatesTable(service, unit);
      
      const serviceLabel = service === 'hd' ? 'Home Delivery' : 'Ground';
      alert(`\u2713 Successfully imported ${serviceLabel} ${newRates.length} rows \u00d7 ${numZones} zones\nDetected: Zones ${zones[0]}-${zones[zones.length-1]}, Weights 1-${newRates.length} lbs`);
    } else {
      // Ounce rates
      currentSupplier[`base_rates_${unit}`] = newRates;
      currentSupplier[`zones_${unit}`] = zones;
      currentSupplier[`weight_start_${unit}`] = 1;
      currentSupplier[`weight_end_${unit}`] = newRates.length;
      
      document.getElementById(`supplier-base-${unit}-paste-area`).style.display = 'none';
      document.getElementById(`supplier-base-${unit}-container`).style.display = 'block';
      renderBaseRatesTableSimple(unit);
      
      alert(`\u2713 Successfully imported ${newRates.length} rows \u00d7 ${numZones} zones\nDetected: Zones ${zones[0]}-${zones[zones.length-1]}, Weights 1-${newRates.length} oz`);
    }
  } catch (error) {
    alert('Error parsing pasted data: ' + error.message);
  }
}

function renderBaseRatesTableSimple(unit) {
  const thead = document.getElementById(`supplier-base-${unit}-thead`);
  const tbody = document.getElementById(`supplier-base-${unit}-tbody`);
  if (!thead || !tbody || !currentSupplier) return;
  
  // Get metadata based on unit only (no service prefix)
  const ratesKey = `base_rates_${unit}`;
  const zonesKey = `zones_${unit}`;
  const weightStartKey = `weight_start_${unit}`;
  const weightEndKey = `weight_end_${unit}`;
  
  const zones = currentSupplier[zonesKey] || [2, 3, 4, 5, 6, 7, 8];
  const weightStart = currentSupplier[weightStartKey] || 1;
  const weightEnd = currentSupplier[weightEndKey] || (unit === 'oz' ? 16 : 150);
  const rates = currentSupplier[ratesKey] || [];
  
  const weightLabel = unit === 'oz' ? 'oz' : 'lb';
  
  // Render header
  thead.innerHTML = `
    <tr>
      <th style="padding: 8px; border: 1px solid #555; text-align: center; min-width: 50px;">Weight</th>
      ${zones.map(z => `<th style="padding: 8px; border: 1px solid #555; text-align: center; min-width: 80px;">Zone ${z}</th>`).join('')}
    </tr>
  `;
  
  // Render body
  const rowCount = weightEnd - weightStart + 1;
  tbody.innerHTML = Array(rowCount).fill(null).map((_, idx) => {
    const weight = weightStart + idx;
    const row = rates[idx] || [];
    return `
      <tr>
        <td style="padding: 6px; border: 1px solid #ddd; text-align: center; background: #f5f5f5; font-weight: bold;">${weight} ${weightLabel}</td>
        ${zones.map((z, colIdx) => `
          <td style="padding: 4px; border: 1px solid #ddd;">
            <input type="number" step="0.01" value="${row[colIdx] || 0}" 
              data-row="${idx}" data-col="${colIdx}" data-unit="${unit}"
              onchange="updateBaseRateCellSimple('${unit}', ${idx}, ${colIdx}, this.value)"
              style="width: 100%; padding: 4px; border: none; text-align: right; font-family: monospace;">
          </td>
        `).join('')}
      </tr>
    `;
  }).join('');
}

function renderBaseRatesTable(service, unit) {
  const thead = document.getElementById(`supplier-${service}-base-${unit}-thead`);
  const tbody = document.getElementById(`supplier-${service}-base-${unit}-tbody`);
  if (!thead || !tbody || !currentSupplier) return;
  
  // Get metadata based on service and unit
  const ratesKey = `${service}_base_rates_${unit}`;
  const zonesKey = `${service}_zones_${unit}`;
  const weightStartKey = `${service}_weight_start_${unit}`;
  const weightEndKey = `${service}_weight_end_${unit}`;
  
  const zones = currentSupplier[zonesKey] || [2, 3, 4, 5, 6, 7, 8];
  const weightStart = currentSupplier[weightStartKey] || 1;
  const weightEnd = currentSupplier[weightEndKey] || (unit === 'oz' ? 16 : 150);
  const rates = currentSupplier[ratesKey] || [];
  
  const weightLabel = unit === 'oz' ? 'oz' : 'lb';
  
  // Render header
  thead.innerHTML = `
    <tr>
      <th style="padding: 8px; border: 1px solid #555; text-align: center; min-width: 50px;">Weight</th>
      ${zones.map(z => `<th style="padding: 8px; border: 1px solid #555; text-align: center; min-width: 80px;">Zone ${z}</th>`).join('')}
    </tr>
  `;
  
  // Render body
  const rowCount = weightEnd - weightStart + 1;
  tbody.innerHTML = Array(rowCount).fill(null).map((_, idx) => {
    const weight = weightStart + idx;
    const row = rates[idx] || [];
    return `
      <tr>
        <td style="padding: 6px; border: 1px solid #ddd; text-align: center; background: #f5f5f5; font-weight: bold;">${weight} ${weightLabel}</td>
        ${zones.map((z, colIdx) => `
          <td style="padding: 4px; border: 1px solid #ddd;">
            <input type="number" step="0.01" value="${row[colIdx] || 0}" 
              data-row="${idx}" data-col="${colIdx}" data-service="${service}" data-unit="${unit}"
              onchange="updateBaseRateCell('${service}', '${unit}', ${idx}, ${colIdx}, this.value)"
              style="width: 100%; padding: 4px; border: none; text-align: right; font-family: monospace;">
          </td>
        `).join('')}
      </tr>
    `;
  }).join('');
}


function updateBaseRateCellSimple(unit, row, col, value) {
  if (!currentSupplier) return;
  const ratesKey = `base_rates_${unit}`;
  if (!currentSupplier[ratesKey]) {
    currentSupplier[ratesKey] = [];
  }
  if (!currentSupplier[ratesKey][row]) {
    currentSupplier[ratesKey][row] = [];
  }
  currentSupplier[ratesKey][row][col] = parseFloat(value) || 0;
}

function updateBaseRateCell(service, unit, row, col, value) {
  if (!currentSupplier) return;
  const ratesKey = `${service}_base_rates_${unit}`;
  if (!currentSupplier[ratesKey]) {
    currentSupplier[ratesKey] = [];
  }
  if (!currentSupplier[ratesKey][row]) {
    currentSupplier[ratesKey][row] = [];
  }
  currentSupplier[ratesKey][row][col] = parseFloat(value) || 0;
}

function handleBaseRateTablePasteSimple(e, unit) {
  e.preventDefault();
  
  if (!currentSupplier) return;
  
  const clipboardData = e.clipboardData || window.clipboardData;
  const pastedText = clipboardData.getData('text');
  
  if (!pastedText) return;
  
  try {
    const lines = pastedText.trim().split('\n');
    
    // First pass: collect all rows with numeric values
    const rawRows = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      const values = trimmed.split('\t').length > 1 
        ? trimmed.split('\t').map(v => v.trim())
        : trimmed.split(/\s{2,}/).map(v => v.trim());
      
      const numericValues = [];
      for (const val of values) {
        if (!val) continue;
        const num = parseFloat(val);
        if (!isNaN(num)) numericValues.push(num);
      }
      
      if (numericValues.length > 1) {
        rawRows.push(numericValues);
      }
    }
    
    if (rawRows.length === 0) {
      alert('No valid rate data found in clipboard');
      return;
    }
    
    // Second pass: check if first column consistently matches row numbers
    let hasWeightColumn = rawRows.length >= 3;
    for (let i = 0; i < rawRows.length && hasWeightColumn; i++) {
      if (Math.abs(rawRows[i][0] - (i + 1)) >= 0.01) {
        hasWeightColumn = false;
      }
    }
    
    // Apply weight column stripping consistently
    const newRates = hasWeightColumn 
      ? rawRows.map(row => row.slice(1))
      : rawRows;
    
    const numZones = newRates[0].length;
    let zones;
    
    if (numZones === 7) {
      zones = [2, 3, 4, 5, 6, 7, 8];
    } else if (numZones === 8) {
      zones = [1, 2, 3, 4, 5, 6, 7, 8];
    } else if (numZones === 9) {
      zones = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    } else {
      zones = Array(numZones).fill(0).map((_, i) => i + 1);
    }
    
    // Store metadata without service prefix (ounces only)
    currentSupplier[`base_rates_${unit}`] = newRates;
    currentSupplier[`zones_${unit}`] = zones;
    currentSupplier[`weight_start_${unit}`] = 1;
    currentSupplier[`weight_end_${unit}`] = newRates.length;
    
    // Hide paste area and show table
    document.getElementById(`supplier-base-${unit}-paste-area`).style.display = 'none';
    document.getElementById(`supplier-base-${unit}-container`).style.display = 'block';
    
    // Render the table
    renderBaseRatesTableSimple(unit);
    
    const unitLabel = unit === 'oz' ? 'oz' : 'lbs';
    alert(`✓ Successfully pasted ${newRates.length} rows × ${numZones} zones\nDetected: Zones ${zones[0]}-${zones[zones.length-1]}, Weights 1-${newRates.length} ${unitLabel}`);
  } catch (error) {
    alert('Error parsing pasted data: ' + error.message);
  }
}

function handleBaseRateTablePaste(e, service, unit) {
  e.preventDefault();
  
  if (!currentSupplier) return;
  
  const clipboardData = e.clipboardData || window.clipboardData;
  const pastedText = clipboardData.getData('text');
  
  if (!pastedText) return;
  
  try {
    const lines = pastedText.trim().split('\n');
    
    // First pass: collect all rows with numeric values
    const rawRows = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      const values = trimmed.split('\t').length > 1 
        ? trimmed.split('\t').map(v => v.trim())
        : trimmed.split(/\s{2,}/).map(v => v.trim());
      
      const numericValues = [];
      for (const val of values) {
        if (!val) continue;
        const num = parseFloat(val);
        if (!isNaN(num)) numericValues.push(num);
      }
      
      if (numericValues.length > 1) {
        rawRows.push(numericValues);
      }
    }
    
    if (rawRows.length === 0) {
      alert('No valid rate data found in clipboard');
      return;
    }
    
    // Second pass: check if first column consistently matches row numbers
    let hasWeightColumn = rawRows.length >= 3;
    for (let i = 0; i < rawRows.length && hasWeightColumn; i++) {
      if (Math.abs(rawRows[i][0] - (i + 1)) >= 0.01) {
        hasWeightColumn = false;
      }
    }
    
    // Apply weight column stripping consistently
    const newRates = hasWeightColumn 
      ? rawRows.map(row => row.slice(1))
      : rawRows;
    
    // Auto-detect zone range (common patterns: 1-8, 2-8, 2-9, 1-9, etc.)
    const numZones = newRates[0].length;
    let zones;
    if (numZones === 7) {
      zones = [2, 3, 4, 5, 6, 7, 8]; // Standard FedEx (zones 2-8)
    } else if (numZones === 8) {
      zones = [1, 2, 3, 4, 5, 6, 7, 8]; // Zones 1-8 (includes zone 1)
    } else if (numZones === 9) {
      zones = [1, 2, 3, 4, 5, 6, 7, 8, 9]; // Full range zones 1-9
    } else {
      zones = Array(numZones).fill(0).map((_, i) => i + 1); // Generic: start from zone 1
    }
    
    // Store metadata with service and unit keys
    currentSupplier[`${service}_base_rates_${unit}`] = newRates;
    currentSupplier[`${service}_zones_${unit}`] = zones;
    currentSupplier[`${service}_weight_start_${unit}`] = 1;
    currentSupplier[`${service}_weight_end_${unit}`] = newRates.length;
    
    // Hide paste area and show table
    document.getElementById(`supplier-${service}-base-${unit}-paste-area`).style.display = 'none';
    document.getElementById(`supplier-${service}-base-${unit}-container`).style.display = 'block';
    
    // Render the table
    renderBaseRatesTable(service, unit);
    
    const unitLabel = unit === 'oz' ? 'oz' : 'lbs';
    const serviceLabel = service === 'hd' ? 'Home Delivery' : 'Ground';
    alert(`✓ Successfully pasted ${serviceLabel} ${newRates.length} rows × ${numZones} zones\nDetected: Zones ${zones[0]}-${zones[zones.length-1]}, Weights 1-${newRates.length} ${unitLabel}`);
  } catch (error) {
    alert('Error parsing pasted data: ' + error.message);
  }
}

function loadBaseRatesText() {
  // This function is no longer needed but kept for compatibility
  if (currentSupplier && currentSupplier.hd_base_rates_lb) {
    renderBaseRatesTable('hd', 'lb');
  }
  if (currentSupplier && currentSupplier.base_rates_oz) {
    renderBaseRatesTableSimple('oz');
  }
  if (currentSupplier && currentSupplier.ground_base_rates_lb) {
    renderBaseRatesTable('ground', 'lb');
  }
}

function renderSupplierFixedSurcharges() {
  const tbody = document.getElementById('supplier-fixed-list');
  if (!tbody || !currentSupplier) return;

  const surcharges = currentSupplier.fixed_surcharges || [];
  const options = ['Residential', 'DAS Comm', 'DAS Extended Comm', 'DAS Resi', 'DAS Extended Resi', 'DAS Remote Residential', 'DAS Remote Comm', 'Direct Signature', 'Adult Signature', 'Demand Surcharge', "Demand-Add'l Handling", 'Demand-Oversize'];
  
  tbody.innerHTML = surcharges.map((sc, idx) => `
    <tr>
      <td>
        <select onchange="currentSupplier.fixed_surcharges[${idx}].description = this.value"
          style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;">
          ${options.map(opt => `<option value="${opt}" ${sc.description === opt ? 'selected' : ''}>${opt}</option>`).join('')}
        </select>
      </td>
      <td><input type="number" step="0.01" value="${sc.amount || 0}" 
          onchange="currentSupplier.fixed_surcharges[${idx}].amount = parseFloat(this.value) || 0"
          style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;"></td>
      <td><input type="text" value="${escapeHtml(sc.remark || '')}" 
          onchange="currentSupplier.fixed_surcharges[${idx}].remark = this.value"
          style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;"></td>
      <td><button onclick="deleteFixedSurcharge(${idx})" class="btn-danger" style="padding: 4px 8px;">🗑️</button></td>
    </tr>
  `).join('');
}

function addFixedSurcharge() {
  if (!currentSupplier.fixed_surcharges) {
    currentSupplier.fixed_surcharges = [];
  }
  currentSupplier.fixed_surcharges.push({
    description: 'Residential',
    amount: 0,
    remark: ''
  });
  renderSupplierFixedSurcharges();
}

function deleteFixedSurcharge(idx) {
  if (currentSupplier && currentSupplier.fixed_surcharges) {
    currentSupplier.fixed_surcharges.splice(idx, 1);
    renderSupplierFixedSurcharges();
  }
}

function renderSupplierZoneSurcharges() {
  const tbody = document.getElementById('supplier-zone-list');
  if (!tbody || !currentSupplier) return;

  const surcharges = currentSupplier.zone_based_surcharges || [];
  const options = ['AHS - Weight', 'AHS - Dimensions', 'Additional Handling', 'Oversize Charge'];
  
  tbody.innerHTML = surcharges.map((sc, idx) => `
    <tr>
      <td>
        <select onchange="currentSupplier.zone_based_surcharges[${idx}].description = this.value"
          style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;">
          ${options.map(opt => `<option value="${opt}" ${sc.description === opt ? 'selected' : ''}>${opt}</option>`).join('')}
        </select>
      </td>
      <td><input type="number" step="0.01" value="${(sc.zone_rates && sc.zone_rates['2']) || 0}" 
          onchange="updateSupplierZoneRate(${idx}, '2', this.value)"
          style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;"></td>
      <td><input type="number" step="0.01" value="${(sc.zone_rates && sc.zone_rates['3']) || 0}" 
          onchange="updateSupplierZoneRate(${idx}, '3', this.value)"
          style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;"></td>
      <td><input type="number" step="0.01" value="${(sc.zone_rates && sc.zone_rates['4']) || 0}" 
          onchange="updateSupplierZoneRate(${idx}, '4', this.value)"
          style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;"></td>
      <td><input type="number" step="0.01" value="${(sc.zone_rates && sc.zone_rates['5']) || 0}" 
          onchange="updateSupplierZoneRate(${idx}, '5', this.value)"
          style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;"></td>
      <td><input type="number" step="0.01" value="${(sc.zone_rates && sc.zone_rates['6']) || 0}" 
          onchange="updateSupplierZoneRate(${idx}, '6', this.value)"
          style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;"></td>
      <td><input type="number" step="0.01" value="${(sc.zone_rates && sc.zone_rates['7']) || 0}" 
          onchange="updateSupplierZoneRate(${idx}, '7', this.value)"
          style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;"></td>
      <td><input type="number" step="0.01" value="${(sc.zone_rates && sc.zone_rates['8']) || 0}" 
          onchange="updateSupplierZoneRate(${idx}, '8', this.value)"
          style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;"></td>
      <td><input type="text" value="${escapeHtml(sc.remark || '')}" 
          onchange="currentSupplier.zone_based_surcharges[${idx}].remark = this.value"
          style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;"></td>
      <td><button onclick="deleteZoneSurcharge(${idx})" class="btn-danger" style="padding: 4px 8px;">🗑️</button></td>
    </tr>
  `).join('');
}

function addZoneSurcharge() {
  if (!currentSupplier.zone_based_surcharges) {
    currentSupplier.zone_based_surcharges = [];
  }
  currentSupplier.zone_based_surcharges.push({
    description: 'AHS - Weight',
    zone_rates: { '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0, '8': 0 },
    remark: ''
  });
  renderSupplierZoneSurcharges();
}

function deleteZoneSurcharge(idx) {
  if (currentSupplier && currentSupplier.zone_based_surcharges) {
    currentSupplier.zone_based_surcharges.splice(idx, 1);
    renderSupplierZoneSurcharges();
  }
}

function toggleFuelInputs() {
  const isDiscount = document.getElementById('fuel-discount-radio')?.checked;
  document.getElementById('fuel-discount-input').style.display = isDiscount ? 'block' : 'none';
  document.getElementById('fuel-fixed-input').style.display = isDiscount ? 'none' : 'block';
}

function parseBaseRates() {
  // This function is no longer needed but kept for compatibility
  alert('Base rates are now edited directly in the table. Paste from Excel to populate.');
}

function updateSupplierZoneRate(idx, zone, value) {
  if (!currentSupplier || !currentSupplier.zone_based_surcharges[idx]) return;
  
  if (!currentSupplier.zone_based_surcharges[idx].zone_rates) {
    currentSupplier.zone_based_surcharges[idx].zone_rates = {};
  }
  
  currentSupplier.zone_based_surcharges[idx].zone_rates[zone] = parseFloat(value) || 0;
}

async function saveCurrentSupplier() {
  if (!currentSupplier) return;

  // Update basic info from form
  currentSupplier.name = document.getElementById('supplier-name').value;
  currentSupplier.category = document.getElementById('supplier-category').value;
  currentSupplier.notes = document.getElementById('supplier-notes').value;
  currentSupplier.markup = parseFloat(document.getElementById('supplier-markup').value) || 0;
  currentSupplier.pickup_fee_per_lb = parseFloat(document.getElementById('supplier-pickup-fee-per-lb').value) || 0;

  // Update fuel settings
  currentSupplier.fuel_type = document.getElementById('fuel-discount-radio').checked ? 'discount' : 'fixed';
  currentSupplier.fuel_discount = parseFloat(document.getElementById('supplier-fuel-discount').value) || 0;
  currentSupplier.fuel_fixed = parseFloat(document.getElementById('supplier-fuel-fixed').value) || 0;
  currentSupplier.no_fuel_home_delivery = document.getElementById('no-fuel-home-delivery').checked || false;

  // Update "Same as HD" flags (already updated via checkbox handlers)
  // No need to read them again here

  try {
    await saveSupplierData(supplierData);
    refreshSupplierSelect();
    
    // Also refresh the Rate Comparison dropdown
    if (document.getElementById('suppliers-select')) {
      loadSuppliersIntoRateComparison();
    }
    
    alert('Supplier rates saved successfully!');
  } catch (error) {
    alert('Error saving supplier: ' + error.message);
  }
}

function exportRateComparison() {
  alert('Export functionality will be implemented next. This will export the comparison table to Excel.');
}

// ===============================
// Settings Sub-Tab Navigation
// ===============================

function initSettingsSubTabs() {
  const subtabs = document.querySelectorAll('#settings-subtabs .settings-subtab');
  
  subtabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-settings-tab');
      
      // Deactivate all sub-tabs
      subtabs.forEach(t => t.classList.remove('active'));
      
      // Hide all settings sub-tab content
      document.querySelectorAll('#settings-tab .settings-subtab-content').forEach(content => {
        content.style.display = 'none';
      });
      
      // Activate clicked tab
      tab.classList.add('active');
      
      // Show target content
      const target = document.getElementById(targetId);
      if (target) {
        target.style.display = 'block';
        // Auto-load scheduler status when its tab is shown
        if (targetId === 'settings-scheduler') {
          loadSchedulerStatus();
        }
      }
    });
  });
}


// ─── Scheduler UI ────────────────────────────────────────────────────────

function loadSchedulerStatus() {
  fetch('/api/scheduler/status')
    .then(r => r.json())
    .then(data => renderSchedulerStatus(data))
    .catch(err => {
      console.error('Failed to load scheduler status:', err);
      document.getElementById('scheduler-status-badge').innerHTML =
        '<span style="color:#ef4444;">❌ 无法获取调度器状态</span>';
    });
}

function renderSchedulerStatus(data) {
  // Status badge
  const badge = document.getElementById('scheduler-status-badge');
  if (data.running) {
    badge.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;background:#dcfce7;color:#166534;border-radius:20px;font-weight:600;font-size:13px;"><span style="width:8px;height:8px;background:#16a34a;border-radius:50%;display:inline-block;"></span>运行中</span>';
  } else {
    badge.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;background:#fee2e2;color:#991b1b;border-radius:20px;font-weight:600;font-size:13px;"><span style="width:8px;height:8px;background:#dc2626;border-radius:50%;display:inline-block;"></span>已停止</span>';
  }

  // Jobs table
  const tbody = document.getElementById('scheduler-jobs-tbody');
  if (!data.jobs || data.jobs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:#999;">没有定时任务</td></tr>';
  } else {
    tbody.innerHTML = data.jobs.map(j => {
      const nameMap = { wms_monitor: '🏭 WMS 仓库监控', tms_export: '📦 TMS 每日导出' };
      const label = nameMap[j.id] || j.name;
      return `<tr>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${label}</td>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#64748b;">${j.trigger}</td>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;font-size:13px;">${j.next_run || '-'}</td>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:center;">
          <button class="btn-secondary" style="padding:5px 12px;font-size:12px;" onclick="triggerSchedulerJob('${j.id}')">▶ 立即执行</button>
        </td>
      </tr>`;
    }).join('');
  }

  // History
  renderJobHistory('scheduler-history-wms', data.history?.wms_monitor || []);
  renderJobHistory('scheduler-history-tms', data.history?.tms_export || []);
}

function renderJobHistory(containerId, entries) {
  const el = document.getElementById(containerId);
  if (!entries || entries.length === 0) {
    el.innerHTML = '<div style="padding:16px;text-align:center;color:#999;font-size:13px;">暂无执行记录</div>';
    return;
  }
  // Show most recent first
  const rows = entries.slice().reverse().map(e => {
    const icon = e.success ? '✅' : '❌';
    const bg = e.success ? '#f0fdf4' : '#fef2f2';
    const color = e.success ? '#166534' : '#991b1b';
    return `<div style="padding:8px 12px;border-bottom:1px solid #f1f5f9;background:${bg};font-size:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span>${icon} <span style="color:${color};font-weight:500;">${e.message}</span></span>
        <span style="color:#94a3b8;white-space:nowrap;margin-left:8px;">${e.duration_s}s</span>
      </div>
      <div style="color:#94a3b8;margin-top:2px;">${e.time}</div>
    </div>`;
  }).join('');
  el.innerHTML = rows;
}

function triggerSchedulerJob(jobId) {
  fetch(`/api/scheduler/trigger/${jobId}`, { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification(data.message, 'success');
        // Refresh after a short delay to show the new run
        setTimeout(loadSchedulerStatus, 3000);
      } else {
        showNotification(data.error || '触发失败', 'error');
      }
    })
    .catch(err => {
      console.error('Trigger failed:', err);
      showNotification('请求失败', 'error');
    });
}

// Wire up refresh button
document.addEventListener('DOMContentLoaded', function() {
  const refreshBtn = document.getElementById('scheduler-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadSchedulerStatus);
  }
});


function initOperationsSubTabs() {
  const subtabs = document.querySelectorAll('#operations-subtabs .settings-subtab');
  
  subtabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-operations-tab');
      
      // Deactivate all operations sub-tabs
      subtabs.forEach(t => t.classList.remove('active'));
      
      // Hide all operations sub-tab content
      document.querySelectorAll('#fedex-operations-tab .settings-subtab-content').forEach(content => {
        content.style.display = 'none';
      });
      
      // Activate clicked tab
      tab.classList.add('active');
      
      // Show target content
      const target = document.getElementById(targetId);
      if (target) {
        target.style.display = 'block';
      }
    });
  });
}

function initTurnoverSubTabs() {
  const subtabs = document.querySelectorAll('#turnover-subtabs .settings-subtab');

  subtabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-turnover-tab');

      // Deactivate all turnover sub-tabs
      subtabs.forEach(t => t.classList.remove('active'));

      // Hide all turnover sub-tab content
      document.querySelectorAll('#turnover-tab .settings-subtab-content').forEach(content => {
        content.style.display = 'none';
      });

      // Activate clicked tab
      tab.classList.add('active');

      // Show target content
      const target = document.getElementById(targetId);
      if (target) {
        target.style.display = 'block';
      }

      // Trigger data loading for the sub-tab if its content is empty
      if (targetId === 'turnover-overview' && window.loadTurnoverOverview) {
        loadTurnoverOverview();
      } else if (targetId === 'turnover-volume' && window.loadTurnoverVolume) {
        loadTurnoverVolume();
      } else if (targetId === 'turnover-customers' && window.loadTurnoverCustomers) {
        loadTurnoverCustomers();
      } else if (targetId === 'turnover-skus' && window.loadTurnoverSkus) {
        loadTurnoverSkus();
      } else if (targetId === 'turnover-warehouses' && window.loadTurnoverWarehouses) {
        loadTurnoverWarehouses();
      }
    });
  });
}

// ===============================
// Permission Management
// ===============================

function applyPermissions() {
  const permissions = window.USER_PERMISSIONS || [];
  
  // Calculate composite permission for fedex_operations
  // User has fedex_operations access if they have any of: dashboard, verify, search
  const hasFedexOperations = permissions.includes('dashboard') || 
                             permissions.includes('verify') || 
                             permissions.includes('search');
  
  // Hide nav items without permission
  document.querySelectorAll('.nav-item[data-permission]').forEach(item => {
    const permission = item.getAttribute('data-permission');
    let hasPermission = permissions.includes(permission);
    
    // Special handling for fedex_operations composite permission
    if (permission === 'fedex_operations') {
      hasPermission = hasFedexOperations;
    }
    
    if (!hasPermission) {
      item.style.display = 'none';
    }
  });
  
  // Hide tab contents without permission
  document.querySelectorAll('.tab-content[data-permission]').forEach(tab => {
    const permission = tab.getAttribute('data-permission');
    let hasPermission = permissions.includes(permission);
    
    // Special handling for fedex_operations
    if (permission === 'fedex_operations') {
      hasPermission = hasFedexOperations;
    }
    
    if (!hasPermission) {
      tab.style.display = 'none';
    }
  });
  
  // Hide settings sub-tab content and tab buttons without permission
  document.querySelectorAll('#settings-tab .settings-subtab-content[data-permission]').forEach(section => {
    const permission = section.getAttribute('data-permission');
    if (!permissions.includes(permission)) {
      section.style.display = 'none';
    }
  });
  document.querySelectorAll('#settings-tab .settings-subtab[data-permission]').forEach(tab => {
    const permission = tab.getAttribute('data-permission');
    if (!permissions.includes(permission)) {
      tab.style.display = 'none';
    }
  });
  
  // Hide operations sub-tab content and tab buttons without permission
  document.querySelectorAll('#fedex-operations-tab .settings-subtab-content[data-permission]').forEach(section => {
    const permission = section.getAttribute('data-permission');
    if (!permissions.includes(permission)) {
      section.style.display = 'none';
    }
  });
  document.querySelectorAll('#fedex-operations-tab .settings-subtab[data-permission]').forEach(tab => {
    const permission = tab.getAttribute('data-permission');
    if (!permissions.includes(permission)) {
      tab.style.display = 'none';
    }
  });
  
  // Activate first visible settings sub-tab
  const firstVisibleSubTab = document.querySelector('#settings-tab .settings-subtab:not([style*="display: none"])');
  if (firstVisibleSubTab && !document.querySelector('#settings-tab .settings-subtab.active:not([style*="display: none"])')) {
    firstVisibleSubTab.click();
  }
  
  // Activate first visible operations sub-tab
  const firstVisibleOpsTab = document.querySelector('#fedex-operations-tab .settings-subtab:not([style*="display: none"])');
  if (firstVisibleOpsTab && !document.querySelector('#fedex-operations-tab .settings-subtab.active:not([style*="display: none"])')) {
    firstVisibleOpsTab.click();
  }
  
  // Hide empty nav sections
  document.querySelectorAll('.nav-section').forEach(section => {
    const visibleItems = section.querySelectorAll('.nav-item:not([style*="display: none"])');
    if (visibleItems.length === 0) {
      section.style.display = 'none';
    }
  });
  
  // Make sure at least one tab is active and visible
  const activeTab = document.querySelector('.nav-item.active');
  if (activeTab && activeTab.style.display === 'none') {
    // Find first visible tab and activate it
    const firstVisibleTab = document.querySelector('.nav-item:not([style*="display: none"])');
    if (firstVisibleTab) {
      activeTab.classList.remove('active');
      firstVisibleTab.classList.add('active');
      
      // Show corresponding content
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      const tabId = firstVisibleTab.getAttribute('data-tab') + '-tab';
      const tabContent = document.getElementById(tabId);
      if (tabContent) tabContent.classList.add('active');
    }
  }
}

// ===============================
// User Management
// ===============================

let usersData = null;
let availablePermissions = {};
let defaultRolePermissions = {};
let permissionGroups = {};

async function initUserManagement() {
  const addUserBtn = document.getElementById('add-user-btn');
  const userModal = document.getElementById('user-modal');
  const userForm = document.getElementById('user-form');
  const cancelBtn = document.getElementById('user-modal-cancel');
  const roleSelect = document.getElementById('user-form-role');
  
  if (addUserBtn) {
    addUserBtn.addEventListener('click', () => openUserModal());
  }
  
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeUserModal);
  }
  
  if (userModal) {
    userModal.addEventListener('click', (e) => {
      if (e.target === userModal) closeUserModal();
    });
  }
  
  if (userForm) {
    userForm.addEventListener('submit', handleUserFormSubmit);
  }
  
  if (roleSelect) {
    roleSelect.addEventListener('change', updatePermissionsFromRole);
  }
  
  // Add filter event listeners
  const roleFilter = document.getElementById('user-role-filter');
  const statusFilter = document.getElementById('user-status-filter');
  const searchFilter = document.getElementById('user-search-filter');
  const clearFilters = document.getElementById('user-clear-filters');
  
  if (roleFilter) {
    roleFilter.addEventListener('change', renderUsersTable);
  }
  
  if (statusFilter) {
    statusFilter.addEventListener('change', renderUsersTable);
  }
  
  if (searchFilter) {
    searchFilter.addEventListener('input', renderUsersTable);
  }
  
  if (clearFilters) {
    clearFilters.addEventListener('click', () => {
      if (roleFilter) roleFilter.value = 'all';
      if (statusFilter) statusFilter.value = 'all';
      if (searchFilter) searchFilter.value = '';
      renderUsersTable();
    });
  }
  
  // Load users when the tab is activated
  await loadUsers();
}

async function loadUsers() {
  try {
    const response = await fetch('/api/users');
    const data = await response.json();
    
    if (data.success) {
      usersData = data.users;
      availablePermissions = data.available_permissions;
      defaultRolePermissions = data.default_role_permissions;
      permissionGroups = data.permission_groups || {};
      renderUsersTable();
    } else {
      console.error('Error loading users:', data.error);
    }
  } catch (error) {
    console.error('Error loading users:', error);
  }
}

function renderUsersTable() {
  const tbody = document.getElementById('users-tbody');
  if (!tbody || !usersData) return;
  
  // Get filter values
  const roleFilter = document.getElementById('user-role-filter')?.value || 'all';
  const statusFilter = document.getElementById('user-status-filter')?.value || 'all';
  const searchFilter = document.getElementById('user-search-filter')?.value.toLowerCase() || '';
  
  // Apply filters
  let filteredUsers = usersData.filter(user => {
    // Role filter
    if (roleFilter !== 'all' && user.role !== roleFilter) return false;
    
    // Status filter
    if (statusFilter === 'active' && !user.is_active) return false;
    if (statusFilter === 'disabled' && user.is_active) return false;
    
    // Search filter
    if (searchFilter) {
      const username = (user.username || '').toLowerCase();
      const displayName = (user.display_name || '').toLowerCase();
      if (!username.includes(searchFilter) && !displayName.includes(searchFilter)) return false;
    }
    
    return true;
  });
  
  if (filteredUsers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 40px; color: #666;">
          No users found.
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = filteredUsers.map(user => {
    const statusBadge = user.is_active 
      ? '<span style="background: #dcfce7; color: #16a34a; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 500;">Active</span>'
      : '<span style="background: #fee2e2; color: #dc2626; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 500;">Disabled</span>';
    
    const roleBadge = {
      'admin': '<span style="background: #fef3c7; color: #b45309; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 500;">Admin</span>',
      'sub-admin': '<span style="background: #fed7aa; color: #c2410c; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 500;">Sub-Admin</span>',
      'manager': '<span style="background: #dbeafe; color: #1d4ed8; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 500;">Manager</span>',
      'operator': '<span style="background: #e0e7ff; color: #4338ca; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 500;">Operator</span>',
      'viewer': '<span style="background: #f1f5f9; color: #475569; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 500;">Viewer</span>'
    }[user.role] || user.role;
    
    const lastLogin = user.last_login 
      ? new Date(user.last_login).toLocaleString() 
      : '<span style="color: #9ca3af; font-style: italic;">Never</span>';
    
    const isCurrentUser = window.CURRENT_USER && window.CURRENT_USER.id === user.id;
    const isSubAdmin = window.CURRENT_USER && window.CURRENT_USER.role === 'sub-admin';
    
    // Sub-admin can only edit/manage viewers
    const canManageThisUser = !isSubAdmin || user.role === 'viewer';
    
    // Don't show delete button for current user or if sub-admin can't manage this user
    const deleteBtn = (isCurrentUser || !canManageThisUser)
      ? '' 
      : `<button onclick="deleteUser(${user.id}, '${escapeHtml(user.username)}')" class="action-btn action-btn-delete" title="Delete User">🗑️</button>`;
    
    // Show edit/password buttons only if can manage this user
    const editBtn = canManageThisUser
      ? `<button onclick="openUserModal(${user.id})" class="action-btn action-btn-edit" title="Edit User">✏️ Edit</button>`
      : '';
    
    const passwordBtn = canManageThisUser
      ? `<button onclick="resetUserPassword(${user.id}, '${escapeHtml(user.username)}')" class="action-btn action-btn-password" title="Reset Password">🔑</button>`
      : '';
    
    return `
      <tr>
        <td class="username-cell">${escapeHtml(user.username)}${isCurrentUser ? ' <span style="color: #3b82f6; font-weight: normal;">(you)</span>' : ''}</td>
        <td>${escapeHtml(user.display_name || '-')}</td>
        <td>${roleBadge}</td>
        <td>${statusBadge}</td>
        <td style="font-size: 13px;">${lastLogin}</td>
        <td>
          ${editBtn}
          ${passwordBtn}
          ${deleteBtn}
        </td>
      </tr>
    `;
  }).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function openUserModal(userId = null) {
  const modal = document.getElementById('user-modal');
  const title = document.getElementById('user-modal-title');
  const form = document.getElementById('user-form');
  const passwordSection = document.getElementById('password-section');
  const passwordRequired = document.getElementById('password-required');
  const passwordHint = document.getElementById('password-hint');
  const usernameInput = document.getElementById('user-form-username');
  const roleSelect = document.getElementById('user-form-role');
  
  form.reset();
  document.getElementById('user-form-id').value = userId || '';
  
  // Check if current user is sub-admin
  const isSubAdmin = window.CURRENT_USER && window.CURRENT_USER.role === 'sub-admin';
  
  // For sub-admin, restrict role options to viewer only
  if (isSubAdmin && !userId) {
    roleSelect.innerHTML = '<option value="viewer">Viewer (只读)</option>';
    roleSelect.disabled = true;
  } else if (isSubAdmin && userId) {
    // Sub-admin cannot edit existing users' roles
    roleSelect.disabled = true;
  } else {
    // Admin/full access
    roleSelect.innerHTML = `
      <option value="viewer">Viewer (只读)</option>
      <option value="operator">Operator (操作员)</option>
      <option value="manager">Manager (经理)</option>
      <option value="sub-admin">Sub-Admin (副管理员)</option>
      <option value="admin">Admin (管理员)</option>
    `;
    roleSelect.disabled = false;
  }
  
  // Populate permissions checkboxes in groups
  const permissionsContainer = document.getElementById('permissions-checkboxes');
  let permHtml = '';
  
  // For sub-admin, hide permissions section (they use default role permissions)
  if (isSubAdmin) {
    permissionsContainer.innerHTML = '<p style="color: #64748b; font-style: italic;">权限由角色自动决定</p>';
  } else {
    // Render permissions by group
    Object.entries(permissionGroups).forEach(([groupName, permKeys]) => {
      permHtml += `<div style="grid-column: 1 / -1; font-weight: 600; margin-top: 10px; margin-bottom: 5px; color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px;">${groupName}</div>`;
      permKeys.forEach(key => {
        const label = availablePermissions[key] || key;
        permHtml += `
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input type="checkbox" name="permissions" value="${key}" style="width: 16px; height: 16px;">
            <span style="font-size: 13px;">${label}</span>
          </label>
        `;
      });
    });
    
    permissionsContainer.innerHTML = permHtml;
  }
  
  if (userId) {
    // Edit mode
    title.textContent = '编辑用户';
    usernameInput.readOnly = true;
    usernameInput.style.background = '#f3f4f6';
    passwordRequired.style.display = 'none';
    passwordHint.textContent = '留空则保持当前密码';
    
    // Find user and populate form
    const user = usersData.find(u => u.id === userId);
    if (user) {
      document.getElementById('user-form-username').value = user.username;
      document.getElementById('user-form-display-name').value = user.display_name || '';
      document.getElementById('user-form-role').value = user.role;
      document.getElementById('user-form-status').value = user.is_active ? '1' : '0';
      
      // Check permissions (only if not sub-admin)
      if (!isSubAdmin) {
        user.permissions.forEach(perm => {
          const checkbox = permissionsContainer.querySelector(`input[value="${perm}"]`);
          if (checkbox) checkbox.checked = true;
        });
      }
    }
  } else {
    // Add mode
    title.textContent = '添加新用户';
    usernameInput.readOnly = false;
    usernameInput.style.background = '';
    passwordRequired.style.display = 'inline';
    passwordHint.textContent = '最少6个字符';
    
    // Set default permissions for viewer role
    if (!isSubAdmin) {
      updatePermissionsFromRole();
    }
  }
  
  modal.style.display = 'flex';
}

function closeUserModal() {
  document.getElementById('user-modal').style.display = 'none';
}

function updatePermissionsFromRole() {
  const role = document.getElementById('user-form-role').value;
  const permissions = defaultRolePermissions[role] || [];
  const container = document.getElementById('permissions-checkboxes');
  
  // Uncheck all, then check based on role
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.checked = permissions.includes(cb.value);
  });
}

async function handleUserFormSubmit(e) {
  e.preventDefault();
  
  const userId = document.getElementById('user-form-id').value;
  const username = document.getElementById('user-form-username').value.trim();
  const displayName = document.getElementById('user-form-display-name').value.trim();
  const password = document.getElementById('user-form-password').value;
  const passwordConfirm = document.getElementById('user-form-password-confirm').value;
  const role = document.getElementById('user-form-role').value;
  const isActive = document.getElementById('user-form-status').value === '1';
  
  // Check if current user is sub-admin
  const isSubAdmin = window.CURRENT_USER && window.CURRENT_USER.role === 'sub-admin';
  
  // Sub-admin can only create/edit viewers
  if (isSubAdmin && role !== 'viewer') {
    alert('Sub-Admin 只能创建 Viewer 角色的用户');
    return;
  }
  
  // Collect permissions
  let permissions = [];
  if (isSubAdmin) {
    // Sub-admin always uses default viewer permissions
    permissions = defaultRolePermissions['viewer'] || [];
  } else {
    // Admin/full access can customize permissions
    document.querySelectorAll('#permissions-checkboxes input:checked').forEach(cb => {
      permissions.push(cb.value);
    });
  }
  
  // Validation
  if (!username) {
    alert('用户名为必填项。');
    return;
  }
  
  if (!userId && !password) {
    alert('新用户必须填写密码。');
    return;
  }
  
  if (password && password.length < 6) {
    alert('密码必须至少包含6个字符。');
    return;
  }
  
  if (password && password !== passwordConfirm) {
    alert('密码不匹配。');
    return;
  }
  
  try {
    if (userId) {
      // Update existing user
      const updateData = {
        display_name: displayName,
        role: role,
        permissions: permissions,
        is_active: isActive
      };
      
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });
      
      const result = await response.json();
      if (!result.success) {
        alert('更新用户时出错: ' + result.error);
        return;
      }
      
      // Update password if provided
      if (password) {
        const pwResponse = await fetch(`/api/users/${userId}/password`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: password })
        });
        const pwResult = await pwResponse.json();
        if (!pwResult.success) {
          alert('用户已更新，但密码更改失败: ' + pwResult.error);
        }
      }
      
      alert('用户更新成功！');
    } else {
      // Create new user
      const createData = {
        username: username,
        password: password,
        display_name: displayName,
        role: role,
        permissions: permissions
      };
      
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createData)
      });
      
      const result = await response.json();
      if (!result.success) {
        alert('创建用户时出错: ' + result.error);
        return;
      }
      
      alert('用户创建成功！');
    }
    
    closeUserModal();
    await loadUsers();
  } catch (error) {
    alert('保存用户时出错: ' + error.message);
  }
}

async function resetUserPassword(userId, username) {
  const newPassword = prompt(`请输入 ${username} 的新密码:`);
  if (!newPassword) return;
  
  if (newPassword.length < 6) {
    alert('密码必须至少包含6个字符。');
    return;
  }
  
  try {
    const response = await fetch(`/api/users/${userId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword })
    });
    
    const result = await response.json();
    if (result.success) {
      alert('密码重置成功！');
    } else {
      alert('重置密码时出错: ' + result.error);
    }
  } catch (error) {
    alert('重置密码时出错: ' + error.message);
  }
}

async function deleteUser(userId, username) {
  if (!confirm(`您确定要删除用户 "${username}" 吗？\n\n此操作无法撤销。`)) {
    return;
  }
  
  // Double confirm for safety
  if (!confirm(`最终确认：永久删除用户 "${username}" 吗？`)) {
    return;
  }
  
  try {
    const response = await fetch(`/api/users/${userId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const result = await response.json();
    if (result.success) {
      alert('用户删除成功！');
      await loadUsers();
    } else {
      alert('删除用户时出错: ' + result.error);
    }
  } catch (error) {
    alert('删除用户时出错: ' + error.message);
  }
}

// ============================================
// Warehouse Operations Settings
// ============================================

async function initWarehouseOpsSettings() {
  // Load saved data
  await loadWarehouseOpsSettings();
  
  // Save button handler
  const saveBtn = document.getElementById('save-warehouse-ops');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveWarehouseOpsSettings);
  }
}

async function loadWarehouseOpsSettings() {
  try {
    const res = await fetch('/api/warehouse_ops');
    const data = await res.json();
    
    // Populate shelving fees
    const shelvingFees = data.shelving_fees || {};
    document.getElementById('shelving-fee-0-2').value = shelvingFees['0-2'] || 0;
    document.getElementById('shelving-fee-2-5').value = shelvingFees['2-5'] || 0;
    document.getElementById('shelving-fee-5-10').value = shelvingFees['5-10'] || 0;
    document.getElementById('shelving-fee-10-15').value = shelvingFees['10-15'] || 0;
    document.getElementById('shelving-fee-15-20').value = shelvingFees['15-20'] || 0;
    document.getElementById('shelving-fee-20-25').value = shelvingFees['20-25'] || 0;
    document.getElementById('shelving-fee-25-30').value = shelvingFees['25-30'] || 0;
    document.getElementById('shelving-fee-over-30').value = shelvingFees['over-30'] || 0;
    
    // Populate outbound fees
    const outboundFees = data.outbound_fees || {};
    document.getElementById('outbound-fee-0-1').value = outboundFees['0-1'] || 0;
    document.getElementById('outbound-fee-1-2').value = outboundFees['1-2'] || 0;
    document.getElementById('outbound-fee-2-5').value = outboundFees['2-5'] || 0;
    document.getElementById('outbound-fee-5-10').value = outboundFees['5-10'] || 0;
    document.getElementById('outbound-fee-10-15').value = outboundFees['10-15'] || 0;
    document.getElementById('outbound-fee-15-20').value = outboundFees['15-20'] || 0;
    document.getElementById('outbound-fee-20-25').value = outboundFees['20-25'] || 0;
    document.getElementById('outbound-fee-25-30').value = outboundFees['25-30'] || 0;
    document.getElementById('outbound-fee-over-30').value = outboundFees['over-30'] || 0;
    
    // Store globally for customer quote usage
    window._warehouseOpsData = data;
  } catch (error) {
    console.error('Error loading warehouse ops settings:', error);
  }
}

async function saveWarehouseOpsSettings() {
  try {
    const data = {
      shelving_fees: {
        '0-2': parseFloat(document.getElementById('shelving-fee-0-2').value) || 0,
        '2-5': parseFloat(document.getElementById('shelving-fee-2-5').value) || 0,
        '5-10': parseFloat(document.getElementById('shelving-fee-5-10').value) || 0,
        '10-15': parseFloat(document.getElementById('shelving-fee-10-15').value) || 0,
        '15-20': parseFloat(document.getElementById('shelving-fee-15-20').value) || 0,
        '20-25': parseFloat(document.getElementById('shelving-fee-20-25').value) || 0,
        '25-30': parseFloat(document.getElementById('shelving-fee-25-30').value) || 0,
        'over-30': parseFloat(document.getElementById('shelving-fee-over-30').value) || 0
      },
      outbound_fees: {
        '0-1': parseFloat(document.getElementById('outbound-fee-0-1').value) || 0,
        '1-2': parseFloat(document.getElementById('outbound-fee-1-2').value) || 0,
        '2-5': parseFloat(document.getElementById('outbound-fee-2-5').value) || 0,
        '5-10': parseFloat(document.getElementById('outbound-fee-5-10').value) || 0,
        '10-15': parseFloat(document.getElementById('outbound-fee-10-15').value) || 0,
        '15-20': parseFloat(document.getElementById('outbound-fee-15-20').value) || 0,
        '20-25': parseFloat(document.getElementById('outbound-fee-20-25').value) || 0,
        '25-30': parseFloat(document.getElementById('outbound-fee-25-30').value) || 0,
        'over-30': parseFloat(document.getElementById('outbound-fee-over-30').value) || 0
      }
    };
    
    const res = await fetch('/api/warehouse_ops', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data)
    });
    
    const result = await res.json();
    if (result.status === 'ok') {
      alert('Warehouse operation fees saved successfully!');
      window._warehouseOpsData = data;
    } else {
      alert('Error saving: ' + result.error);
    }
  } catch (error) {
    alert('Error saving warehouse ops settings: ' + error.message);
  }
}

// Calculate warehouse operation fee based on weight in kg
function calculateWarehouseOpsFee(weightKg) {
  const data = window._warehouseOpsData || {};
  const shelvingFees = data.shelving_fees || {};
  const outboundFees = data.outbound_fees || {};
  
  let shelvingFee = 0;
  let outboundFee = 0;
  
  // Calculate shelving fee
  if (weightKg <= 2) {
    shelvingFee = shelvingFees['0-2'] || 0;
  } else if (weightKg <= 5) {
    shelvingFee = shelvingFees['2-5'] || 0;
  } else if (weightKg <= 10) {
    shelvingFee = shelvingFees['5-10'] || 0;
  } else if (weightKg <= 15) {
    shelvingFee = shelvingFees['10-15'] || 0;
  } else if (weightKg <= 20) {
    shelvingFee = shelvingFees['15-20'] || 0;
  } else if (weightKg <= 25) {
    shelvingFee = shelvingFees['20-25'] || 0;
  } else if (weightKg <= 30) {
    shelvingFee = shelvingFees['25-30'] || 0;
  } else {
    // Over 30kg: base fee for 25-30 range + extra per kg over 30
    const baseFee = shelvingFees['25-30'] || 0;
    const extraPerKg = shelvingFees['over-30'] || 0;
    const extraKg = weightKg - 30;
    shelvingFee = baseFee + (extraPerKg * extraKg);
  }
  
  // Calculate outbound fee
  if (weightKg <= 1) {
    outboundFee = outboundFees['0-1'] || 0;
  } else if (weightKg <= 2) {
    outboundFee = outboundFees['1-2'] || 0;
  } else if (weightKg <= 5) {
    outboundFee = outboundFees['2-5'] || 0;
  } else if (weightKg <= 10) {
    outboundFee = outboundFees['5-10'] || 0;
  } else if (weightKg <= 15) {
    outboundFee = outboundFees['10-15'] || 0;
  } else if (weightKg <= 20) {
    outboundFee = outboundFees['15-20'] || 0;
  } else if (weightKg <= 25) {
    outboundFee = outboundFees['20-25'] || 0;
  } else if (weightKg <= 30) {
    outboundFee = outboundFees['25-30'] || 0;
  } else {
    // Over 30kg: base fee for 25-30 range + extra per kg over 30
    const baseFee = outboundFees['25-30'] || 0;
    const extraPerKg = outboundFees['over-30'] || 0;
    const extraKg = weightKg - 30;
    outboundFee = baseFee + (extraPerKg * extraKg);
  }
  
  return {
    shelvingFee,
    outboundFee,
    totalFee: shelvingFee + outboundFee
  };
}

// Expose for customer quote module
window.calculateWarehouseOpsFee = calculateWarehouseOpsFee;
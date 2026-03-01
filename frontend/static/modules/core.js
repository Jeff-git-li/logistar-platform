// ============================================
// Logistar Freight Management System - Core Module
// Utilities, API calls, Navigation, and Global State
// ============================================

// Global State
window.AppState = {
  appData: null,
  currentVersion: null,
  customerData: null,
  supplierData: null,
  currentSupplier: null,
  isVerifying: false,
  analysisResults: null,
  uploadedFileName: '',
  originalInvoiceData: null,
  chartInstances: {}
};

// ============================================
// Utility Functions
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

function formatCurrency(amount) {
  if (amount === null || amount === undefined || amount === '') return '';
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  return '$' + num.toFixed(2);
}

function formatPercentage(value) {
  if (value === null || value === undefined || value === '') return '';
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return num.toFixed(2) + '%';
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function safeAddEventListener(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

// ============================================
// API Functions - Rate Versions
// ============================================

async function getData() {
  const res = await fetch('/api/data');
  return res.json();
}

async function getActiveVersion() {
  const res = await fetch('/api/data/active');
  return res.json();
}

async function getVersionById(versionId) {
  const res = await fetch(`/api/data/version/${versionId}`);
  return res.json();
}

async function saveData(data) {
  const res = await fetch('/api/data', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data)
  });
  return res.json();
}

async function saveVersion(versionId, versionData) {
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

// ============================================
// API Functions - Customer Data
// ============================================

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
// API Functions - Supplier Data
// ============================================

async function getSupplierData() {
  const res = await fetch('/api/suppliers');
  const data = await res.json();
  if (!data.suppliers) data.suppliers = [];
  return data;
}

async function saveSupplierData(data) {
  const res = await fetch('/api/suppliers', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data)
  });
  return res.json();
}

// ============================================
// Navigation - Sidebar
// ============================================

function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const contentSections = document.querySelectorAll('.content-section');
  
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetSection = item.getAttribute('data-section');
      
      // Update active nav item
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');
      
      // Update active content section
      contentSections.forEach(section => {
        section.classList.remove('active');
        if (section.id === targetSection + '-section') {
          section.classList.add('active');
        }
      });
      
      // Trigger section-specific initialization
      onSectionChange(targetSection);
    });
  });

  // Expandable nav groups
  const navGroups = document.querySelectorAll('.nav-group-header');
  navGroups.forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.nav-item')) return; // Don't toggle if clicking on nav item
      const group = header.closest('.nav-group');
      group.classList.toggle('collapsed');
    });
  });
}

function onSectionChange(section) {
  switch(section) {
    case 'dashboard':
      if (typeof initDashboard === 'function') initDashboard();
      break;
    case 'invoice':
      // Invoice section doesn't need special init
      break;
    case 'search':
      // Focus search input
      const searchInput = document.getElementById('search-tracking-input');
      if (searchInput) searchInput.focus();
      break;
    case 'rate-comparison':
      if (typeof initRateComparison === 'function') initRateComparison();
      break;
    case 'customer-quote':
      if (typeof initCustomerQuote === 'function') initCustomerQuote();
      break;
    case 'downloads':
      if (typeof loadDownloadCenter === 'function') loadDownloadCenter();
      break;
    case 'settings':
      if (typeof renderSettings === 'function') renderSettings();
      break;
  }
}

function navigateTo(section) {
  const navItem = document.querySelector(`.nav-item[data-section="${section}"]`);
  if (navItem) navItem.click();
}

// ============================================
// Chart Management
// ============================================

function destroyChart(chartId) {
  if (AppState.chartInstances[chartId]) {
    AppState.chartInstances[chartId].destroy();
    delete AppState.chartInstances[chartId];
  }
}

function createChart(chartId, config) {
  destroyChart(chartId);
  const ctx = document.getElementById(chartId);
  if (!ctx) return null;
  AppState.chartInstances[chartId] = new Chart(ctx, config);
  return AppState.chartInstances[chartId];
}

// ============================================
// Toast Notifications
// ============================================

function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container') || createToastContainer();
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
    <span class="toast-message">${message}</span>
  `;
  
  container.appendChild(toast);
  
  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10);
  
  // Remove after duration
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.id = 'toast-container';
  document.body.appendChild(container);
  return container;
}

// ============================================
// Loading States
// ============================================

function showLoading(elementId, message = 'Loading...') {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.innerHTML = `
    <div class="loading-spinner">
      <div class="spinner"></div>
      <span>${message}</span>
    </div>
  `;
}

function hideLoading(elementId) {
  // This will be replaced by actual content
}

// Export for use in other modules
window.Core = {
  escapeHtml,
  moveArrayItem,
  formatCurrency,
  formatPercentage,
  debounce,
  safeAddEventListener,
  getData,
  getActiveVersion,
  getVersionById,
  saveData,
  saveVersion,
  createNewVersion,
  deleteVersion,
  setActiveVersion,
  getCustomerData,
  saveCustomerData,
  getSupplierData,
  saveSupplierData,
  initNavigation,
  navigateTo,
  destroyChart,
  createChart,
  showToast,
  showLoading
};

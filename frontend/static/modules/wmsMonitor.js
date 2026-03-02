/**
 * WMS Monitor Module — renders the warehouse monitoring dashboard
 * as a tab inside the main Logistar Platform.
 * Fetches data from /api/wms/dashboard and renders with Chart.js.
 */

(function () {
  'use strict';

  // Track Chart.js instances so we can destroy them on refresh
  const wmsCharts = {};
  let wmsAutoRefreshTimer = null;
  let currentTimeRange = '12h';

  /**
   * Initialize the WMS Monitor tab.
   * Called when the tab is shown.
   */
  window.initWmsMonitor = function () {
    loadWmsDashboard(currentTimeRange, true);
    // Auto-refresh every 10 minutes — keep running even when tab is not active
    if (!wmsAutoRefreshTimer) {
      wmsAutoRefreshTimer = setInterval(() => {
        loadWmsDashboard(currentTimeRange, false);
      }, 600000);
    }
  };

  /**
   * Cleanup when leaving the WMS tab.
   * Keep the auto-refresh timer running so data stays fresh.
   */
  window.destroyWmsMonitor = function () {
    // Don't destroy timer — let it keep refreshing in background
    // Only destroy charts to free memory
    Object.values(wmsCharts).forEach(c => c.destroy());
    Object.keys(wmsCharts).forEach(k => delete wmsCharts[k]);
  };

  /**
   * Set the time range and reload.
   */
  window.setWmsTimeRange = function (range) {
    currentTimeRange = range;
    // Update active button
    document.querySelectorAll('.wms-range-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.range === range);
    });
    loadWmsDashboard(range, true);
  };

  /**
   * Fetch dashboard data and render.
   * @param {string} timeRange - e.g. '12h', '24h', '7d', '1m'
   * @param {boolean} showLoading - whether to show the loading spinner (false for background refresh)
   */
  function loadWmsDashboard(timeRange, showLoading) {
    const container = document.getElementById('wms-dashboard-content');
    const loading = document.getElementById('wms-loading');
    if (!container) return;

    if (showLoading) {
      if (loading) loading.style.display = 'flex';
      container.style.display = 'none';
    }

    fetch(`/api/wms/dashboard?range=${timeRange}`)
      .then(r => r.json())
      .then(data => {
        if (loading) loading.style.display = 'none';
        container.style.display = 'block';

        if (data.error) {
          container.innerHTML = `<div style="text-align:center;padding:40px;color:#ef4444;">
            <p style="font-size:18px;">⚠️ ${data.error}</p>
            <p style="color:#6b7280;margin-top:8px;">请确保 WMS Monitor 数据收集程序正在运行</p>
          </div>`;
          return;
        }

        // Update last updated timestamp
        const tsEl = document.getElementById('wms-last-updated');
        if (tsEl) tsEl.textContent = data.last_updated || 'N/A';

        renderWmsWarehouses(data.warehouses || [], timeRange);
      })
      .catch(err => {
        // On background refresh failure, don't overwrite existing content
        if (!showLoading) return;
        if (loading) loading.style.display = 'none';
        container.style.display = 'block';
        container.innerHTML = `<div style="text-align:center;padding:40px;color:#ef4444;">
          <p style="font-size:18px;">⚠️ Failed to load WMS data</p>
          <p style="color:#6b7280;margin-top:8px;">${err.message}</p>
        </div>`;
      });
  }

  /**
   * Render warehouse cards with charts and carrier tables.
   */
  function renderWmsWarehouses(warehouses, timeRange) {
    const container = document.getElementById('wms-warehouses-container');
    if (!container) return;

    // Destroy existing charts
    Object.values(wmsCharts).forEach(c => c.destroy());
    Object.keys(wmsCharts).forEach(k => delete wmsCharts[k]);

    if (warehouses.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:#6b7280;padding:40px;">No warehouse data available</p>';
      return;
    }

    let html = '';
    warehouses.forEach((wh, idx) => {
      const canvasId = `wms-chart-${idx}`;
      const speedDisplay = wh.labeling_speed ? ` | ${wh.labeling_speed}/hr` : '';

      // Carrier table rows — sorted by total (peak) descending
      let carrierRows = '';
      const carrierEntries = Object.entries(wh.carrier_breakdown || {});
      carrierEntries.sort((a, b) => (b[1].peak || 0) - (a[1].peak || 0));
      for (const [carrier, data] of carrierEntries) {
        carrierRows += `
          <tr>
            <td>${carrier}</td>
            <td style="text-align:right;font-weight:600;">${data.current}</td>
            <td style="text-align:right;color:#10b981;font-weight:600;">${data.labeled}</td>
            <td style="text-align:right;color:#6b7280;">${data.peak}</td>
          </tr>`;
      }

      const carrierTable = carrierRows
        ? `<table class="wms-carrier-table">
            <thead>
              <tr>
                <th>Carrier</th>
                <th style="text-align:right;">Unlabeled</th>
                <th style="text-align:right;">Labeled</th>
                <th style="text-align:right;">Total</th>
              </tr>
            </thead>
            <tbody>${carrierRows}</tbody>
           </table>`
        : '<p style="text-align:center;color:#9ca3af;">No data</p>';

      html += `
        <div class="wms-warehouse-card">
          <h3 class="wms-warehouse-title">📦 ${wh.name}: ${wh.count} / ${wh.peak_count}${speedDisplay}</h3>
          <div class="wms-warehouse-content">
            <div class="wms-chart-area">
              <h4 style="color:#6b7280;margin:0 0 8px 0;font-size:13px;">Type Trends (Last ${timeRange.toUpperCase()})</h4>
              <canvas id="${canvasId}"></canvas>
            </div>
            <div class="wms-carrier-area">
              ${carrierTable}
            </div>
          </div>
        </div>`;
    });

    container.innerHTML = html;

    // Create charts after DOM is updated
    requestAnimationFrame(() => {
      warehouses.forEach((wh, idx) => {
        const canvasId = `wms-chart-${idx}`;
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const dataLen = (wh.type1_history || []).length;

        // For 7D/1M: pre-compute the index of the peak value per day per dataset
        const useDailyPeak = (timeRange === '7d' || timeRange === '1m');
        const dailyPeakIndices = [new Set(), new Set()]; // one set per dataset
        if (useDailyPeak) {
          [wh.type1_history || [], wh.type2_history || []].forEach((data, dsIdx) => {
            // Group by calendar date, track the index with the max y
            const dayPeaks = {}; // dateStr -> { maxY, idx }
            data.forEach((pt, i) => {
              const d = new Date(pt.x);
              const key = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
              if (!dayPeaks[key] || pt.y > dayPeaks[key].maxY) {
                dayPeaks[key] = { maxY: pt.y, idx: i };
              }
            });
            Object.values(dayPeaks).forEach(p => dailyPeakIndices[dsIdx].add(p.idx));
          });
        }

        // Determine reasonable label interval for short ranges
        let labelInterval = 6;
        if (!useDailyPeak) {
          if (dataLen > 100) labelInterval = Math.round(dataLen / 10);
        }

        // Adjust point radius for dense charts
        const pointR = dataLen > 200 ? 0 : 2;
        const pointHoverR = dataLen > 200 ? 4 : 6;

        // Adjust x-axis time settings based on range
        let timeUnit = 'hour';
        let timeDisplayFormats = { hour: 'h:mma' };
        if (timeRange === '7d') {
          timeUnit = 'day';
          timeDisplayFormats = { day: 'MM/dd' };
        } else if (timeRange === '1m') {
          timeUnit = 'day';
          timeDisplayFormats = { day: 'MM/dd' };
        }

        wmsCharts[canvasId] = new Chart(ctx, {
          type: 'line',
          data: {
            datasets: [
              {
                label: '一票一件',
                data: wh.type1_history || [],
                borderColor: '#10b981',
                backgroundColor: 'rgba(16,185,129,0.1)',
                borderWidth: 2,
                tension: 0.1,
                fill: true,
                pointRadius: pointR,
                pointHoverRadius: pointHoverR,
              },
              {
                label: '一票一件多个',
                data: wh.type2_history || [],
                borderColor: '#f43f5e',
                backgroundColor: 'rgba(244,63,94,0.1)',
                borderWidth: 2,
                tension: 0.1,
                fill: true,
                pointRadius: pointR,
                pointHoverRadius: pointHoverR,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 18, bottom: 5, left: 5, right: 18 } },
            scales: {
              x: {
                type: 'time',
                time: {
                  unit: timeUnit,
                  displayFormats: timeDisplayFormats,
                  tooltipFormat: 'MM/dd h:mma',
                },
                ticks: { maxRotation: 45, minRotation: 45 },
                grid: { display: true },
              },
              y: {
                beginAtZero: true,
                ticks: {
                  callback: function (value) {
                    return value >= 1000 ? (value / 1000) + 'k' : value;
                  },
                },
              },
            },
            plugins: {
              legend: { display: true, position: 'bottom', labels: { padding: 15, font: { size: 13 } } },
              tooltip: { mode: 'index', intersect: false },
              datalabels: {
                display: function (context) {
                  const i = context.dataIndex;
                  const len = context.dataset.data.length;
                  if (useDailyPeak) {
                    // Show label only at the daily peak point
                    return dailyPeakIndices[context.datasetIndex].has(i);
                  }
                  // Short ranges: first, last, and fixed interval
                  if (i === 0 || i === len - 1) return true;
                  return i % labelInterval === 0;
                },
                align: 'top',
                color: function (context) { return context.dataset.borderColor; },
                font: { weight: 'bold', size: 12 },
                formatter: function (value) { return value.y; },
              },
            },
          },
          plugins: [ChartDataLabels],
        });
      });
    });
  }
})();

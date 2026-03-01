#!/usr/bin/env python3
"""
Flask dashboard with line charts showing WMS unpacked order trends over last 12 hours.
"""

import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from flask import Flask, jsonify
from functools import lru_cache

DB_PATH = Path(__file__).parent / "wms_counts.db"

app = Flask(__name__)

# Cache for peak calculations (invalidated by timestamp)
_peak_cache = {}
_cache_timestamp = None


def get_conn():
    return sqlite3.connect(DB_PATH)


def get_cached_peaks(conn, latest_ts: int, today_6am_ts: int):
    """Get peak counts with caching to avoid recalculating on every request."""
    global _peak_cache, _cache_timestamp
    
    # Invalidate cache if timestamp changed
    if _cache_timestamp != latest_ts:
        _peak_cache = {}
        _cache_timestamp = latest_ts
    
    if 'warehouse_peaks' not in _peak_cache:
        # Calculate all warehouse peaks
        cur = conn.execute("""
            SELECT warehouse, MAX(count) as peak_count
            FROM counts 
            WHERE ts >= ?
            GROUP BY warehouse
        """, (today_6am_ts,))
        _peak_cache['warehouse_peaks'] = {row[0]: row[1] for row in cur.fetchall()}
    
    if 'carrier_peaks' not in _peak_cache:
        # Calculate all carrier peaks
        cur = conn.execute("""
            SELECT warehouse, carrier_name, MAX(count) as peak_count
            FROM carrier_breakdown 
            WHERE ts >= ?
            GROUP BY warehouse, carrier_name
        """, (today_6am_ts,))
        _peak_cache['carrier_peaks'] = {}
        for wh, carrier, peak in cur.fetchall():
            if wh not in _peak_cache['carrier_peaks']:
                _peak_cache['carrier_peaks'][wh] = {}
            _peak_cache['carrier_peaks'][wh][carrier] = peak
    
    return _peak_cache['warehouse_peaks'], _peak_cache['carrier_peaks']


@app.get("/api/current")
def api_current():
    with get_conn() as conn:
        # Get latest timestamp
        cur = conn.execute("SELECT MAX(ts) FROM counts")
        ts_row = cur.fetchone()
        if not ts_row or not ts_row[0]:
            return jsonify({"ts": None, "warehouses": []})
        
        ts = ts_row[0]
        
        # Get all warehouses for this timestamp
        cur = conn.execute("SELECT warehouse, count FROM counts WHERE ts = ? ORDER BY warehouse", (ts,))
        warehouse_rows = cur.fetchall()
        
        warehouses = []
        for wh_name, wh_count in warehouse_rows:
            # Get type breakdown for this warehouse
            cur = conn.execute("SELECT type_name, count FROM type_breakdown WHERE ts = ? AND warehouse = ?", (ts, wh_name))
            type_breakdown = {r[0]: r[1] for r in cur.fetchall()}
            
            # Get carrier breakdown for this warehouse
            cur = conn.execute("SELECT carrier_name, count FROM carrier_breakdown WHERE ts = ? AND warehouse = ? ORDER BY count DESC", (ts, wh_name))
            carrier_breakdown = {r[0]: r[1] for r in cur.fetchall()}
            
            warehouses.append({
                "name": wh_name,
                "count": wh_count,
                "type_breakdown": type_breakdown,
                "carrier_breakdown": carrier_breakdown
            })
        
    return jsonify({
        "ts": ts,
        "warehouses": warehouses
    })


@app.get("/api/history/<warehouse>")
def api_history_warehouse(warehouse):
    """Get last 12 hours of data for specific warehouse."""
    since = int((datetime.now(timezone.utc) - timedelta(hours=12)).timestamp())
    with get_conn() as conn:
        cur = conn.execute("SELECT ts, count FROM counts WHERE warehouse = ? AND ts >= ? ORDER BY ts ASC", (warehouse, since))
        rows = cur.fetchall()
    return jsonify([{"ts": r[0], "count": r[1]} for r in rows])


@app.get("/")
def dashboard():
    from flask import request
    # Get time range from query parameter (default: 12h)
    time_range = request.args.get('range', '12h')
    
    # Parse time range
    range_map = {
        '6h': 6,
        '12h': 12,
        '24h': 24,
        '7d': 168
    }
    hours = range_map.get(time_range, 12)
    
    with get_conn() as conn:
        # Get latest timestamp
        cur = conn.execute("SELECT MAX(ts) FROM counts")
        ts_row = cur.fetchone()
        latest_ts = ts_row[0] if ts_row else None
        
        # Get all warehouses for latest timestamp
        warehouses_data = []
        if latest_ts:
            # Calculate today's start at 6am Pacific Time
            pacific = ZoneInfo("America/Los_Angeles")
            now_pt = datetime.now(pacific)
            today_6am_pt = now_pt.replace(hour=6, minute=0, second=0, microsecond=0)
            if now_pt.hour < 6:
                # If before 6am, use yesterday's 6am
                today_6am_pt = today_6am_pt - timedelta(days=1)
            today_6am_ts = int(today_6am_pt.timestamp())
            
            # Get cached peaks for all warehouses and carriers
            warehouse_peaks, carrier_peaks = get_cached_peaks(conn, latest_ts, today_6am_ts)
            
            cur = conn.execute("SELECT warehouse, count FROM counts WHERE ts = ? ORDER BY warehouse", (latest_ts,))
            for wh_name, wh_count in cur.fetchall():
                # Get today's peak count for this warehouse from cache
                wh_peak_count = warehouse_peaks.get(wh_name, wh_count)
                
                # Type breakdown
                cur2 = conn.execute("SELECT type_name, count FROM type_breakdown WHERE ts = ? AND warehouse = ?", (latest_ts, wh_name))
                type_breakdown = {r[0]: r[1] for r in cur2.fetchall()}
                
                # Carrier breakdown with peak tracking
                cur3 = conn.execute("SELECT carrier_name, count FROM carrier_breakdown WHERE ts = ? AND warehouse = ? ORDER BY count DESC", (latest_ts, wh_name))
                carrier_breakdown = {}
                
                # First, add carriers from current data
                for carrier_name, carrier_count in cur3.fetchall():
                    # Get peak count for this carrier from cache
                    carrier_peak = carrier_peaks.get(wh_name, {}).get(carrier_name, carrier_count)
                    
                    carrier_breakdown[carrier_name] = {
                        "current": carrier_count,
                        "peak": carrier_peak,
                        "labeled": carrier_peak - carrier_count
                    }
                
                # If no current carriers (unpacked = 0), show carriers from peak data
                if not carrier_breakdown and wh_name in carrier_peaks:
                    for carrier_name, carrier_peak in carrier_peaks[wh_name].items():
                        carrier_breakdown[carrier_name] = {
                            "current": 0,
                            "peak": carrier_peak,
                            "labeled": carrier_peak
                        }
                
                # Sort by peak count descending
                carrier_breakdown = dict(sorted(carrier_breakdown.items(), 
                                               key=lambda x: x[1]["peak"], 
                                               reverse=True))
                
                # Get history for selected time range
                since_ts = int((datetime.now(timezone.utc) - timedelta(hours=hours)).timestamp())
                
                # Get type breakdown history (一票一件 and 一票一件多个)
                cur4 = conn.execute("""
                    SELECT ts, type_name, count 
                    FROM type_breakdown 
                    WHERE warehouse = ? AND ts >= ? 
                    ORDER BY ts ASC
                """, (wh_name, since_ts))
                
                # Organize by timestamp and type
                type_history = {}
                for ts, type_name, count in cur4.fetchall():
                    if ts not in type_history:
                        type_history[ts] = {}
                    type_history[ts][type_name] = count
                
                # Convert to lists for chart
                timestamps = sorted(type_history.keys())
                type1_data = [type_history[ts].get("一票一件", 0) for ts in timestamps]
                type2_data = [type_history[ts].get("一票一件多个", 0) for ts in timestamps]
                
                # Calculate labeling speed (orders per hour)
                labeling_speed = None
                if len(timestamps) >= 2:
                    # Get previous count
                    prev_ts = timestamps[-2]
                    cur5 = conn.execute("SELECT count FROM counts WHERE warehouse = ? AND ts = ?", (wh_name, prev_ts))
                    prev_row = cur5.fetchone()
                    if prev_row:
                        prev_count = prev_row[0]
                        labeled = prev_count - wh_count
                        time_diff_hours = (latest_ts - prev_ts) / 3600
                        if labeled > 0 and time_diff_hours > 0:
                            labeling_speed = labeled / time_diff_hours
                
                warehouses_data.append({
                    "name": wh_name,
                    "count": wh_count,
                    "peak_count": wh_peak_count,
                    "labeling_speed": labeling_speed,
                    "type_breakdown": type_breakdown,
                    "carrier_breakdown": carrier_breakdown,
                    "timestamps": timestamps,
                    "type1_history": type1_data,
                    "type2_history": type2_data
                })
        
        # Sort warehouses by priority from .env
        import os
        priority_str = os.getenv("WMS_WAREHOUSE_PRIORITY", "ONT002,FLT001,RIA001")
        priority_list = [p.strip() for p in priority_str.split(",")]
        
        def warehouse_priority(wh):
            name = wh["name"]
            for i, priority_code in enumerate(priority_list):
                if priority_code in name:
                    return (i, name)
            return (len(priority_list), name)
        
        warehouses_data.sort(key=warehouse_priority)

    def fmt_ts(ts):
        pacific = ZoneInfo("America/Los_Angeles")
        return datetime.fromtimestamp(ts, tz=pacific).strftime("%Y-%m-%d %H:%M:%S PT")
    
    def fmt_ts_short(ts):
        pacific = ZoneInfo("America/Los_Angeles")
        return datetime.fromtimestamp(ts, tz=pacific).strftime("%m/%d %H:%M")

    # Build warehouse sections HTML
    warehouses_html = ""
    
    if warehouses_data:
        for wh in warehouses_data:
            # Prepare chart data with timestamps (milliseconds for Chart.js)
            type1_data_points = [{"x": ts * 1000, "y": count} for ts, count in zip(wh["timestamps"], wh["type1_history"])]
            type2_data_points = [{"x": ts * 1000, "y": count} for ts, count in zip(wh["timestamps"], wh["type2_history"])]
            
            # Carrier breakdown table with peak and labeled columns
            carrier_rows = ""
            for carrier, data in wh["carrier_breakdown"].items():
                current = data["current"]
                peak = data["peak"]
                labeled = data["labeled"]
                carrier_rows += f"<tr><td>{carrier}</td><td style='text-align: right; font-weight: 600;'>{current}</td><td style='text-align: right; color: #4CAF50; font-weight: 600;'>{labeled}</td><td style='text-align: right; color: #666;'>{peak}</td></tr>"
            
            carrier_table = f"""
            <table style='width: 100%; border-collapse: collapse;'>
              <thead>
                <tr style='background: #f5f5f5; border-bottom: 2px solid #4CAF50;'>
                  <th style='padding: 10px; text-align: left;'>Carrier</th>
                  <th style='padding: 10px; text-align: right;'>Unlabeled</th>
                  <th style='padding: 10px; text-align: right;'>Labeled</th>
                  <th style='padding: 10px; text-align: right;'>Total</th>
                </tr>
              </thead>
              <tbody>{carrier_rows}</tbody>
            </table>
            """ if carrier_rows else "<p style='text-align: center; color: #999;'>No data</p>"
            
            safe_wh_name = wh["name"].replace(" ", "_").replace("[", "").replace("]", "")
            
            speed_display = f" | {wh['labeling_speed']:.1f}/hr" if wh.get('labeling_speed') else ""
            warehouses_html += f"""
            <div style="margin-bottom: 30px; padding: 20px; border: 2px solid #4CAF50; border-radius: 8px; background: white;">
              <h3 style="margin-top: 0; color: #2E7D32;">📦 {wh["name"]}: {wh["count"]} / {wh["peak_count"]}{speed_display}</h3>
              
              <div style="display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-start;">
                <div style="flex: 3; min-width: 280px; max-width: 100%;">
                  <h4 style="color: #555;">Type Trends (Last {time_range.upper()})</h4>
                  <canvas id="chart_{safe_wh_name}"></canvas>
                </div>
                <div style="flex: 1; min-width: 250px; max-width: 100%;">
                  {carrier_table}
                </div>
              </div>
              
              <script>
                (function() {{
                  // Line chart for trends
                  const ctx = document.getElementById('chart_{safe_wh_name}').getContext('2d');
                  new Chart(ctx, {{
                    type: 'line',
                    data: {{
                      datasets: [{{
                        label: '一票一件',
                        data: {type1_data_points},
                        borderColor: '#4CAF50',
                        backgroundColor: 'rgba(76, 175, 80, 0.1)',
                        borderWidth: 2,
                        tension: 0.1,
                        fill: true,
                        pointRadius: 2,
                        pointHoverRadius: 6
                      }}, {{
                        label: '一票一件多个',
                        data: {type2_data_points},
                        borderColor: '#FF6384',
                        backgroundColor: 'rgba(255, 99, 132, 0.1)',
                        borderWidth: 2,
                        tension: 0.1,
                        fill: true,
                        pointRadius: 2,
                        pointHoverRadius: 6
                      }}]
                    }},
                    options: {{
                      responsive: true,
                      maintainAspectRatio: false,
                      layout: {{
                        padding: {{
                          top: 18,
                          bottom: 5,
                          left: 5,
                          right: 18
                        }}
                      }},
                      scales: {{
                        x: {{
                          type: 'time',
                          time: {{
                            unit: 'hour',
                            displayFormats: {{
                              hour: 'h:mma'
                            }},
                            tooltipFormat: 'MM/dd h:mma'
                          }},
                          ticks: {{
                            maxRotation: 45,
                            minRotation: 45
                          }},
                          grid: {{
                            display: true
                          }}
                        }},
                        y: {{
                          beginAtZero: true,
                          ticks: {{
                            callback: function(value) {{
                              if (value >= 1000) {{
                                return (value / 1000) + 'k';
                              }}
                              return value;
                            }},
                            stepSize: undefined
                          }}
                        }}
                      }},
                      plugins: {{
                        legend: {{
                          display: true,
                          position: 'bottom',
                          labels: {{
                            padding: 15,
                            font: {{
                              size: 13
                            }}
                          }}
                        }},
                        tooltip: {{
                          mode: 'index',
                          intersect: false
                        }},
                        datalabels: {{
                          display: function(context) {{
                            // Show every 3rd label to reduce clutter on mobile
                            // Always show first and last
                            const index = context.dataIndex;
                            const dataLength = context.dataset.data.length;
                            
                            if (index === 0 || index === dataLength - 1) {{
                              return true;
                            }}
                            
                            // Show every 3rd point
                            return index % 6 === 0;
                          }},
                          align: 'top',
                          color: function(context) {{
                            return context.dataset.borderColor;
                          }},
                          font: {{
                            weight: 'bold',
                            size: 12
                          }},
                          formatter: function(value) {{
                            return value.y;
                          }}
                        }}
                      }}
                    }},
                    plugins: [ChartDataLabels]
                  }});
                }})();
              </script>
            </div>
            """
    
    current_html = "<p>No data</p>" if not latest_ts else f"<p style='font-size: 14px; color: #666;'>Last Updated: {fmt_ts(latest_ts)}</p>"
    
    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Logistar WMS Dashboard - Unpacked Orders</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js"></script>
  <style>
    body {{
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      margin: 0;
      padding: 20px;
    }}
    .container {{
      max-width: 1400px;
      margin: 0 auto;
      background: rgba(255, 255, 255, 0.95);
      padding: 30px;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    }}
    h1 {{
      color: #2E7D32;
      text-align: center;
      margin-bottom: 10px;
      font-size: 32px;
    }}
    table {{
      border-collapse: collapse;
      font-size: 14px;
    }}
    th, td {{
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }}
    th {{
      background: #f5f5f5;
      font-weight: 600;
      color: #333;
    }}
    canvas {{
      max-height: 300px;
    }}
    .range-btn {{
      padding: 10px 20px;
      margin: 0 5px;
      border: 2px solid #4CAF50;
      background: white;
      color: #4CAF50;
      border-radius: 5px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      transition: all 0.3s;
    }}
    .range-btn:hover {{
      background: #E8F5E9;
    }}
    .range-btn.active {{
      background: #4CAF50;
      color: white;
    }}
  </style>
  <script>
    // Auto-refresh every 2 minutes
    setTimeout(() => location.reload(), 120000);
  </script>
</head>
<body>
  <div class="container">
    <h1>📊 Logistar WMS Monitor</h1>
    {current_html}
    
    <div style="text-align: center; margin: 20px 0;">
      <button onclick="location.href='/?range=6h'" class="range-btn {'active' if time_range == '6h' else ''}">6 Hours</button>
      <button onclick="location.href='/?range=12h'" class="range-btn {'active' if time_range == '12h' else ''}">12 Hours</button>
      <button onclick="location.href='/?range=24h'" class="range-btn {'active' if time_range == '24h' else ''}">24 Hours</button>
      <button onclick="location.href='/?range=7d'" class="range-btn {'active' if time_range == '7d' else ''}">7 Days</button>
    </div>
    
    {warehouses_html}
  </div>
</body>
</html>
"""


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5080, debug=True)

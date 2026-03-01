"""
WMS Monitor Blueprint — provides API endpoints for the WMS monitoring dashboard.
Reads data from the wms-monitor SQLite database (wms_counts.db).
The wms_monitor.py data collector still runs as a separate background process.
"""

import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from flask import Blueprint, jsonify, request
from flask_login import login_required

# Path to the WMS SQLite database (in the services/wms-monitor folder)
WMS_DB_PATH = Path(__file__).parent.parent / "services" / "wms-monitor" / "wms_counts.db"

wms_bp = Blueprint('wms', __name__, url_prefix='/api/wms')

# Cache for peak calculations
_peak_cache = {}
_cache_timestamp = None


def _get_wms_conn():
    """Get connection to the WMS monitor database."""
    if not WMS_DB_PATH.exists():
        return None
    return sqlite3.connect(WMS_DB_PATH)


def _get_cached_peaks(conn, latest_ts: int, today_6am_ts: int):
    """Get peak counts with caching."""
    global _peak_cache, _cache_timestamp

    if _cache_timestamp != latest_ts:
        _peak_cache = {}
        _cache_timestamp = latest_ts

    if 'warehouse_peaks' not in _peak_cache:
        cur = conn.execute("""
            SELECT warehouse, MAX(count) as peak_count
            FROM counts WHERE ts >= ?
            GROUP BY warehouse
        """, (today_6am_ts,))
        _peak_cache['warehouse_peaks'] = {row[0]: row[1] for row in cur.fetchall()}

    if 'carrier_peaks' not in _peak_cache:
        cur = conn.execute("""
            SELECT warehouse, carrier_name, MAX(count) as peak_count
            FROM carrier_breakdown WHERE ts >= ?
            GROUP BY warehouse, carrier_name
        """, (today_6am_ts,))
        _peak_cache['carrier_peaks'] = {}
        for wh, carrier, peak in cur.fetchall():
            if wh not in _peak_cache['carrier_peaks']:
                _peak_cache['carrier_peaks'][wh] = {}
            _peak_cache['carrier_peaks'][wh][carrier] = peak

    return _peak_cache['warehouse_peaks'], _peak_cache['carrier_peaks']


@wms_bp.route('/dashboard')
@login_required
def wms_dashboard_data():
    """Return full WMS dashboard data as JSON for the frontend tab."""
    time_range = request.args.get('range', '12h')
    range_map = {'6h': 6, '12h': 12, '24h': 24, '7d': 168, '1m': 720}
    hours = range_map.get(time_range, 12)

    conn = _get_wms_conn()
    if not conn:
        return jsonify({"error": "WMS database not found", "warehouses": [], "last_updated": None})

    try:
        with conn:
            cur = conn.execute("SELECT MAX(ts) FROM counts")
            ts_row = cur.fetchone()
            latest_ts = ts_row[0] if ts_row else None

            if not latest_ts:
                return jsonify({"warehouses": [], "last_updated": None})

            # Calculate today's 6am Pacific
            pacific = ZoneInfo("America/Los_Angeles")
            now_pt = datetime.now(pacific)
            today_6am_pt = now_pt.replace(hour=6, minute=0, second=0, microsecond=0)
            if now_pt.hour < 6:
                today_6am_pt = today_6am_pt - timedelta(days=1)
            today_6am_ts = int(today_6am_pt.timestamp())

            warehouse_peaks, carrier_peaks = _get_cached_peaks(conn, latest_ts, today_6am_ts)

            cur = conn.execute("SELECT warehouse, count FROM counts WHERE ts = ? ORDER BY warehouse", (latest_ts,))
            warehouses_data = []

            for wh_name, wh_count in cur.fetchall():
                wh_peak_count = warehouse_peaks.get(wh_name, wh_count)

                # Type breakdown
                cur2 = conn.execute("SELECT type_name, count FROM type_breakdown WHERE ts = ? AND warehouse = ?",
                                    (latest_ts, wh_name))
                type_breakdown = {r[0]: r[1] for r in cur2.fetchall()}

                # Carrier breakdown with peak tracking
                cur3 = conn.execute(
                    "SELECT carrier_name, count FROM carrier_breakdown WHERE ts = ? AND warehouse = ? ORDER BY count DESC",
                    (latest_ts, wh_name))
                carrier_breakdown = {}

                for carrier_name, carrier_count in cur3.fetchall():
                    carrier_peak = carrier_peaks.get(wh_name, {}).get(carrier_name, carrier_count)
                    carrier_breakdown[carrier_name] = {
                        "current": carrier_count,
                        "peak": carrier_peak,
                        "labeled": carrier_peak - carrier_count
                    }

                # Merge in any carriers from peaks that have 0 unlabeled now
                if wh_name in carrier_peaks:
                    for carrier_name, carrier_peak in carrier_peaks[wh_name].items():
                        if carrier_name not in carrier_breakdown:
                            carrier_breakdown[carrier_name] = {
                                "current": 0,
                                "peak": carrier_peak,
                                "labeled": carrier_peak
                            }

                # Sort by peak count descending
                carrier_breakdown = dict(sorted(carrier_breakdown.items(),
                                                key=lambda x: x[1]["peak"],
                                                reverse=True))

                # History for chart
                since_ts = int((datetime.now(timezone.utc) - timedelta(hours=hours)).timestamp())
                cur4 = conn.execute("""
                    SELECT ts, type_name, count FROM type_breakdown
                    WHERE warehouse = ? AND ts >= ? ORDER BY ts ASC
                """, (wh_name, since_ts))

                type_history = {}
                for ts, type_name, count in cur4.fetchall():
                    if ts not in type_history:
                        type_history[ts] = {}
                    type_history[ts][type_name] = count

                timestamps = sorted(type_history.keys())
                type1_data = [{"x": ts * 1000, "y": type_history[ts].get("一票一件", 0)} for ts in timestamps]
                type2_data = [{"x": ts * 1000, "y": type_history[ts].get("一票一件多个", 0)} for ts in timestamps]

                # Labeling speed
                labeling_speed = None
                if len(timestamps) >= 2:
                    prev_ts = timestamps[-2]
                    cur5 = conn.execute("SELECT count FROM counts WHERE warehouse = ? AND ts = ?",
                                        (wh_name, prev_ts))
                    prev_row = cur5.fetchone()
                    if prev_row:
                        prev_count = prev_row[0]
                        labeled = prev_count - wh_count
                        time_diff_hours = (latest_ts - prev_ts) / 3600
                        if labeled > 0 and time_diff_hours > 0:
                            labeling_speed = round(labeled / time_diff_hours, 1)

                warehouses_data.append({
                    "name": wh_name,
                    "count": wh_count,
                    "peak_count": wh_peak_count,
                    "labeling_speed": labeling_speed,
                    "type_breakdown": type_breakdown,
                    "carrier_breakdown": carrier_breakdown,
                    "type1_history": type1_data,
                    "type2_history": type2_data,
                })

            # Add warehouses from peaks that have 0 unlabeled now
            current_warehouse_names = {wh['name'] for wh in warehouses_data}
            for wh_name in warehouse_peaks:
                if wh_name not in current_warehouse_names:
                    # Warehouse had orders today but has 0 unlabeled now
                    wh_peak_count = warehouse_peaks[wh_name]

                    # Build carrier breakdown from peaks
                    carrier_breakdown = {}
                    if wh_name in carrier_peaks:
                        for carrier_name, carrier_peak in carrier_peaks[wh_name].items():
                            carrier_breakdown[carrier_name] = {
                                "current": 0,
                                "peak": carrier_peak,
                                "labeled": carrier_peak
                            }
                    carrier_breakdown = dict(sorted(carrier_breakdown.items(),
                                                    key=lambda x: x[1]["peak"],
                                                    reverse=True))

                    # History for chart
                    since_ts = int((datetime.now(timezone.utc) - timedelta(hours=hours)).timestamp())
                    cur_hist = conn.execute("""
                        SELECT ts, type_name, count FROM type_breakdown
                        WHERE warehouse = ? AND ts >= ? ORDER BY ts ASC
                    """, (wh_name, since_ts))
                    type_history = {}
                    for ts, type_name, count in cur_hist.fetchall():
                        if ts not in type_history:
                            type_history[ts] = {}
                        type_history[ts][type_name] = count
                    timestamps = sorted(type_history.keys())
                    type1_data = [{"x": ts * 1000, "y": type_history[ts].get("一票一件", 0)} for ts in timestamps]
                    type2_data = [{"x": ts * 1000, "y": type_history[ts].get("一票一件多个", 0)} for ts in timestamps]

                    warehouses_data.append({
                        "name": wh_name,
                        "count": 0,
                        "peak_count": wh_peak_count,
                        "labeling_speed": None,
                        "type_breakdown": {"一票一件": 0, "一票一件多个": 0},
                        "carrier_breakdown": carrier_breakdown,
                        "type1_history": type1_data,
                        "type2_history": type2_data,
                    })

            # Sort by priority
            priority_str = os.getenv("WMS_WAREHOUSE_PRIORITY", "ONT002,FLT001,RIA001")
            priority_list = [p.strip() for p in priority_str.split(",")]

            def warehouse_priority(wh):
                name = wh["name"]
                for i, priority_code in enumerate(priority_list):
                    if priority_code in name:
                        return (i, name)
                return (len(priority_list), name)

            warehouses_data.sort(key=warehouse_priority)

            # Format last updated time
            pacific = ZoneInfo("America/Los_Angeles")
            last_updated = datetime.fromtimestamp(latest_ts, tz=pacific).strftime("%Y-%m-%d %H:%M:%S PT")

            return jsonify({
                "warehouses": warehouses_data,
                "last_updated": last_updated,
                "time_range": time_range
            })
    finally:
        conn.close()


@wms_bp.route('/current')
@login_required
def wms_current():
    """Return current WMS counts."""
    conn = _get_wms_conn()
    if not conn:
        return jsonify({"ts": None, "warehouses": []})

    try:
        with conn:
            cur = conn.execute("SELECT MAX(ts) FROM counts")
            ts_row = cur.fetchone()
            if not ts_row or not ts_row[0]:
                return jsonify({"ts": None, "warehouses": []})

            ts = ts_row[0]
            cur = conn.execute("SELECT warehouse, count FROM counts WHERE ts = ? ORDER BY warehouse", (ts,))
            warehouses = []
            for wh_name, wh_count in cur.fetchall():
                cur2 = conn.execute("SELECT type_name, count FROM type_breakdown WHERE ts = ? AND warehouse = ?",
                                    (ts, wh_name))
                type_breakdown = {r[0]: r[1] for r in cur2.fetchall()}

                cur3 = conn.execute(
                    "SELECT carrier_name, count FROM carrier_breakdown WHERE ts = ? AND warehouse = ? ORDER BY count DESC",
                    (ts, wh_name))
                carrier_breakdown = {r[0]: r[1] for r in cur3.fetchall()}

                warehouses.append({
                    "name": wh_name,
                    "count": wh_count,
                    "type_breakdown": type_breakdown,
                    "carrier_breakdown": carrier_breakdown
                })

            return jsonify({"ts": ts, "warehouses": warehouses})
    finally:
        conn.close()


@wms_bp.route('/history/<warehouse>')
@login_required
def wms_history(warehouse):
    """Get last 12 hours of data for a specific warehouse."""
    conn = _get_wms_conn()
    if not conn:
        return jsonify([])

    try:
        since = int((datetime.now(timezone.utc) - timedelta(hours=12)).timestamp())
        with conn:
            cur = conn.execute("SELECT ts, count FROM counts WHERE warehouse = ? AND ts >= ? ORDER BY ts ASC",
                               (warehouse, since))
            rows = cur.fetchall()
        return jsonify([{"ts": r[0], "count": r[1]} for r in rows])
    finally:
        conn.close()

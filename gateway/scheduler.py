"""
Unified Background Scheduler
=============================
Manages all periodic / scheduled tasks for the Logistar platform so that
no extra terminals or Windows Task Scheduler entries are needed.

Jobs:
  1. WMS Monitor   — every 10 min, fetches unlabeled-order counts from WMS API
  2. TMS Daily Export — cron at 09:00 (Pacific), exports previous day's TMS records
  3. Turnover Sync — cron at 02:00 (server-local), syncs inventory logs + products

All jobs run in background threads managed by APScheduler.
"""

import os
import sys
import time
import sqlite3
import logging
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from collections import defaultdict

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.events import EVENT_JOB_EXECUTED, EVENT_JOB_ERROR

logger = logging.getLogger("scheduler")

# ── paths ───────────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).parent                       # gateway/
WMS_DIR = BASE_DIR.parent / "services" / "wms-monitor"  # services/wms-monitor/
WMS_DB_PATH = WMS_DIR / "wms_counts.db"
WMS_ENV_PATH = WMS_DIR / ".env"
TURNOVER_BACKEND_PORT = 8001

# ── job history (last N results, visible in admin panel) ────────────────────

_job_history_lock = threading.Lock()
_job_history: dict[str, list[dict]] = {
    "wms_monitor": [],
    "tms_export": [],
    "turnover_sync": [],
}
MAX_HISTORY = 20


def _record_result(job_name: str, success: bool, message: str, duration: float = 0):
    """Append a result record for a job (thread-safe)."""
    with _job_history_lock:
        _job_history.setdefault(job_name, [])
        _job_history[job_name].append({
            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "success": success,
            "message": message,
            "duration_s": round(duration, 1),
        })
        # keep only last N
        if len(_job_history[job_name]) > MAX_HISTORY:
            _job_history[job_name] = _job_history[job_name][-MAX_HISTORY:]


def get_job_history() -> dict:
    """Return a copy of the job history dict (thread-safe)."""
    with _job_history_lock:
        return {k: list(v) for k, v in _job_history.items()}


# ═══════════════════════════════════════════════════════════════════════════
#  JOB 1 — WMS Monitor  (interval: every 10 minutes)
# ═══════════════════════════════════════════════════════════════════════════

def _load_wms_env():
    """Load WMS .env file into os.environ (idempotent)."""
    try:
        if WMS_ENV_PATH.exists():
            with open(WMS_ENV_PATH, "r", encoding="utf-8") as f:
                for line in f:
                    s = line.strip()
                    if not s or s.startswith("#"):
                        continue
                    if "=" in s:
                        k, v = s.split("=", 1)
                        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except Exception as e:
        logger.warning("Failed to load WMS .env: %s", e)


def _normalize_carrier(raw: str) -> str:
    """Inline copy of wms_utils.normalize_carrier to avoid path gymnastics."""
    if not isinstance(raw, str):
        return "UNKNOWN"
    t = raw.upper()
    if "CBT" in t:   return "CBT"
    if "USPS" in t:  return "USPS"
    if "UPS" in t:   return "UPS"
    if "FEDEX" in t or "FED EX" in t: return "FedEx"
    if "GOFO" in t:  return "Gofo"
    if "UNI" in t:   return "Uni"
    if "SPEEDX" in t: return "SpeedX"
    if "SWIFTX" in t or "SWIFIX" in t: return "SwiftX"
    if "YW" in t or "YANWEN" in t: return "YW"
    return raw.strip() or "UNKNOWN"


def _wms_init_db() -> sqlite3.Connection:
    """Ensure WMS tables exist and return a connection."""
    conn = sqlite3.connect(WMS_DB_PATH)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS counts (
          ts INTEGER NOT NULL, warehouse TEXT NOT NULL, count INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS type_breakdown (
          ts INTEGER NOT NULL, warehouse TEXT NOT NULL, type_name TEXT NOT NULL, count INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS carrier_breakdown (
          ts INTEGER NOT NULL, warehouse TEXT NOT NULL, carrier_name TEXT NOT NULL, count INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_counts_ts_warehouse ON counts(ts, warehouse);
        CREATE INDEX IF NOT EXISTS idx_type_ts_warehouse ON type_breakdown(ts, warehouse);
        CREATE INDEX IF NOT EXISTS idx_carrier_ts_warehouse ON carrier_breakdown(ts, warehouse, carrier_name);
    """)
    conn.commit()
    return conn


def _wms_fetch_orders(api_url: str, api_token: str, days_back: int = 4) -> list:
    """Fetch orders from WMS API (all pages)."""
    import requests
    china_tz = timezone(timedelta(hours=8))
    now = datetime.now(china_tz)
    time_from = now - timedelta(days=days_back)
    create_time_from = time_from.strftime("%Y-%m-%d %H:%M:%S")
    create_time_to = now.strftime("%Y-%m-%d %H:%M:%S")

    all_orders = []
    page = 1
    while True:
        payload = {
            "service": "getOrderList",
            "user_token": api_token,
            "createTimeFrom": create_time_from,
            "createTimeTo": create_time_to,
            "page": page,
            "pageSize": 1000,
        }
        resp = requests.post(api_url, json=payload,
                             headers={"Content-Type": "application/json"}, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        if data.get("ask") != "Success":
            raise RuntimeError(f"WMS API error: {data.get('message', 'Unknown')}")
        orders = data.get("data", [])
        total_count = int(data.get("totalCount", 0))
        if not orders:
            break
        all_orders.extend(orders)
        if len(all_orders) >= total_count:
            break
        page += 1
        time.sleep(0.5)
    return all_orders


def _wms_process_orders(orders: list) -> dict:
    """Return {warehouse_display: {count, type_breakdown, carrier_breakdown}}."""
    warehouse_stats: dict = defaultdict(lambda: {
        "count": 0,
        "type_breakdown": {"一票一件": 0, "一票一件多个": 0},
        "carrier_breakdown": defaultdict(int),
    })
    for o in orders:
        if str(o.get("order_status", "")) not in ("5", "6"):
            continue
        wh = o.get("warehouse_code", "UNKNOWN")
        stats = warehouse_stats[wh]
        stats["count"] += 1
        pq = int(o.get("parcel_quantity", 1))
        stats["type_breakdown"]["一票一件多个" if pq > 1 else "一票一件"] += 1
        mp = o.get("mp_code", "")
        if mp:
            stats["carrier_breakdown"][_normalize_carrier(mp)] += 1
    return dict(warehouse_stats)


def _wms_save(conn: sqlite3.Connection, warehouse: str, count: int,
              type_bd: dict, carrier_bd: dict, ts: int):
    """Save a single warehouse snapshot to DB."""
    conn.execute("INSERT INTO counts (ts, warehouse, count) VALUES (?,?,?)",
                 (ts, warehouse, count))
    for tn, tv in (type_bd or {}).items():
        conn.execute("INSERT INTO type_breakdown (ts, warehouse, type_name, count) VALUES (?,?,?,?)",
                     (ts, warehouse, tn, tv))
    for cn, cv in (carrier_bd or {}).items():
        conn.execute("INSERT INTO carrier_breakdown (ts, warehouse, carrier_name, count) VALUES (?,?,?,?)",
                     (ts, warehouse, cn, cv))
    conn.commit()


def _wms_cleanup(conn: sqlite3.Connection, days: int = 30):
    """Remove records older than N days."""
    cutoff = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp())
    conn.execute("DELETE FROM counts WHERE ts < ?", (cutoff,))
    conn.execute("DELETE FROM type_breakdown WHERE ts < ?", (cutoff,))
    conn.execute("DELETE FROM carrier_breakdown WHERE ts < ?", (cutoff,))
    conn.commit()


_wms_last_cleanup = 0


def wms_collect_cycle():
    """One full WMS data-collection cycle (called by scheduler every 10 min)."""
    global _wms_last_cleanup
    t0 = time.time()
    try:
        _load_wms_env()
        api_url = os.environ.get("WMS_API_URL",
                                 "http://hx.wms.yunwms.com/default/svc-for-api/web-service")
        api_token = os.environ.get("WMS_API_TOKEN")
        if not api_token:
            raise ValueError("WMS_API_TOKEN is not configured")

        conn = _wms_init_db()
        try:
            # daily cleanup
            now_ts = time.time()
            if now_ts - _wms_last_cleanup > 86400:
                _wms_cleanup(conn)
                _wms_last_cleanup = now_ts

            orders = _wms_fetch_orders(api_url, api_token)
            stats = _wms_process_orders(orders)
            collection_ts = int(datetime.now(timezone.utc).timestamp())

            saved = 0
            for wh, s in stats.items():
                _wms_save(conn, wh, s["count"],
                          dict(s["type_breakdown"]), dict(s["carrier_breakdown"]),
                          collection_ts)
                saved += 1
                logger.info("WMS %s: %d unlabeled", wh, s["count"])

            dur = time.time() - t0
            msg = f"Collected {len(orders)} orders, {saved} warehouses saved"
            logger.info("WMS cycle done in %.1fs — %s", dur, msg)
            _record_result("wms_monitor", True, msg, dur)
        finally:
            conn.close()
    except Exception as e:
        dur = time.time() - t0
        logger.exception("WMS collect cycle failed")
        _record_result("wms_monitor", False, str(e), dur)


# ═══════════════════════════════════════════════════════════════════════════
#  JOB 2 — TMS Daily Export  (cron: 09:00 Pacific every day)
# ═══════════════════════════════════════════════════════════════════════════

def tms_daily_export():
    """Export previous day's TMS records via Selenium (headless)."""
    t0 = time.time()
    try:
        # Import here to avoid loading Selenium at startup
        from tms_bulk_export import daily_export_previous_day
        inserted = daily_export_previous_day()
        dur = time.time() - t0
        msg = f"Exported {inserted} records"
        logger.info("TMS daily export done in %.1fs — %s", dur, msg)
        _record_result("tms_export", True, msg, dur)
    except Exception as e:
        dur = time.time() - t0
        logger.exception("TMS daily export failed")
        _record_result("tms_export", False, str(e), dur)


# ═══════════════════════════════════════════════════════════════════════════
#  JOB 3 — Turnover Sync  (cron: 02:00 server-local every day)
# ═══════════════════════════════════════════════════════════════════════════

def turnover_daily_sync():
    """Trigger the turnover backend's daily sync via HTTP POST."""
    import requests
    t0 = time.time()
    try:
        resp = requests.post(
            f"http://127.0.0.1:{TURNOVER_BACKEND_PORT}/api/sync/daily",
            timeout=600,  # may take several minutes for large datasets
        )
        resp.raise_for_status()
        data = resp.json()
        dur = time.time() - t0
        msg = data.get("message", f"Synced — logs: {data.get('inventory_logs', '?')}, products: {data.get('products', '?')}")
        logger.info("Turnover sync done in %.1fs — %s", dur, msg)
        _record_result("turnover_sync", True, msg, dur)
    except Exception as e:
        dur = time.time() - t0
        logger.exception("Turnover sync failed")
        _record_result("turnover_sync", False, str(e), dur)


# ═══════════════════════════════════════════════════════════════════════════
#  Scheduler lifecycle
# ═══════════════════════════════════════════════════════════════════════════

_scheduler: BackgroundScheduler | None = None


def start_scheduler():
    """Create and start the APScheduler BackgroundScheduler with all jobs."""
    global _scheduler
    if _scheduler and _scheduler.running:
        logger.info("Scheduler already running")
        return

    _scheduler = BackgroundScheduler(
        daemon=True,
        job_defaults={"coalesce": True, "max_instances": 1},
    )

    # WMS Monitor — every 10 minutes
    _scheduler.add_job(
        wms_collect_cycle,
        "interval",
        minutes=10,
        id="wms_monitor",
        name="WMS Monitor (10-min cycle)",
        next_run_time=datetime.now() + timedelta(seconds=15),  # first run 15s after startup
    )

    # TMS Daily Export — 9:00 AM every day (server local time = Pacific)
    _scheduler.add_job(
        tms_daily_export,
        "cron",
        hour=9,
        minute=0,
        id="tms_export",
        name="TMS Daily Export (9 AM)",
    )

    # Turnover Sync — 2:00 AM every day
    _scheduler.add_job(
        turnover_daily_sync,
        "cron",
        hour=2,
        minute=0,
        id="turnover_sync",
        name="Turnover Sync (2 AM)",
    )

    def _listener(event):
        """Log job execution / error events."""
        job_id = event.job_id
        if event.exception:
            logger.error("Job %s raised: %s", job_id, event.exception)
        else:
            logger.debug("Job %s finished (retval=%s)", job_id, event.retval)

    _scheduler.add_listener(_listener, EVENT_JOB_EXECUTED | EVENT_JOB_ERROR)
    _scheduler.start()
    logger.info("Background scheduler started — jobs: %s",
                [j.id for j in _scheduler.get_jobs()])


def stop_scheduler():
    """Gracefully shut down the scheduler."""
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        logger.info("Background scheduler stopped")
        _scheduler = None


def get_scheduler_status() -> dict:
    """Return scheduler + job status for admin panel."""
    if not _scheduler:
        return {"running": False, "jobs": []}

    jobs = []
    for j in _scheduler.get_jobs():
        next_run = j.next_run_time
        jobs.append({
            "id": j.id,
            "name": j.name,
            "next_run": next_run.strftime("%Y-%m-%d %H:%M:%S") if next_run else None,
            "trigger": str(j.trigger),
        })
    return {
        "running": _scheduler.running,
        "jobs": jobs,
        "history": get_job_history(),
    }


def trigger_job_now(job_id: str) -> bool:
    """Manually trigger a job immediately (returns True if found)."""
    if not _scheduler:
        return False
    job = _scheduler.get_job(job_id)
    if not job:
        return False
    # Run in a thread so we don't block
    if job_id == "wms_monitor":
        threading.Thread(target=wms_collect_cycle, daemon=True).start()
    elif job_id == "tms_export":
        threading.Thread(target=tms_daily_export, daemon=True).start()
    elif job_id == "turnover_sync":
        threading.Thread(target=turnover_daily_sync, daemon=True).start()
    else:
        return False
    return True

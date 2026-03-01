#!/usr/bin/env python3
"""
WMS monitor: logs unpacked count every N minutes using the WMS API.

Config via environment variables:
- WMS_API_URL: API endpoint URL (default: http://hx.wms.yunwms.com/default/svc-for-api/web-service)
- WMS_API_TOKEN: API authentication token
- WMS_INTERVAL_MIN: minutes between checks (default: 10)
- WMS_WAREHOUSE_PRIORITY: comma-separated warehouse codes for ordering (default: ONT002,FLT001,RIA001)

Writes results to SQLite: wms_counts.db (table counts: ts INTEGER, count INTEGER)
Run alongside wms_dashboard.py to view a live dashboard.
"""

import os
import time
import sqlite3
import logging
import requests
from datetime import datetime, timezone, timedelta
from pathlib import Path
from collections import defaultdict

# Import from shared utilities
from wms_utils import normalize_carrier


DB_PATH = Path(__file__).parent / "wms_counts.db"
ENV_PATH = Path(__file__).parent / ".env"
TABLE_SQL = """
CREATE TABLE IF NOT EXISTS counts (
  ts INTEGER NOT NULL,
  warehouse TEXT NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS type_breakdown (
  ts INTEGER NOT NULL,
  warehouse TEXT NOT NULL,
  type_name TEXT NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS carrier_breakdown (
  ts INTEGER NOT NULL,
  warehouse TEXT NOT NULL,
  carrier_name TEXT NOT NULL,
  count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_counts_ts_warehouse ON counts(ts, warehouse);
CREATE INDEX IF NOT EXISTS idx_type_ts_warehouse ON type_breakdown(ts, warehouse);
CREATE INDEX IF NOT EXISTS idx_carrier_ts_warehouse ON carrier_breakdown(ts, warehouse, carrier_name);
"""


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(TABLE_SQL)
    conn.commit()
    return conn


def cleanup_old_records(conn, days=30):
    """Remove records older than specified days to prevent database bloat."""
    cutoff = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp())
    deleted_counts = conn.execute("DELETE FROM counts WHERE ts < ?", (cutoff,)).rowcount
    deleted_type = conn.execute("DELETE FROM type_breakdown WHERE ts < ?", (cutoff,)).rowcount
    deleted_carrier = conn.execute("DELETE FROM carrier_breakdown WHERE ts < ?", (cutoff,)).rowcount
    conn.commit()
    if deleted_counts > 0 or deleted_type > 0 or deleted_carrier > 0:
        logging.info(f"Cleaned up old records: {deleted_counts} counts, {deleted_type} type, {deleted_carrier} carrier")


def save_count(conn, warehouse: str, count: int, type_breakdown: dict = None, carrier_breakdown: dict = None, ts: int = None):
    if ts is None:
        ts = int(datetime.now(timezone.utc).timestamp())
    
    try:
        # Insert main count
        conn.execute("INSERT INTO counts (ts, warehouse, count) VALUES (?, ?, ?)", (ts, warehouse, count))
        logging.debug(f"Saved count for {warehouse}: {count} unlabeled at ts={ts}")
        
        # Save type breakdown
        type_count = 0
        if type_breakdown:
            for type_name, type_count_val in type_breakdown.items():
                conn.execute("INSERT INTO type_breakdown (ts, warehouse, type_name, count) VALUES (?, ?, ?, ?)",
                            (ts, warehouse, type_name, type_count_val))
                type_count += 1
            logging.debug(f"Saved {type_count} type breakdown entries for {warehouse}")
        
        # Save carrier breakdown
        carrier_count = 0
        if carrier_breakdown:
            for carrier_name, carrier_count_val in carrier_breakdown.items():
                conn.execute("INSERT INTO carrier_breakdown (ts, warehouse, carrier_name, count) VALUES (?, ?, ?, ?)",
                            (ts, warehouse, carrier_name, carrier_count_val))
                carrier_count += 1
            logging.debug(f"Saved {carrier_count} carrier breakdown entries for {warehouse}")
        
        conn.commit()
        logging.info(f"[+] DB commit successful for {warehouse} (ts={ts})")
        return True
    except Exception as e:
        logging.error(f"[-] Failed to save data for {warehouse}: {e}")
        conn.rollback()
        return False


def get_env(name, default=None):
    val = os.environ.get(name)
    return val if val else default


_ENV_LOADED = False
def _load_env_file():
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    try:
        if ENV_PATH.exists():
            with open(ENV_PATH, "r", encoding="utf-8") as f:
                for line in f:
                    s = line.strip()
                    if not s or s.startswith("#"):
                        continue
                    if "=" in s:
                        k, v = s.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip('"').strip("'")
                        os.environ.setdefault(k, v)
            logging.info(f"Loaded .env from {ENV_PATH}")
    except Exception as e:
        logging.warning(f"Failed to load .env: {e}")
    finally:
        _ENV_LOADED = True


def validate_config(api_url: str, api_token: str, interval: int):
    """Validate configuration parameters."""
    if not api_token:
        raise ValueError("WMS_API_TOKEN must be set")
    
    if not api_url or not api_url.startswith("http"):
        raise ValueError(f"Invalid WMS_API_URL: {api_url}")
    
    if interval < 1:
        raise ValueError(f"WMS_INTERVAL_MIN must be >= 1, got {interval}")
    
    logging.info("[+] Configuration validated")


def fetch_orders_from_api(api_url: str, api_token: str, days_back: int = 4) -> list:
    """
    Fetch orders from WMS API.
    
    Args:
        api_url: API endpoint URL
        api_token: Authentication token
        days_back: Number of days back to fetch orders from
        
    Returns:
        List of order dictionaries
    """
    # Calculate time range: 4 days ago to now (using GMT+8 China Standard Time)
    china_tz = timezone(timedelta(hours=8))
    now = datetime.now(china_tz)
    time_from = now - timedelta(days=days_back)
    
    # Format timestamps for API (in GMT+8)
    create_time_from = time_from.strftime("%Y-%m-%d %H:%M:%S")
    create_time_to = now.strftime("%Y-%m-%d %H:%M:%S")
    
    all_orders = []
    page = 1
    page_size = 1000  # Fetch 1000 orders per page
    
    logging.info(f"Fetching orders from {create_time_from} to {create_time_to}")
    
    while True:
        try:
            # Prepare request payload
            payload = {
                "service": "getOrderList",
                "user_token": api_token,
                "createTimeFrom": create_time_from,
                "createTimeTo": create_time_to,
                "page": page,
                "pageSize": page_size
            }
            
            # Make API request
            logging.info(f"Fetching page {page}...")
            response = requests.post(
                api_url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=30
            )
            
            # Check response status
            if response.status_code != 200:
                logging.error(f"API request failed with status {response.status_code}: {response.text}")
                raise Exception(f"API returned status {response.status_code}")
            
            # Parse response
            data = response.json()
            
            if data.get("ask") != "Success":
                logging.error(f"API returned error: {data.get('message', 'Unknown error')}")
                raise Exception(f"API error: {data.get('message', 'Unknown error')}")
            
            orders = data.get("data", [])
            total_count = int(data.get("totalCount", 0))
            
            logging.info(f"[+] Page {page}: fetched {len(orders)} orders (total: {total_count})")
            
            if not orders:
                break
            
            all_orders.extend(orders)
            
            # Check if we've fetched all orders
            if len(all_orders) >= total_count:
                break
            
            page += 1
            time.sleep(0.5)  # Small delay between requests to avoid overwhelming the API
            
        except requests.exceptions.Timeout:
            logging.error(f"API request timed out on page {page}")
            raise
        except requests.exceptions.RequestException as e:
            logging.error(f"API request failed on page {page}: {e}")
            raise
        except Exception as e:
            logging.error(f"Failed to fetch orders on page {page}: {e}")
            raise
    
    logging.info(f"[+] Total orders fetched: {len(all_orders)}")
    return all_orders


def process_orders_data(orders: list) -> dict:
    """
    Process orders data and generate statistics by warehouse.
    
    Args:
        orders: List of order dictionaries from API
        
    Returns:
        Dictionary mapping warehouse code to stats
    """
    # Initialize data structures
    warehouse_stats = defaultdict(lambda: {
        "unlabeled_orders": [],
        "count": 0,
        "type_breakdown": {"一票一件": 0, "一票一件多个": 0},
        "carrier_breakdown": defaultdict(int)
    })
    
    # Filter for unlabeled orders (status 5 or 6) and group by warehouse
    for order in orders:
        order_status = str(order.get("order_status", ""))
        
        # Only count unlabeled orders (status 5 or 6)
        if order_status not in ["5", "6"]:
            continue
        
        warehouse_code = order.get("warehouse_code", "UNKNOWN")
        parcel_quantity = int(order.get("parcel_quantity", 1))
        mp_code = order.get("mp_code", "")
        
        stats = warehouse_stats[warehouse_code]
        
        # Increment unlabeled count (both status 5 and 6)
        stats["count"] += 1
        stats["unlabeled_orders"].append(order)
        
        # Type breakdown based on parcel_quantity
        if parcel_quantity > 1:
            stats["type_breakdown"]["一票一件多个"] += 1
        else:
            stats["type_breakdown"]["一票一件"] += 1
        
        # Carrier breakdown (normalize carrier name)
        if mp_code:
            normalized_carrier = normalize_carrier(mp_code)
            stats["carrier_breakdown"][normalized_carrier] += 1
    
    # Convert defaultdict to regular dict for cleaner output
    result = {}
    for warehouse_code, stats in warehouse_stats.items():
        result[warehouse_code] = {
            "count": stats["count"],
            "type_breakdown": dict(stats["type_breakdown"]),
            "carrier_breakdown": dict(stats["carrier_breakdown"])
        }
    
    return result


def get_warehouse_display_name(warehouse_code: str) -> str:
    """
    Convert warehouse code to display name format.
    E.g., "ONT002" -> "ONT002[安大略2仓]"
    """
    # Map of warehouse codes to Chinese names
    warehouse_names = {
        #"ONT002": "ONT002[安大略2仓]",
        #"FLT001": "FLT001[佛罗里达1仓]",
        #"RIA001": "RIA001[里亚尔托1仓]",
    }
    
    return warehouse_names.get(warehouse_code, warehouse_code)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
    _load_env_file()
    
    api_url = get_env("WMS_API_URL", "http://hx.wms.yunwms.com/default/svc-for-api/web-service")
    api_token = get_env("WMS_API_TOKEN")
    interval_min = int(get_env("WMS_INTERVAL_MIN", "10"))
    warehouse_priority = get_env("WMS_WAREHOUSE_PRIORITY", "ONT002,FLT001,RIA001").split(",")
    warehouse_priority = [w.strip() for w in warehouse_priority]

    logging.info(f"Config: API_URL={api_url}, Token={api_token[:8] if api_token else 'None'}***, Interval={interval_min}min")
    logging.info(f"Warehouse priority: {', '.join(warehouse_priority)}")

    # Validate configuration
    try:
        validate_config(api_url, api_token, interval_min)
    except ValueError as e:
        logging.error(f"Configuration error: {e}")
        logging.error("Check your .env file - WMS_API_TOKEN is required")
        return

    logging.info("Initializing database...")
    conn = init_db()
    logging.info("[+] Database initialized")
    
    last_cleanup = 0
    consecutive_failures = 0
    max_retries = 3
    
    try:
        while True:
            operation_start = time.time()
            try:
                # Run cleanup once per day
                current_time = time.time()
                if current_time - last_cleanup > 86400:  # 24 hours
                    cleanup_old_records(conn, days=30)
                    last_cleanup = current_time
                
                logging.info(f"\n{'='*70}")
                logging.info(f"Starting data collection at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
                logging.info(f"{'='*70}")
                
                # Fetch orders from API
                orders = fetch_orders_from_api(api_url, api_token, days_back=4)
                
                # Process orders and generate statistics
                warehouse_stats = process_orders_data(orders)
                
                if not warehouse_stats:
                    logging.warning("No unlabeled orders found in any warehouse")
                
                # Use single timestamp for all warehouses in this collection cycle
                collection_ts = int(datetime.now(timezone.utc).timestamp())
                logging.info(f"Saving data with timestamp: {collection_ts}")
                
                # Sort warehouses by priority
                def get_priority(wh_code):
                    try:
                        return warehouse_priority.index(wh_code)
                    except ValueError:
                        return len(warehouse_priority)
                
                sorted_warehouses = sorted(warehouse_stats.keys(), key=get_priority)
                
                # Save data for each warehouse
                saved_count = 0
                for warehouse_code in sorted_warehouses:
                    stats = warehouse_stats[warehouse_code]
                    warehouse_display = get_warehouse_display_name(warehouse_code)
                    
                    count = stats["count"]
                    type_breakdown = stats["type_breakdown"]
                    carrier_breakdown = stats["carrier_breakdown"]
                    
                    # Calculate labeling speed (orders labeled per hour)
                    labeling_speed = None
                    try:
                        # Get previous unlabeled count from last interval
                        prev_ts = collection_ts - (interval_min * 60)
                        cur = conn.execute(
                            "SELECT count FROM counts WHERE warehouse = ? AND ts >= ? ORDER BY ts DESC LIMIT 1",
                            (warehouse_display, prev_ts - 300)  # Allow 5 min tolerance
                        )
                        prev_row = cur.fetchone()
                        if prev_row:
                            prev_count = prev_row[0]
                            labeled = prev_count - count
                            if labeled > 0:
                                labeling_speed = (labeled / interval_min) * 60  # orders per hour
                    except Exception as e:
                        logging.debug(f"Could not calculate labeling speed: {e}")
                    
                    if save_count(conn, warehouse_display, count, type_breakdown, carrier_breakdown, ts=collection_ts):
                        saved_count += 1
                        speed_info = f" (Speed: {labeling_speed:.1f}/hr)" if labeling_speed else ""
                        logging.info(f"[SUCCESS] {warehouse_display}: {count} unlabeled orders{speed_info}")
                        logging.info(f"   Type: 一票一件={type_breakdown.get('一票一件', 0)}, 一票一件多个={type_breakdown.get('一票一件多个', 0)}")
                        if carrier_breakdown:
                            top_carriers = sorted(carrier_breakdown.items(), key=lambda x: x[1], reverse=True)[:3]
                            logging.info(f"   Top carriers: {', '.join([f'{c}={n}' for c, n in top_carriers])}")
                    else:
                        logging.error(f"[-] Failed to save {warehouse_display} data to database")
                
                # Verify data was saved
                try:
                    cur = conn.execute("SELECT COUNT(DISTINCT warehouse) FROM counts WHERE ts >= ?", 
                                     (int(time.time()) - 60,))  # Last minute
                    recent_warehouses = cur.fetchone()[0]
                    logging.info(f"Verification: {recent_warehouses} warehouses in DB from last minute")
                except Exception as e:
                    logging.warning(f"Could not verify DB save: {e}")
                
                operation_duration = time.time() - operation_start
                logging.info(f"\n[+] Collection cycle completed in {operation_duration:.1f}s")
                logging.info(f"Total warehouses processed: {len(warehouse_stats)}, saved: {saved_count}")
                
                consecutive_failures = 0  # Reset on success
                    
            except Exception as e:
                consecutive_failures += 1
                logging.exception(f"Monitor iteration failed (attempt {consecutive_failures}/{max_retries}): {e}")
                
                # Exponential backoff for retries
                if consecutive_failures >= max_retries:
                    wait_time = min(300, 30 * (2 ** (consecutive_failures - max_retries)))  # Cap at 5 min
                    logging.warning(f"Multiple failures detected, waiting {wait_time}s before retry")
                    time.sleep(wait_time)
            
            # Wait for next interval
            logging.info(f"Waiting {interval_min} minutes until next collection...")
            time.sleep(interval_min * 60)
            
    except KeyboardInterrupt:
        logging.info("\nShutdown requested by user")
    finally:
        conn.close()
        logging.info("[+] Database connection closed")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Test script for WMS API service: getReceivingListForYB
Uses same URL and token as wms_monitor.py (from environment or .env file).
Prints raw API response for inspection.
"""

import os
import requests
from datetime import datetime
from pathlib import Path
import json
import pandas as pd

# Load .env if present
ENV_PATH = Path(__file__).parent / ".env"
def _load_env_file():
    if ENV_PATH.exists():
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if not s or s.startswith("#"): continue
                if "=" in s:
                    k, v = s.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    os.environ.setdefault(k, v)
_load_env_file()

# Get API URL and token from env or defaults
api_url = os.environ.get("WMS_API_URL", "http://hx.wms.yunwms.com/default/svc-for-api/web-service")
api_token = os.environ.get("WMS_API_TOKEN", "85bfab50-5aa4-9eaa-d031-ac54d53d6701")

payload = {
    "service": "getReceivingListForYB",
    "user_token": api_token,
    #"order_code": "RVCQ-220208-0004",
    #"order_code_arr": ["RVCQ-220208-0003", "RVCQ-221107-0006", "RVCQ-221107-0005"],
    "createTimeFrom": "2026-01-02 00:00:00",
    "createTimeTo": "2026-01-03 00:00:00",
    #"dateShelvesFrom": "2021-02-22 00:00:00",
    #"dateShelvesTo": "2022-11-22 00:00:00",
    "page": 1,
    "pageSize": 25
}


def post_and_print(payload, api_url=api_url):
    print(f"POST {api_url}\nPayload:")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    try:
        response = requests.post(
            api_url,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        print(f"\nStatus: {response.status_code}")
        print("Response:")
        try:
            print(json.dumps(response.json(), ensure_ascii=False, indent=2))
        except Exception:
            print(response.text)
    except Exception as e:
        print(f"Request failed: {e}")


def test_max_page_size(api_url, api_token):
    """Test different pageSizes to find the maximum allowed."""
    print("\n=== Testing Maximum Page Size ===")
    test_sizes = [100, 500, 1000, 2000, 5000]
    max_working = 100
    
    for size in test_sizes:
        print(f"Testing pageSize={size}...", end=" ", flush=True)
        try:
            response = requests.post(
                api_url,
                json={
                    "service": "getProductInventory",
                    "user_token": api_token,
                    "pageSize": size,
                    "page": 1
                },
                headers={"Content-Type": "application/json"},
                timeout=30
            )
            data = response.json()
            if data.get("ask") == "Success" and len(data.get("data", [])) > 0:
                max_working = size
                print(f"✓ Works (returned {len(data['data'])} records)")
            else:
                print(f"✗ Failed: {data.get('message', 'Unknown error')}")
                break
        except Exception as e:
            print(f"✗ Error: {e}")
            break
    
    print(f"\n→ Using pageSize={max_working}")
    return max_working


def fetch_all_inventory_filtered(api_url, api_token, customer_code_filter, warehouse_code_filter, page_size=10000):
    """Fetch all inventory records and filter by customer and warehouse code."""
    print(f"\n=== Fetching All Inventory (Filter: customer_code='{customer_code_filter}', warehouse_code='{warehouse_code_filter}') ===")

    filtered_results = []
    page = 1
    total_records_fetched = 0
    start_time = datetime.now()

    while True:
        try:
            response = requests.post(
                api_url,
                json={
                    "service": "getProductInventory",
                    "user_token": api_token,
                    "pageSize": page_size,
                    "page": page
                },
                headers={"Content-Type": "application/json"},
                timeout=30
            )

            if response.status_code != 200:
                print(f"\n✗ HTTP Error {response.status_code} on page {page}")
                break

            data = response.json()
            if data.get("ask") != "Success":
                print(f"\n✗ API Error: {data.get('message', 'Unknown')}")
                break

            records = data.get("data", [])
            total_count = int(data.get("totalCount", 0))

            if not records:
                print(f"\n→ No more records on page {page}")
                break

            # Filter records by both customer_code and warehouse_code
            filtered = [r for r in records if r.get("customer_code") == customer_code_filter and r.get("warehouse_code") == warehouse_code_filter]
            filtered_results.extend(filtered)
            total_records_fetched += len(records)

            # Progress update
            elapsed = (datetime.now() - start_time).total_seconds()
            estimated_pages = (total_count + page_size - 1) // page_size
            progress_pct = (total_records_fetched / total_count * 100) if total_count > 0 else 0

            print(f"Page {page}/{estimated_pages} | "
                  f"Fetched: {total_records_fetched:,}/{total_count:,} ({progress_pct:.1f}%) | "
                  f"Found {len(filtered_results)} records | "
                  f"Elapsed: {elapsed:.1f}s", flush=True)

            # Check if we've fetched everything
            if total_records_fetched >= total_count:
                break

            page += 1

        except Exception as e:
            print(f"\n✗ Error on page {page}: {e}")
            break

    elapsed_total = (datetime.now() - start_time).total_seconds()
    print(f"\n✓ Complete! Fetched {total_records_fetched:,} total records in {elapsed_total:.1f}s")
    print(f"✓ Found {len(filtered_results)} records for customer '{customer_code_filter}' and warehouse '{warehouse_code_filter}'")

    return filtered_results


if __name__ == "__main__":
    # Set filters and page size
    customer_filter = "SZPSJ"
    warehouse_filter = "ONT002"
    page_size = 100000

    # Fetch and filter inventory
    results = fetch_all_inventory_filtered(api_url, api_token, customer_filter, warehouse_filter, page_size=page_size)

    # Save to file
    if results:
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        output_json = f"inventory_{customer_filter}_{warehouse_filter}_{timestamp}.json"
        output_excel = f"inventory_{customer_filter}_{warehouse_filter}_{timestamp}.xlsx"

        # Save JSON
        with open(output_json, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"\n✓ Saved {len(results)} records to {output_json}")

        # Save Excel
        df = pd.DataFrame(results)
        df.to_excel(output_excel, index=False, sheet_name=f"{customer_filter}_{warehouse_filter}")
        print(f"✓ Saved {len(results)} records to {output_excel}")

        # Show sample
        print(f"\n--- First 3 records ---")
        for i, record in enumerate(results[:3], 1):
            print(f"{i}. {record.get('product_barcode')} - "
                  f"Available: {record.get('available_inventory_cnt')}, "
                  f"Hold: {record.get('hold_inventory_cnt')}, "
                  f"Warehouse: {record.get('warehouse_code')}")
    else:
        print(f"\n⚠ No records found for customer '{customer_filter}' and warehouse '{warehouse_filter}'")

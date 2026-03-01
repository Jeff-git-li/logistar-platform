"""
TMS Database Manager
Handles storage and retrieval of TMS records in SQLite database.

Schema v2: All fields are proper columns — no raw_data JSON blob.
"""
import sqlite3
import logging
from typing import List, Dict, Optional
from datetime import datetime, timedelta, date
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'tms_data.db')


def _safe_float(v):
    """Safely convert a value to float."""
    if v is None or v == '' or v == 'None':
        return 0.0
    try:
        return float(v)
    except (ValueError, TypeError):
        return 0.0


def _safe_str(v):
    """Safely convert a value to string."""
    if v is None:
        return ''
    return str(v).strip()


def init_database():
    """
    Initialize SQLite database with optimized TMS records table (v2 schema).
    All fields stored as proper columns — no raw_data JSON blob.
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS tms_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tracking_number TEXT NOT NULL UNIQUE,
            tms_order_number TEXT,
            master_tracking_number TEXT,
            customer_order_number TEXT,
            transfer_number TEXT,
            customer_name TEXT,
            product_name TEXT,
            order_status TEXT,
            tracking_status TEXT,
            settlement_status TEXT,
            
            api_cost REAL DEFAULT 0,
            charged_amount REAL DEFAULT 0,
            order_amount REAL DEFAULT 0,
            profit REAL DEFAULT 0,
            
            weight_kg REAL DEFAULT 0,
            cargo_weight_kg REAL DEFAULT 0,
            box_count INTEGER DEFAULT 1,
            
            address_type TEXT DEFAULT '',
            remote_type TEXT DEFAULT '',
            
            ship_to_zip TEXT DEFAULT '',
            ship_to_state TEXT DEFAULT '',
            ship_to_city TEXT DEFAULT '',
            ship_from_zip TEXT DEFAULT '',
            ship_from_state TEXT DEFAULT '',
            
            carrier_name TEXT DEFAULT '',
            original_carrier_name TEXT DEFAULT '',
            channel_name TEXT DEFAULT '',
            channel_code TEXT DEFAULT '',
            
            signature_service TEXT DEFAULT '',
            
            pay_freight REAL DEFAULT 0,
            pay_fuel REAL DEFAULT 0,
            pay_residential REAL DEFAULT 0,
            pay_residential_addr REAL DEFAULT 0,
            pay_das REAL DEFAULT 0,
            pay_das_remote REAL DEFAULT 0,
            pay_das_remote_extreme REAL DEFAULT 0,
            pay_ahs REAL DEFAULT 0,
            pay_oversize REAL DEFAULT 0,
            pay_peak REAL DEFAULT 0,
            pay_peak_oversize REAL DEFAULT 0,
            pay_peak_residential REAL DEFAULT 0,
            pay_remote REAL DEFAULT 0,
            pay_extreme_remote REAL DEFAULT 0,
            pay_signature REAL DEFAULT 0,
            pay_address_change REAL DEFAULT 0,
            pay_other REAL DEFAULT 0,
            
            recv_freight REAL DEFAULT 0,
            recv_fuel REAL DEFAULT 0,
            recv_residential REAL DEFAULT 0,
            recv_das REAL DEFAULT 0,
            recv_ahs REAL DEFAULT 0,
            recv_other REAL DEFAULT 0,
            
            tms_created_at TIMESTAMP,
            charge_time TIMESTAMP,
            
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_tracking ON tms_records(tracking_number)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_product ON tms_records(product_name)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_tms_date ON tms_records(tms_created_at)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_customer ON tms_records(customer_name)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_status ON tms_records(order_status)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_product_date ON tms_records(product_name, tms_created_at)')
    
    conn.commit()
    conn.close()
    logging.info(f"[DB] Database initialized: {DB_PATH}")


def insert_records(records: List[Dict]) -> int:
    """
    Insert TMS records into database (v2 schema — proper columns, no raw_data).
    Called by the daily scraper with dicts whose keys are TMS column names
    (after header disambiguation).
    Returns number of records inserted.
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    inserted = 0
    for record in records:
        try:
            tracking = record.get('tracking_number', '')
            if not tracking:
                continue

            # Parse tms_created_at
            tms_created_at = None
            created_str = _safe_str(record.get('创建时间', ''))
            if created_str:
                try:
                    tms_created_at = datetime.strptime(created_str, '%Y-%m-%d %H:%M:%S')
                except:
                    try:
                        tms_created_at = datetime.strptime(created_str[:19], '%Y-%m-%dT%H:%M:%S')
                    except:
                        pass

            charge_time = None
            charge_str = _safe_str(record.get('扣款时间', ''))
            if charge_str:
                try:
                    charge_time = datetime.strptime(charge_str, '%Y-%m-%d %H:%M:%S')
                except:
                    pass

            def _r(key):
                return _safe_str(record.get(key, ''))
            def _rf(key):
                return _safe_float(record.get(key, 0))

            weight = _rf('计费重')
            cargo_weight = _rf('货物重量')

            cursor.execute('''
                INSERT OR REPLACE INTO tms_records (
                    tracking_number, tms_order_number, master_tracking_number, customer_order_number, transfer_number,
                    customer_name, product_name, order_status, tracking_status, settlement_status,
                    api_cost, charged_amount, order_amount, profit,
                    weight_kg, cargo_weight_kg, box_count,
                    address_type, remote_type,
                    ship_to_zip, ship_to_state, ship_to_city,
                    ship_from_zip, ship_from_state,
                    carrier_name, original_carrier_name, channel_name, channel_code,
                    signature_service,
                    pay_freight, pay_fuel, pay_residential, pay_residential_addr,
                    pay_das, pay_das_remote, pay_das_remote_extreme,
                    pay_ahs, pay_oversize,
                    pay_peak, pay_peak_oversize, pay_peak_residential,
                    pay_remote, pay_extreme_remote,
                    pay_signature, pay_address_change, pay_other,
                    recv_freight, recv_fuel, recv_residential, recv_das, recv_ahs, recv_other,
                    tms_created_at, charge_time
                ) VALUES (
                    ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
                    ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
                )
            ''', (
                tracking,
                _r('运单号'),
                record.get('master_tracking_number', _r('服务商单号')),
                _r('客户单号'),
                _r('转单号'),
                record.get('customer_name', _r('商户名称')),
                _r('产品名称'),
                _r('订单状态'),
                _r('轨迹状态'),
                _r('结算状态'),
                record.get('api_cost', _rf('应付金额')),
                record.get('charged_amount', _rf('扣款金额')),
                _rf('订单金额'),
                _rf('利润'),
                record.get('weight_kg', weight),
                cargo_weight,
                int(_safe_float(_r('箱子数量')) or 1),
                _r('地址类型'),
                _r('偏远类型'),
                _r('收件人_邮编'),
                _r('收件人_省、州'),
                _r('收件人_城市'),
                _r('发件人_邮编'),
                _r('发件人_省、州'),
                _r('服务商名称'),
                _r('原服务商名称'),
                _r('渠道名称'),
                _r('渠道代码'),
                _r('签名服务'),
                # Payable surcharges
                _rf('应付运费'),
                _rf('应付燃油附加费'),
                _rf('应付住宅附加费'),
                _rf('应付住宅地址费'),
                _rf('应付DAS'),
                _rf('应付DAS Remote'),
                _rf('应付DAS Remote 荒远地区'),
                _rf('应付AHS'),
                _rf('应付oversize附加费'),
                _rf('应付旺季附加费'),
                _rf('应付超长旺季附加费'),
                _rf('应付住宅地址旺季附加费'),
                _rf('应付偏远费') + _rf('应付非常偏远费') + _rf('应付超偏远费'),
                _rf('应付商业地址极度偏远费') + _rf('应付住宅地址极度偏远费'),
                _rf('应付签名签收'),
                _rf('应付更改地址费'),
                _rf('应付其他'),
                # Receivable surcharges
                _rf('应收运费'),
                _rf('应收燃油附加费'),
                _rf('应收住宅附加费') + _rf('应收住宅地址费'),
                _rf('应收DAS') + _rf('应收DAS Remote'),
                _rf('应收AHS'),
                _rf('应收其他'),
                tms_created_at,
                charge_time,
            ))
            inserted += 1
        except Exception as e:
            logging.error(f"Failed to insert record {record.get('tracking_number')}: {e}")
    
    conn.commit()
    conn.close()
    logging.info(f"✓ Inserted {inserted} records into database")
    return inserted


def get_tms_orders_by_day_fedex(start_date=None, end_date=None, customer=None):
    """
    Get TMS orders by day for FedEx trackings only (filtered by product name),
    grouped by date and customer for line chart display.
    Returns: [{'date': 'YYYY-MM-DD', 'customer_name': 'CustomerA', 'count': 10}, ...]
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    query = """
        SELECT DATE(tms_created_at) as date, customer_name, COUNT(*) as count 
        FROM tms_records 
        WHERE product_name IN ('fedex-home美西', 'FEDEX-HOME-NJ-美东')
        AND tms_created_at IS NOT NULL
    """
    params = []
    
    if start_date:
        query += " AND DATE(tms_created_at) >= ?"
        params.append(start_date)
    if end_date:
        query += " AND DATE(tms_created_at) <= ?"
        params.append(end_date)
    if customer and customer != 'all':
        query += " AND customer_name = ?"
        params.append(customer)
    
    query += " GROUP BY DATE(tms_created_at), customer_name ORDER BY date"
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    
    result = [
        {'date': row[0], 'customer_name': row[1] or 'Unknown', 'count': row[2]}
        for row in rows
    ]
    
    return result


def get_tms_customers_fedex():
    """
    Get unique customer names from TMS data for FedEx trackings only.
    Returns: List of customer names sorted alphabetically.
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    query = """
        SELECT DISTINCT customer_name 
        FROM tms_records 
        WHERE product_name IN ('fedex-home美西', 'FEDEX-HOME-NJ-美东')
        AND customer_name IS NOT NULL
        AND customer_name != ''
        ORDER BY customer_name
    """
    
    cursor.execute(query)
    rows = cursor.fetchall()
    conn.close()
    
    return [row[0] for row in rows]


def get_records_by_tracking_numbers(tracking_numbers: List[str], include_raw: bool = False) -> List[Dict]:
    """
    Retrieve TMS records by tracking numbers.
    
    Args:
        tracking_numbers: List of tracking numbers to query
        include_raw: Kept for backward compatibility. When True, includes extra fields.
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    placeholders = ','.join('?' * len(tracking_numbers))
    
    query = f'''
        SELECT tracking_number, master_tracking_number, customer_name, 
               api_cost, charged_amount, weight_kg, product_name, created_at
        FROM tms_records
        WHERE tracking_number IN ({placeholders})
    '''
    
    cursor.execute(query, tracking_numbers)
    rows = cursor.fetchall()
    
    results = []
    for row in rows:
        record = {
            'tracking_number': row[0],
            'master_tracking_number': row[1],
            'customer_name': row[2],
            'api_cost': row[3],
            'charged_amount': row[4],
            'weight_kg': row[5],
            'product_name': row[6],
            'created_at': row[7],
        }
        results.append(record)
    
    conn.close()
    return results


def get_all_records(limit: Optional[int] = None) -> List[Dict]:
    """
    Retrieve all TMS records
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    query = '''
        SELECT tracking_number, customer_name, api_cost, charged_amount, weight_kg, created_at
        FROM tms_records
        ORDER BY created_at DESC
    '''
    
    if limit:
        query += f' LIMIT {limit}'
    
    cursor.execute(query)
    rows = cursor.fetchall()
    
    results = []
    for row in rows:
        results.append({
            'tracking_number': row[0],
            'customer_name': row[1],
            'api_cost': row[2],
            'charged_amount': row[3],
            'weight_kg': row[4],
            'created_at': row[5]
        })
    
    conn.close()
    return results


def get_database_stats() -> Dict:
    """
    Get statistics about the database
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute('SELECT COUNT(*) FROM tms_records')
    total_records = cursor.fetchone()[0]
    
    cursor.execute('SELECT COUNT(DISTINCT tracking_number) FROM tms_records')
    unique_tracking = cursor.fetchone()[0]
    
    cursor.execute('SELECT MIN(tms_created_at), MAX(tms_created_at) FROM tms_records')
    date_range = cursor.fetchone()
    
    cursor.execute('SELECT COUNT(DISTINCT product_name) FROM tms_records')
    product_count = cursor.fetchone()[0]
    
    conn.close()
    
    return {
        'total_records': total_records,
        'unique_tracking_numbers': unique_tracking,
        'product_count': product_count,
        'earliest_record': date_range[0],
        'latest_record': date_range[1]
    }


# ===============================
# Supplier (Non-FedEx) TMS Functions
# ===============================

# Product names that belong to Logistar's own FedEx accounts (自营FedEx)
SELF_OPERATED_FEDEX = ('fedex-home美西', 'FEDEX-HOME-NJ-美东', 'FEDEX-HOME-TX')

def get_tms_supplier_product_names():
    """
    Get unique product names from TMS data that are NOT 自营FedEx.
    Returns: List of product names sorted by record count desc.
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    placeholders = ','.join('?' * len(SELF_OPERATED_FEDEX))
    query = f"""
        SELECT product_name, COUNT(*) as cnt
        FROM tms_records 
        WHERE product_name NOT IN ({placeholders})
        AND product_name IS NOT NULL
        AND product_name != ''
        GROUP BY product_name
        ORDER BY cnt DESC
    """
    
    cursor.execute(query, SELF_OPERATED_FEDEX)
    rows = cursor.fetchall()
    conn.close()
    
    return [row[0] for row in rows]


def get_tms_orders_by_day_supplier(start_date=None, end_date=None, product_name=None):
    """
    Get TMS orders by day for non-FedEx (supplier) products,
    grouped by date and product_name for line chart display.
    Returns: [{'date': 'YYYY-MM-DD', 'product_name': 'FEDEX-SP-美西', 'count': 10}, ...]
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    placeholders = ','.join('?' * len(SELF_OPERATED_FEDEX))
    query = f"""
        SELECT DATE(tms_created_at) as date, product_name, COUNT(*) as count 
        FROM tms_records 
        WHERE product_name NOT IN ({placeholders})
        AND product_name IS NOT NULL AND product_name != ''
        AND tms_created_at IS NOT NULL
    """
    params = list(SELF_OPERATED_FEDEX)
    
    if start_date:
        query += " AND DATE(tms_created_at) >= ?"
        params.append(start_date)
    if end_date:
        query += " AND DATE(tms_created_at) <= ?"
        params.append(end_date)
    if product_name and product_name != 'all':
        query += " AND product_name = ?"
        params.append(product_name)
    
    query += " GROUP BY DATE(tms_created_at), product_name ORDER BY date"
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    
    return [
        {'date': row[0], 'product_name': row[1] or 'Unknown', 'count': row[2]}
        for row in rows
    ]


def get_tms_supplier_records_for_verification(start_date=None, end_date=None, product_name=None, limit=5000):
    """
    Get TMS records for supplier cost verification.
    Reads zip codes, address metadata, and surcharge breakdown directly from columns (v2 schema).
    Returns list of dicts with relevant fields.
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    query = """
        SELECT tracking_number, customer_name, api_cost, charged_amount, weight_kg, 
               product_name, tms_created_at,
               ship_to_zip, ship_from_zip, address_type, remote_type,
               pay_freight, pay_fuel, pay_residential, pay_residential_addr,
               pay_das, pay_das_remote, pay_das_remote_extreme,
               pay_ahs, pay_signature, pay_oversize,
               pay_peak, pay_peak_oversize, pay_peak_residential,
               pay_remote, pay_extreme_remote,
               pay_address_change, pay_other,
               cargo_weight_kg
        FROM tms_records 
        WHERE 1=1
    """
    params = []
    
    if product_name:
        query += " AND product_name = ?"
        params.append(product_name)
    if start_date:
        query += " AND DATE(tms_created_at) >= ?"
        params.append(start_date)
    if end_date:
        query += " AND DATE(tms_created_at) <= ?"
        params.append(end_date)
    
    query += f" ORDER BY tms_created_at DESC LIMIT {limit}"
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    
    results = []
    for row in rows:
        tms_surcharges = {
            'freight':       row[11] or 0,
            'fuel':          row[12] or 0,
            'residential':   (row[13] or 0) + (row[14] or 0),
            'das':           row[15] or 0,
            'das_remote':    (row[16] or 0) + (row[17] or 0),
            'ahs':           row[18] or 0,
            'signature':     row[19] or 0,
            'oversize':      row[20] or 0,
            'peak':          (row[21] or 0) + (row[22] or 0) + (row[23] or 0),
            'remote':        row[24] or 0,
            'extreme_remote': row[25] or 0,
            'address_change': row[26] or 0,
            'other':         row[27] or 0,
        }
        
        results.append({
            'tracking_number': row[0],
            'customer_name': row[1],
            'api_cost': row[2] or 0,
            'charged_amount': row[3] or 0,
            'weight_kg': row[4] or 0,
            'product_name': row[5],
            'tms_created_at': row[6],
            'ship_to_zip': row[7] or '',
            'ship_from_zip': row[8] or '',
            'address_type': row[9] or '',
            'remote_type': row[10] or '',
            'tms_surcharges': tms_surcharges,
            'cargo_weight_kg': row[28] or 0,
        })
    
    return results
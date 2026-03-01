"""FedEx Shipment Database Manager

Handles storage and retrieval of FedEx invoice analysis results.
Optimized for bulk operations with 10k+ shipment records.
"""
import sqlite3
from typing import List, Dict, Optional, Any


def init_fedex_db(db_path: str) -> None:
    """Initialize FedEx shipments database with schema and indices.
    
    Args:
        db_path: Path to SQLite database file
    """
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        
        # Create main table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS fedex_shipments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tracking_number TEXT UNIQUE,
            invoice_number TEXT,
            ship_date TEXT,
            customer_name TEXT,
            zone TEXT,
            weight REAL,
            service_type TEXT,
            actual_charge REAL,
            expected_charge REAL,
            adjustment REAL,
            surcharge_breakdown TEXT,
            surcharges_total REAL,
            verification_status TEXT,
            upload_timestamp TEXT,
            analysis_result TEXT
        )
        ''')
        
        # Create indices for common query patterns
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_ship_date ON fedex_shipments(ship_date)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_customer ON fedex_shipments(customer_name)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_tracking ON fedex_shipments(tracking_number)')
        
        conn.commit()


def _extract_shipment_tuple(shipment: Dict[str, Any]) -> tuple:
    """Extract shipment data into tuple for SQL insertion.
    
    Args:
        shipment: Dictionary containing shipment data
        
    Returns:
        Tuple of shipment values in database column order
    """
    return (
        shipment['tracking_number'],
        shipment.get('invoice_number'),
        shipment.get('ship_date'),
        shipment.get('customer_name'),
        shipment.get('zone'),
        shipment.get('weight'),
        shipment.get('service_type'),
        shipment.get('actual_charge'),
        shipment.get('expected_charge'),
        shipment.get('adjustment'),
        shipment.get('surcharge_breakdown'),
        shipment.get('surcharges_total'),
        shipment.get('verification_status'),
        shipment.get('upload_timestamp'),
        shipment.get('analysis_result')
    )


def _execute_upsert(cursor, data: List[tuple]) -> None:
    """Execute upsert SQL statement with data.
    
    Args:
        cursor: SQLite cursor object
        data: List of tuples containing shipment data
    """
    cursor.executemany('''
        INSERT INTO fedex_shipments (
            tracking_number, invoice_number, ship_date, customer_name, zone, weight, service_type,
            actual_charge, expected_charge, adjustment, surcharge_breakdown, surcharges_total,
            verification_status, upload_timestamp, analysis_result
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tracking_number) DO UPDATE SET
            invoice_number=excluded.invoice_number,
            ship_date=excluded.ship_date,
            customer_name=excluded.customer_name,
            zone=excluded.zone,
            weight=excluded.weight,
            service_type=excluded.service_type,
            actual_charge=excluded.actual_charge,
            expected_charge=excluded.expected_charge,
            adjustment=excluded.adjustment,
            surcharge_breakdown=excluded.surcharge_breakdown,
            surcharges_total=excluded.surcharges_total,
            verification_status=excluded.verification_status,
            upload_timestamp=excluded.upload_timestamp,
            analysis_result=excluded.analysis_result
    ''', data)


def upsert_fedex_shipment(db_path: str, shipment: Dict[str, Any]) -> None:
    """Insert or update a single shipment record.
    
    For bulk operations with 10k+ records, use bulk_upsert_fedex_shipments() instead.
    
    Args:
        db_path: Path to SQLite database file
        shipment: Dictionary containing shipment data
    """
    with sqlite3.connect(db_path) as conn:
        _execute_upsert(conn.cursor(), [_extract_shipment_tuple(shipment)])
        conn.commit()


def bulk_upsert_fedex_shipments(db_path: str, shipments: List[Dict[str, Any]]) -> int:
    """Bulk insert/update shipments using a single database transaction.
    
    10x-100x faster than individual upserts for large datasets (10k+ rows).
    
    Args:
        db_path: Path to SQLite database file
        shipments: List of shipment dictionaries
    
    Returns:
        Number of shipments processed
    """
    if not shipments:
        return 0
    
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        data = [_extract_shipment_tuple(s) for s in shipments]
        _execute_upsert(cursor, data)
        conn.commit()
        return len(shipments)


def _build_filter_params(customer: Optional[str], start_date: Optional[str], end_date: Optional[str]) -> tuple:
    """Build WHERE clause parameters for dashboard queries.
    
    Args:
        customer: Optional customer name filter
        start_date: Optional start date filter (YYYY-MM-DD)
        end_date: Optional end date filter (YYYY-MM-DD)
    
    Returns:
        Tuple of (where_clause, params_list)
    """
    conditions = []
    params = []
    
    if customer and customer != 'all':
        conditions.append("customer_name = ?")
        params.append(customer)
    if start_date:
        conditions.append("ship_date >= ?")
        params.append(start_date)
    if end_date:
        conditions.append("ship_date <= ?")
        params.append(end_date)
    
    where_clause = " AND ".join(conditions) if conditions else "1=1"
    return where_clause, params


def _execute_grouped_query(db_path: str, group_by: str, customer: Optional[str] = None, 
                          start_date: Optional[str] = None, end_date: Optional[str] = None) -> List[Dict[str, Any]]:
    """Execute grouped count query with filters.
    
    Args:
        db_path: Path to database
        group_by: Column name to group by
        customer: Optional customer filter
        start_date: Optional start date filter
        end_date: Optional end date filter
        
    Returns:
        List of dictionaries with group_by column and count
    """
    where_clause, params = _build_filter_params(customer, start_date, end_date)
    query = f"SELECT {group_by}, COUNT(*) FROM fedex_shipments WHERE {where_clause} GROUP BY {group_by} ORDER BY {group_by}"
    
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(query, params)
        data = cursor.fetchall()
    
    return [{group_by: row[0], 'count': row[1]} for row in data]


def get_dashboard_customers(db_path: str) -> List[str]:
    """Get list of all customers in database.
    
    Args:
        db_path: Path to SQLite database file
        
    Returns:
        Sorted list of customer names
    """
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT customer_name FROM fedex_shipments ORDER BY customer_name")
        return [row[0] for row in cursor.fetchall() if row[0]]


def get_dashboard_orders_by_day(db_path: str, customer: Optional[str] = None, 
                               start_date: Optional[str] = None, end_date: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get order counts grouped by ship date.
    
    Args:
        db_path: Path to SQLite database file
        customer: Optional customer filter
        start_date: Optional start date filter
        end_date: Optional end date filter
        
    Returns:
        List of {ship_date, count} dictionaries
    """
    return _execute_grouped_query(db_path, 'ship_date', customer, start_date, end_date)


def get_dashboard_orders_by_weight(db_path: str, customer: Optional[str] = None,
                                  start_date: Optional[str] = None, end_date: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get order counts grouped by weight.
    
    Args:
        db_path: Path to SQLite database file
        customer: Optional customer filter
        start_date: Optional start date filter
        end_date: Optional end date filter
        
    Returns:
        List of {weight, count} dictionaries
    """
    return _execute_grouped_query(db_path, 'weight', customer, start_date, end_date)


def get_dashboard_orders_by_zone(db_path: str, customer: Optional[str] = None,
                                start_date: Optional[str] = None, end_date: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get order counts grouped by zone.
    
    Args:
        db_path: Path to SQLite database file
        customer: Optional customer filter
        start_date: Optional start date filter
        end_date: Optional end date filter
        
    Returns:
        List of {zone, count} dictionaries
    """
    return _execute_grouped_query(db_path, 'zone', customer, start_date, end_date)


def get_dashboard_surcharge_stats(db_path: str, customer: Optional[str] = None,
                                  start_date: Optional[str] = None, end_date: Optional[str] = None) -> List[Dict[str, Any]]:
    """Aggregate surcharge statistics across shipments.
    
    Args:
        db_path: Path to SQLite database file
        customer: Optional customer filter
        start_date: Optional start date filter (YYYY-MM-DD)
        end_date: Optional end date filter (YYYY-MM-DD)
        
    Returns:
        List of surcharge types with count and total amount
    """
    import json
    
    where_clause, params = _build_filter_params(customer, start_date, end_date)
    query = f"SELECT surcharge_breakdown FROM fedex_shipments WHERE {where_clause}"
    
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(query, params)
        rows = cursor.fetchall()
    
    # Aggregate by surcharge type, combining all fuel surcharges
    stats = {}
    for (breakdown_json,) in rows:
        if not breakdown_json:
            continue
        try:
            breakdown = json.loads(breakdown_json)
            for item in breakdown:
                surcharge_type = item.get('type')
                amount = item.get('actual', 0)
                
                if surcharge_type and surcharge_type.lower() != 'base rate':
                    # Normalize fuel surcharge names
                    key = 'Fuel Surcharge' if 'fuel surcharge' in surcharge_type.lower() else surcharge_type
                    
                    if key not in stats:
                        stats[key] = {'count': 0, 'amount': 0}
                    
                    stats[key]['count'] += 1
                    stats[key]['amount'] += amount
        except Exception:
            continue
    
    return [{'type': k, 'count': v['count'], 'amount': v['amount']} for k, v in stats.items()]


def get_dashboard_adjustment_stats(db_path: str, customer: Optional[str] = None,
                                  start_date: Optional[str] = None, end_date: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get adjustment totals grouped by customer.
    
    Args:
        db_path: Path to SQLite database file
        customer: Optional customer filter
        start_date: Optional start date filter (YYYY-MM-DD)
        end_date: Optional end date filter (YYYY-MM-DD)
        
    Returns:
        List of customers with total adjustment amounts (negated for display)
    """
    where_clause, params = _build_filter_params(customer, start_date, end_date)
    query = f"SELECT customer_name, -SUM(adjustment) as total FROM fedex_shipments WHERE {where_clause} GROUP BY customer_name ORDER BY customer_name"
    
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(query, params)
        rows = cursor.fetchall()
    
    return [{'customer': row[0] or 'Unknown', 'total': row[1] or 0} for row in rows]

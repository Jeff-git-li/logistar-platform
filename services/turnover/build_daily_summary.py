"""
Build the invlog_daily_summary table from raw inventory_logs + products.
This pre-aggregates 6M+ rows into ~3-5K summary rows for fast analytics.
Can be re-run safely (drops and rebuilds the summary).
"""
import sqlite3
import time

DB_PATH = "turnover.db"

def build_summary():
    conn = sqlite3.connect(DB_PATH, timeout=120)
    c = conn.cursor()

    # Create the table if it doesn't exist
    c.execute("""
        CREATE TABLE IF NOT EXISTS invlog_daily_summary (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            summary_date DATE NOT NULL,
            warehouse_id VARCHAR(20) NOT NULL,
            direction VARCHAR(10) NOT NULL,
            customer_code VARCHAR(50) NOT NULL,
            event_count INTEGER DEFAULT 0,
            total_qty INTEGER DEFAULT 0,
            total_volume_cbm REAL DEFAULT 0,
            unique_skus INTEGER DEFAULT 0
        )
    """)

    # Clear existing data
    print("Clearing existing summary...")
    c.execute("DELETE FROM invlog_daily_summary")
    conn.commit()

    # Build the summary with a single INSERT ... SELECT
    print("Building daily summary from inventory_logs + products JOIN...")
    t0 = time.time()

    c.execute("""
        INSERT INTO invlog_daily_summary
            (summary_date, warehouse_id, direction, customer_code,
             event_count, total_qty, total_volume_cbm, unique_skus)
        SELECT
            DATE(il.warehouse_operation_time) AS summary_date,
            il.warehouse_id,
            il.direction,
            COALESCE(il.customer_code, 'UNKNOWN') AS customer_code,
            COUNT(il.id) AS event_count,
            SUM(il.quantity) AS total_qty,
            SUM(il.quantity * COALESCE(p.volume_cbm, 0)) AS total_volume_cbm,
            COUNT(DISTINCT il.product_barcode) AS unique_skus
        FROM inventory_logs il
        LEFT JOIN products p ON il.product_barcode = p.product_barcode
        WHERE il.direction IN ('inbound', 'outbound')
          AND il.warehouse_operation_time IS NOT NULL
        GROUP BY
            DATE(il.warehouse_operation_time),
            il.warehouse_id,
            il.direction,
            COALESCE(il.customer_code, 'UNKNOWN')
    """)

    elapsed = time.time() - t0
    row_count = c.execute("SELECT COUNT(*) FROM invlog_daily_summary").fetchone()[0]
    print(f"  Inserted {row_count:,} summary rows in {elapsed:.1f}s")

    conn.commit()

    # Create indexes
    print("Creating indexes on summary table...")
    indexes = [
        "CREATE INDEX IF NOT EXISTS ix_daily_date_dir ON invlog_daily_summary (summary_date, direction)",
        "CREATE INDEX IF NOT EXISTS ix_daily_wh_dir_date ON invlog_daily_summary (warehouse_id, direction, summary_date)",
        "CREATE INDEX IF NOT EXISTS ix_daily_dir_date ON invlog_daily_summary (direction, summary_date)",
        "CREATE INDEX IF NOT EXISTS ix_daily_cust_dir_date ON invlog_daily_summary (customer_code, direction, summary_date)",
    ]
    for idx in indexes:
        c.execute(idx)
    conn.commit()

    # Run ANALYZE on the new table
    print("Running ANALYZE on summary table...")
    c.execute("ANALYZE invlog_daily_summary")
    conn.commit()

    # Show stats
    date_range = c.execute(
        "SELECT MIN(summary_date), MAX(summary_date) FROM invlog_daily_summary"
    ).fetchone()
    total_vol = c.execute(
        "SELECT SUM(total_volume_cbm) FROM invlog_daily_summary WHERE direction='outbound'"
    ).fetchone()[0]
    print(f"\nSummary spans: {date_range[0]} to {date_range[1]}")
    print(f"Total outbound volume: {total_vol:,.2f} CBM")
    print(f"Total summary rows: {row_count:,}")

    conn.close()
    print("Done!")


if __name__ == "__main__":
    build_summary()

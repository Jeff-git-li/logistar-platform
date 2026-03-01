"""Create composite indexes on inventory_logs for better query performance."""
import sqlite3
import time

conn = sqlite3.connect("turnover.db", timeout=60)
c = conn.cursor()

# Check existing indexes
existing = [r[1] for r in c.execute("PRAGMA index_list(inventory_logs)").fetchall()]
print(f"Existing indexes: {len(existing)}")
for idx in existing:
    print(f"  - {idx}")

# Create composite indexes
indexes = [
    "CREATE INDEX IF NOT EXISTS ix_invlog_dir_optime ON inventory_logs (direction, warehouse_operation_time)",
    "CREATE INDEX IF NOT EXISTS ix_invlog_dir_wh_optime ON inventory_logs (direction, warehouse_id, warehouse_operation_time)",
    "CREATE INDEX IF NOT EXISTS ix_invlog_wh_dir_optime ON inventory_logs (warehouse_id, direction, warehouse_operation_time)",
    "CREATE INDEX IF NOT EXISTS ix_invlog_dir_cust_optime ON inventory_logs (direction, customer_code, warehouse_operation_time)",
    "CREATE INDEX IF NOT EXISTS ix_invlog_barcode_dir ON inventory_logs (product_barcode, direction)",
]

for idx_sql in indexes:
    name = idx_sql.split("IF NOT EXISTS ")[1].split(" ON")[0]
    print(f"Creating {name}...")
    t0 = time.time()
    c.execute(idx_sql)
    elapsed = time.time() - t0
    print(f"  Done in {elapsed:.1f}s")

conn.commit()

# Enable WAL mode
print("Setting WAL mode...")
c.execute("PRAGMA journal_mode=WAL")
mode = c.fetchone()[0]
print(f"  Journal mode: {mode}")

# Run ANALYZE
print("Running ANALYZE...")
t0 = time.time()
c.execute("ANALYZE")
elapsed = time.time() - t0
print(f"  ANALYZE done in {elapsed:.1f}s")

conn.commit()

# Verify
new_indexes = [r[1] for r in c.execute("PRAGMA index_list(inventory_logs)").fetchall()]
print(f"\nTotal indexes on inventory_logs: {len(new_indexes)}")
for idx in new_indexes:
    print(f"  - {idx}")

conn.close()
print("\nAll done!")

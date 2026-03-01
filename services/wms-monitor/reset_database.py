import sqlite3
from pathlib import Path

# Delete old database
db_path = Path(__file__).parent / "wms_counts.db"
if db_path.exists():
    db_path.unlink()
    print(f"✓ Deleted old database: {db_path}")
else:
    print(f"No database found at: {db_path}")

print("\nRun wms_monitor.py to create new database with warehouse support!")

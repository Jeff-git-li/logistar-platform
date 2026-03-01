"""
Data Sync Service — syncs WMS API data into local SQLite database.
"""
import logging
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as sa_func
from sqlalchemy.dialects.sqlite import insert as sqlite_upsert

from models import Product, InventoryLog, SyncLog, InvlogDailySummary
from services.wms_client import wms_client
from config import settings

logger = logging.getLogger(__name__)

# Operation types for direction classification
INBOUND_OPS = set(settings.INBOUND_OPERATION_TYPES)
OUTBOUND_OPS = set(settings.OUTBOUND_OPERATION_TYPES)


def _parse_dt(val: str) -> datetime | None:
    """Parse a datetime string from WMS. Returns None for invalid values."""
    if not val or val.startswith("0000"):
        return None
    try:
        return datetime.strptime(val, "%Y-%m-%d %H:%M:%S")
    except (ValueError, TypeError):
        return None


def _safe_float(val) -> float | None:
    try:
        return float(val) if val else None
    except (ValueError, TypeError):
        return None


def _safe_int(val) -> int | None:
    try:
        return int(val) if val else None
    except (ValueError, TypeError):
        return None


def _calc_volume_cbm(length_cm, width_cm, height_cm) -> float | None:
    """Calculate volume in cubic meters from cm dimensions."""
    l, w, h = _safe_float(length_cm), _safe_float(width_cm), _safe_float(height_cm)
    if l and w and h:
        return round((l * w * h) / 1_000_000, 6)
    return None


class SyncService:
    """Handles syncing data from WMS APIs into the local database."""

    async def sync_products(self, db: AsyncSession) -> int:
        """Sync product master data from WMS API."""
        log = SyncLog(sync_type="product", status="running")
        db.add(log)
        await db.commit()

        try:
            raw_products = await wms_client.get_all_products()
            logger.info(f"Fetched {len(raw_products)} products from WMS, upserting to DB...")

            count = 0
            BATCH = 500
            for i in range(0, len(raw_products), BATCH):
                batch = raw_products[i:i + BATCH]
                for raw in batch:
                    volume_cbm = _calc_volume_cbm(
                        raw.get("product_length"),
                        raw.get("product_width"),
                        raw.get("product_height"),
                    )
                    values = dict(
                        product_barcode=raw.get("product_barcode", ""),
                        reference_no=raw.get("reference_no"),
                        customer_code=raw.get("customer_code"),
                        product_length=_safe_float(raw.get("product_length")),
                        product_width=_safe_float(raw.get("product_width")),
                        product_height=_safe_float(raw.get("product_height")),
                        product_weight=_safe_float(raw.get("product_weight")),
                        product_declared_value=_safe_float(raw.get("product_declared_value")),
                        size_unit=raw.get("size_unit"),
                        weight_unit=raw.get("weight_unit"),
                        volume_cbm=volume_cbm,
                        synced_at=datetime.now(),
                    )
                    stmt = sqlite_upsert(Product).values(**values)
                    stmt = stmt.on_conflict_do_update(
                        index_elements=[Product.product_barcode],
                        set_={k: v for k, v in values.items() if k != "product_barcode"},
                    )
                    await db.execute(stmt)
                    count += 1
                await db.commit()
                logger.info(f"Products: upserted {count}/{len(raw_products)}")

            log.status = "success"
            log.records_synced = count
            log.finished_at = datetime.now()
            await db.commit()
            logger.info(f"Synced {count} products")
            return count

        except Exception as e:
            log.status = "failed"
            log.error_message = str(e)
            log.finished_at = datetime.now()
            await db.commit()
            logger.error(f"Product sync failed: {e}")
            raise

    # ─────────────────────────────────────────────────────────────────────
    # Inventory Log Sync (primary data source)
    # ─────────────────────────────────────────────────────────────────────
    def _classify_direction(self, operation_type: str) -> str:
        """Classify an operation_type into inbound/outbound/other."""
        if operation_type in INBOUND_OPS:
            return "inbound"
        if operation_type in OUTBOUND_OPS:
            return "outbound"
        return "other"

    async def sync_inventory_logs(
        self,
        db: AsyncSession,
        start_time: datetime,
        end_time: datetime,
        warehouse_id: int | None = None,
        customer_code: str | None = None,
    ) -> int:
        """
        Sync inventory logs from WMS inventoryLog API.
        start_time/end_time are in China Standard Time (UTC+8) as the API expects.
        """
        log = SyncLog(sync_type="inventory_log", status="running")
        db.add(log)
        await db.commit()

        try:
            raw_logs = await wms_client.get_inventory_logs_chunked(
                start_time=start_time,
                end_time=end_time,
                warehouse_id=warehouse_id,
                customer_code=customer_code,
            )
            logger.info(f"Fetched {len(raw_logs)} inventory logs, upserting to DB...")

            count = 0
            BATCH = 1000
            for i in range(0, len(raw_logs), BATCH):
                batch = raw_logs[i:i + BATCH]
                for raw in batch:
                    op_type = raw.get("operation_type", "")
                    direction = self._classify_direction(op_type)

                    values = dict(
                        ref_no=raw.get("ref_no", ""),
                        reference_no=raw.get("reference_no"),
                        product_barcode=raw.get("product_barcode", ""),
                        warehouse_id=str(raw.get("warehouse_id", "")),
                        quantity=_safe_int(raw.get("quantity")),
                        receiving_code=raw.get("receiving_code"),
                        ibl_add_time=_parse_dt(raw.get("ibl_add_time", "")),
                        ibl_note=raw.get("ibl_note"),
                        customer_code=raw.get("customer_code"),
                        tracking_number=raw.get("tracking_number"),
                        warehouse_operation_time=_parse_dt(raw.get("warehouse_operation_time", "")),
                        operation_type=op_type,
                        inventory_type=_safe_int(raw.get("inventory_type")),
                        inventory_type_name=raw.get("inventory_type_name"),
                        inventory_status=_safe_int(raw.get("inventory_status")),
                        user_name=raw.get("user_name"),
                        direction=direction,
                    )

                    stmt = sqlite_upsert(InventoryLog).values(**values)
                    stmt = stmt.on_conflict_do_update(
                        index_elements=[
                            InventoryLog.ref_no,
                            InventoryLog.product_barcode,
                            InventoryLog.ibl_add_time,
                        ],
                        set_={k: v for k, v in values.items()
                              if k not in ("ref_no", "product_barcode", "ibl_add_time")},
                    )
                    await db.execute(stmt)
                    count += 1

                await db.commit()
                logger.info(f"InventoryLog: upserted {count}/{len(raw_logs)}")

            log.status = "success"
            log.records_synced = count
            log.finished_at = datetime.now()
            await db.commit()
            logger.info(f"Synced {count} inventory logs")

            # Rebuild daily summary table for fast analytics
            await self.rebuild_daily_summary(db)

            return count

        except Exception as e:
            log.status = "failed"
            log.error_message = str(e)
            log.finished_at = datetime.now()
            await db.commit()
            logger.error(f"InventoryLog sync failed: {e}")
            raise

    async def rebuild_daily_summary(self, db: AsyncSession):
        """
        Rebuild the invlog_daily_summary table from raw inventory_logs + products.
        Uses raw SQL for the aggregation INSERT ... SELECT for speed.
        """
        from sqlalchemy import text as sa_text
        logger.info("Rebuilding daily summary table...")
        t0 = datetime.now()

        # Clear existing
        await db.execute(sa_text("DELETE FROM invlog_daily_summary"))
        await db.commit()

        # Rebuild via INSERT ... SELECT (same logic as build_daily_summary.py)
        await db.execute(sa_text("""
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
        """))
        await db.commit()

        # Clear analytics cache so new data is reflected
        from services.analytics import _cache
        _cache.clear()

        elapsed = (datetime.now() - t0).total_seconds()
        logger.info(f"Daily summary rebuilt in {elapsed:.1f}s")

    async def daily_sync(self, db: AsyncSession) -> dict:
        """
        Daily incremental sync: fetch last 7 days of inventory logs
        (with overlap to catch late-arriving records).
        Also in China Standard Time for the API.
        """
        now_cst = datetime.utcnow() + timedelta(hours=8)  # approximate CST
        start = now_cst - timedelta(days=7)
        end = now_cst

        log_count = await self.sync_inventory_logs(db, start_time=start, end_time=end)
        prod_count = await self.sync_products(db)

        return {
            "inventory_logs": log_count,
            "products": prod_count,
        }


sync_service = SyncService()

"""
Analytics Service — calculates turnover KPIs from inventory log data.
Uses InvlogDailySummary (pre-aggregated) for fast queries on dashboard, volume,
turnover, customer, and warehouse endpoints.
Uses raw InventoryLog + Product JOIN only for SKU-level analysis.
Includes in-memory caching with TTL for performance on large datasets.
"""
import hashlib
import json
import logging
import time
from datetime import datetime
from typing import Optional

from sqlalchemy import func, case, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, outerjoin

from models import Product, InventoryLog, WarehouseCapacity, InvlogDailySummary
from config import settings

logger = logging.getLogger(__name__)

# ── In-memory cache with TTL ──────────────────────────────────────────────
CACHE_TTL_SECONDS = 300  # 5-minute cache
_cache: dict[str, tuple[float, any]] = {}  # key → (expiry_ts, value)

def _cache_key(prefix: str, **kwargs) -> str:
    raw = json.dumps({prefix: kwargs}, sort_keys=True, default=str)
    return hashlib.md5(raw.encode()).hexdigest()

def _cache_get(key: str):
    entry = _cache.get(key)
    if entry and entry[0] > time.time():
        return entry[1]
    if entry:
        del _cache[key]
    return None

def _cache_set(key: str, value, ttl: int = CACHE_TTL_SECONDS):
    _cache[key] = (time.time() + ttl, value)
    if len(_cache) > 500:
        now = time.time()
        expired = [k for k, v in _cache.items() if v[0] <= now]
        for k in expired:
            del _cache[k]

# Direction constants
DIR_INBOUND = "inbound"
DIR_OUTBOUND = "outbound"

# Alias for the summary table
S = InvlogDailySummary

# ── Helper: build a base query that joins InventoryLog → Product for CBM ──
# (only used for SKU-level analysis)

def _invlog_product_join():
    return outerjoin(
        InventoryLog, Product,
        InventoryLog.product_barcode == Product.product_barcode,
    )

_vol_cbm_expr = InventoryLog.quantity * func.coalesce(Product.volume_cbm, 0)


class AnalyticsService:
    """Computes warehouse turnover analytics & KPIs."""

    # ── Summary-table filter helper ──
    def _summary_filter(
        self,
        q,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        warehouse_id: Optional[str] = None,
        customer_code: Optional[str] = None,
        direction: Optional[str] = None,
    ):
        """Apply common filters to an InvlogDailySummary query."""
        if date_from:
            q = q.where(S.summary_date >= date_from.date() if isinstance(date_from, datetime) else S.summary_date >= date_from)
        if date_to:
            q = q.where(S.summary_date <= date_to.date() if isinstance(date_to, datetime) else S.summary_date <= date_to)
        if warehouse_id:
            q = q.where(S.warehouse_id == str(warehouse_id))
        if customer_code:
            q = q.where(S.customer_code == customer_code)
        if direction:
            q = q.where(S.direction == direction)
        return q

    # ── Raw InventoryLog filter (for SKU analysis only) ──
    def _invlog_base_filter(self, q, date_from=None, date_to=None,
                            warehouse_id=None, customer_code=None, direction=None):
        if date_from:
            q = q.where(InventoryLog.warehouse_operation_time >= date_from)
        if date_to:
            q = q.where(InventoryLog.warehouse_operation_time <= date_to)
        if warehouse_id:
            q = q.where(InventoryLog.warehouse_id == str(warehouse_id))
        if customer_code:
            q = q.where(InventoryLog.customer_code == customer_code)
        if direction:
            q = q.where(InventoryLog.direction == direction)
        return q

    # ─────────────────────────────────────────────────────────────────────────
    # 8. Inventory-Log Volume Over Time  (FROM SUMMARY TABLE)
    # ─────────────────────────────────────────────────────────────────────────
    async def invlog_volume(
        self,
        db: AsyncSession,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        granularity: str = "day",
        warehouse_id: Optional[str] = None,
        customer_code: Optional[str] = None,
    ) -> dict:
        """Inbound vs outbound CBM volume over time from daily summary table."""
        ck = _cache_key("volume", df=date_from, dt=date_to, g=granularity, wh=warehouse_id, cc=customer_code)
        cached = _cache_get(ck)
        if cached is not None:
            return cached

        results = {}
        for dir_label in (DIR_INBOUND, DIR_OUTBOUND):
            # Determine grouping expression
            if granularity == "month":
                period_expr = func.strftime("%Y-%m", S.summary_date).label("period")
            elif granularity == "week":
                period_expr = func.strftime("%Y-%W", S.summary_date).label("period")
            else:
                period_expr = S.summary_date.label("period")

            q = select(
                period_expr,
                func.sum(S.event_count).label("event_count"),
                func.sum(S.total_qty).label("total_qty"),
                func.sum(S.total_volume_cbm).label("total_volume_cbm"),
                func.sum(S.unique_skus).label("unique_skus"),
            )
            q = self._summary_filter(q, date_from, date_to, warehouse_id, customer_code, direction=dir_label)
            q = q.group_by(text("period")).order_by(text("period"))

            rows = (await db.execute(q)).all()
            results[dir_label] = [
                {
                    "period": str(r.period),
                    "event_count": r.event_count or 0,
                    "total_qty": r.total_qty or 0,
                    "total_volume_cbm": round(r.total_volume_cbm or 0, 4),
                    "unique_skus": r.unique_skus or 0,
                }
                for r in rows
            ]

        _cache_set(ck, results)
        return results

    # ─────────────────────────────────────────────────────────────────────────
    # 9. Inventory Turnover  (FROM SUMMARY TABLE)
    # ─────────────────────────────────────────────────────────────────────────
    async def invlog_turnover(
        self,
        db: AsyncSession,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        warehouse_id: Optional[str] = None,
        customer_code: Optional[str] = None,
    ) -> dict:
        """
        Turnover rate based on CBM volume from daily summary table.
        Turnover = Total Outbound Volume / Average Inventory Volume.
        Uses CASE expressions on the pre-aggregated table for speed.
        """
        ck = _cache_key("turnover", df=date_from, dt=date_to, wh=warehouse_id, cc=customer_code)
        cached = _cache_get(ck)
        if cached is not None:
            return cached

        # Date boundaries for CASE
        d_from = date_from.date() if isinstance(date_from, datetime) else date_from
        d_to = date_to.date() if isinstance(date_to, datetime) else date_to

        in_period = (S.summary_date >= d_from) if d_from else True
        pre_period = (S.summary_date < d_from) if d_from else False

        q = select(
            # Period inbound
            func.coalesce(func.sum(case(
                (S.direction == DIR_INBOUND, case((in_period, S.total_qty), else_=0)),
                else_=0,
            )), 0).label("in_qty"),
            func.coalesce(func.sum(case(
                (S.direction == DIR_INBOUND, case((in_period, S.total_volume_cbm), else_=0)),
                else_=0,
            )), 0).label("in_vol"),
            # Period outbound
            func.coalesce(func.sum(case(
                (S.direction == DIR_OUTBOUND, case((in_period, S.total_qty), else_=0)),
                else_=0,
            )), 0).label("out_qty"),
            func.coalesce(func.sum(case(
                (S.direction == DIR_OUTBOUND, case((in_period, S.total_volume_cbm), else_=0)),
                else_=0,
            )), 0).label("out_vol"),
            # Pre-period inventory
            func.coalesce(func.sum(case(
                (S.direction == DIR_INBOUND, case((pre_period, S.total_volume_cbm), else_=0)),
                else_=0,
            )), 0).label("pre_in_vol"),
            func.coalesce(func.sum(case(
                (S.direction == DIR_OUTBOUND, case((pre_period, S.total_volume_cbm), else_=0)),
                else_=0,
            )), 0).label("pre_out_vol"),
        ).where(S.direction.in_([DIR_INBOUND, DIR_OUTBOUND]))

        # Apply ceiling + dimension filters (date_from handled by CASE)
        if d_to:
            q = q.where(S.summary_date <= d_to)
        if warehouse_id:
            q = q.where(S.warehouse_id == str(warehouse_id))
        if customer_code:
            q = q.where(S.customer_code == customer_code)

        row = (await db.execute(q)).one()

        total_inbound_qty = row.in_qty
        total_inbound_vol = float(row.in_vol)
        total_outbound_qty = row.out_qty
        total_outbound_vol = float(row.out_vol)
        beginning_inv_vol = float(row.pre_in_vol) - float(row.pre_out_vol)

        ending_inv_vol = beginning_inv_vol + total_inbound_vol - total_outbound_vol
        avg_inventory_vol = max((beginning_inv_vol + ending_inv_vol) / 2, 0.001)
        turnover_rate = total_outbound_vol / avg_inventory_vol if avg_inventory_vol > 0 else 0

        result = {
            "total_inbound_qty": total_inbound_qty,
            "total_outbound_qty": total_outbound_qty,
            "total_inbound_vol": round(total_inbound_vol, 4),
            "total_outbound_vol": round(total_outbound_vol, 4),
            "beginning_inventory_vol": round(beginning_inv_vol, 4),
            "ending_inventory_vol": round(ending_inv_vol, 4),
            "average_inventory_vol": round(avg_inventory_vol, 4),
            "turnover_rate": round(turnover_rate, 4),
            "days_in_period": (date_to - date_from).days if date_from and date_to else None,
        }

        _cache_set(ck, result)
        return result

    # ─────────────────────────────────────────────────────────────────────────
    # 10. Customer Breakdown  (FROM SUMMARY TABLE)
    # ─────────────────────────────────────────────────────────────────────────
    async def invlog_customer_breakdown(
        self,
        db: AsyncSession,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        warehouse_id: Optional[str] = None,
    ) -> list[dict]:
        """Per-customer inbound/outbound from daily summary table."""
        ck = _cache_key("customers", df=date_from, dt=date_to, wh=warehouse_id)
        cached = _cache_get(ck)
        if cached is not None:
            return cached

        q = select(
            S.customer_code,
            S.direction,
            func.sum(S.event_count).label("events"),
            func.sum(S.total_qty).label("qty"),
            func.sum(S.total_volume_cbm).label("vol"),
            func.sum(S.unique_skus).label("skus"),
        )
        q = self._summary_filter(q, date_from, date_to, warehouse_id)
        q = q.where(S.direction.in_([DIR_INBOUND, DIR_OUTBOUND]))
        q = q.group_by(S.customer_code, S.direction)

        rows = (await db.execute(q)).all()

        results = {}
        for r in rows:
            cust = r.customer_code or "UNKNOWN"
            if cust not in results:
                results[cust] = {
                    "customer_code": cust,
                    "inbound_events": 0, "inbound_qty": 0, "inbound_vol": 0, "inbound_skus": 0,
                    "outbound_events": 0, "outbound_qty": 0, "outbound_vol": 0, "outbound_skus": 0,
                }
            d = r.direction
            results[cust][f"{d}_events"] = r.events or 0
            results[cust][f"{d}_qty"] = r.qty or 0
            results[cust][f"{d}_vol"] = round(r.vol or 0, 4)
            results[cust][f"{d}_skus"] = r.skus or 0

        sorted_result = sorted(results.values(), key=lambda x: x["outbound_vol"], reverse=True)
        _cache_set(ck, sorted_result)
        return sorted_result

    # ─────────────────────────────────────────────────────────────────────────
    # 11. SKU-level Movement Analysis  (STAYS ON RAW TABLE — needs per-SKU)
    # ─────────────────────────────────────────────────────────────────────────
    async def invlog_sku_analysis(
        self,
        db: AsyncSession,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        warehouse_id: Optional[str] = None,
        customer_code: Optional[str] = None,
        sort_by: str = "outbound_qty",
        limit: int = 100,
    ) -> list[dict]:
        """Per-SKU inbound/outbound qty and CBM volume analysis (raw table)."""
        ck = _cache_key("skus", df=date_from, dt=date_to, wh=warehouse_id, cc=customer_code, sb=sort_by, lm=limit)
        cached = _cache_get(ck)
        if cached is not None:
            return cached

        q = (
            select(
                InventoryLog.product_barcode,
                InventoryLog.customer_code,
                func.sum(
                    case((InventoryLog.direction == DIR_INBOUND, InventoryLog.quantity), else_=0)
                ).label("inbound_qty"),
                func.sum(
                    case((InventoryLog.direction == DIR_OUTBOUND, InventoryLog.quantity), else_=0)
                ).label("outbound_qty"),
                func.sum(
                    case((InventoryLog.direction == DIR_INBOUND, _vol_cbm_expr), else_=0)
                ).label("inbound_vol"),
                func.sum(
                    case((InventoryLog.direction == DIR_OUTBOUND, _vol_cbm_expr), else_=0)
                ).label("outbound_vol"),
                func.count(InventoryLog.id).label("total_events"),
                Product.volume_cbm.label("unit_cbm"),
            )
            .select_from(_invlog_product_join())
        )
        q = self._invlog_base_filter(q, date_from, date_to, warehouse_id, customer_code)
        q = q.where(InventoryLog.direction.in_([DIR_INBOUND, DIR_OUTBOUND]))
        q = q.group_by(InventoryLog.product_barcode, InventoryLog.customer_code)

        if sort_by == "inbound_qty":
            q = q.order_by(text("inbound_vol DESC"))
        else:
            q = q.order_by(text("outbound_vol DESC"))
        q = q.limit(limit)

        rows = (await db.execute(q)).all()

        result = [
            {
                "product_barcode": r.product_barcode,
                "customer_code": r.customer_code,
                "inbound_qty": r.inbound_qty or 0,
                "outbound_qty": r.outbound_qty or 0,
                "inbound_vol": round(r.inbound_vol or 0, 4),
                "outbound_vol": round(r.outbound_vol or 0, 4),
                "net_change_vol": round((r.inbound_vol or 0) - (r.outbound_vol or 0), 4),
                "total_events": r.total_events,
                "unit_cbm": round(r.unit_cbm or 0, 6),
            }
            for r in rows
        ]
        _cache_set(ck, result)
        return result

    # ─────────────────────────────────────────────────────────────────────────
    # 12. Dashboard Summary  (FROM SUMMARY TABLE)
    # ─────────────────────────────────────────────────────────────────────────
    async def invlog_dashboard_summary(
        self,
        db: AsyncSession,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        warehouse_id: Optional[str] = None,
    ) -> dict:
        """High-level dashboard stats from daily summary table."""
        ck = _cache_key("dashboard", df=date_from, dt=date_to, wh=warehouse_id)
        cached = _cache_get(ck)
        if cached is not None:
            return cached

        # Single query: all aggregates by direction using CASE
        q = select(
            func.sum(case((S.direction == DIR_OUTBOUND, S.event_count), else_=0)).label("out_events"),
            func.sum(case((S.direction == DIR_OUTBOUND, S.total_qty), else_=0)).label("out_qty"),
            func.sum(case((S.direction == DIR_OUTBOUND, S.total_volume_cbm), else_=0)).label("out_vol"),
            func.sum(case((S.direction == DIR_OUTBOUND, S.unique_skus), else_=0)).label("out_skus"),
            func.sum(case((S.direction == DIR_INBOUND, S.event_count), else_=0)).label("in_events"),
            func.sum(case((S.direction == DIR_INBOUND, S.total_qty), else_=0)).label("in_qty"),
            func.sum(case((S.direction == DIR_INBOUND, S.total_volume_cbm), else_=0)).label("in_vol"),
            func.sum(case((S.direction == DIR_INBOUND, S.unique_skus), else_=0)).label("in_skus"),
            func.count(func.distinct(S.customer_code)).label("unique_customers"),
            func.count(func.distinct(S.warehouse_id)).label("active_warehouses"),
        )
        q = self._summary_filter(q, date_from, date_to, warehouse_id)
        q = q.where(S.direction.in_([DIR_INBOUND, DIR_OUTBOUND]))

        row = (await db.execute(q)).one()

        # Total products (still from Product table — fast, small table)
        prod_count = (await db.execute(select(func.count(Product.id)))).scalar() or 0

        result = {
            "outbound": {
                "total_events": row.out_events or 0,
                "total_qty": row.out_qty or 0,
                "total_vol": round(row.out_vol or 0, 2),
                "unique_skus": row.out_skus or 0,
            },
            "inbound": {
                "total_events": row.in_events or 0,
                "total_qty": row.in_qty or 0,
                "total_vol": round(row.in_vol or 0, 2),
                "unique_skus": row.in_skus or 0,
            },
            "unique_customers": row.unique_customers or 0,
            "active_skus": 0,  # not tracked in summary; use unique_skus from outbound+inbound
            "total_products": prod_count,
            "active_warehouses": row.active_warehouses or 0,
        }
        _cache_set(ck, result)
        return result

    # ─────────────────────────────────────────────────────────────────────────
    # 13. Warehouse Comparison  (FROM SUMMARY TABLE)
    # ─────────────────────────────────────────────────────────────────────────
    async def invlog_warehouse_comparison(
        self,
        db: AsyncSession,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        customer_code: Optional[str] = None,
    ) -> list[dict]:
        """Per-warehouse inbound/outbound comparison from daily summary table."""
        ck = _cache_key("warehouses", df=date_from, dt=date_to, cc=customer_code)
        cached = _cache_get(ck)
        if cached is not None:
            return cached

        warehouse_map = settings.WAREHOUSE_MAP

        q = select(
            S.warehouse_id,
            S.direction,
            func.sum(S.event_count).label("events"),
            func.sum(S.total_qty).label("qty"),
            func.sum(S.total_volume_cbm).label("vol"),
            func.sum(S.unique_skus).label("skus"),
            func.count(func.distinct(S.customer_code)).label("customers"),
        )
        q = self._summary_filter(q, date_from, date_to, customer_code=customer_code)
        q = q.where(S.direction.in_([DIR_INBOUND, DIR_OUTBOUND]))
        q = q.group_by(S.warehouse_id, S.direction)

        rows = (await db.execute(q)).all()

        # Load capacities
        cap_rows = (await db.execute(select(WarehouseCapacity))).scalars().all()
        cap_map = {str(c.warehouse_id): c.total_capacity_cbm or 0 for c in cap_rows}

        warehouses = {}
        for r in rows:
            wid = str(r.warehouse_id)
            if wid not in warehouses:
                info = warehouse_map.get(wid, {})
                warehouses[wid] = {
                    "warehouse_id": wid,
                    "warehouse_name": info.get("name", f"Warehouse {wid}"),
                    "timezone": info.get("timezone", "Unknown"),
                    "inbound_events": 0, "inbound_qty": 0, "inbound_vol": 0,
                    "outbound_events": 0, "outbound_qty": 0, "outbound_vol": 0,
                    "unique_skus": 0, "unique_customers": 0,
                    "total_capacity_cbm": cap_map.get(wid, 0),
                }
            d = r.direction
            warehouses[wid][f"{d}_events"] = r.events or 0
            warehouses[wid][f"{d}_qty"] = r.qty or 0
            warehouses[wid][f"{d}_vol"] = round(r.vol or 0, 2)
            warehouses[wid]["unique_skus"] = max(warehouses[wid]["unique_skus"], r.skus or 0)
            warehouses[wid]["unique_customers"] = max(warehouses[wid]["unique_customers"], r.customers or 0)

        sorted_result = sorted(warehouses.values(), key=lambda x: x["outbound_vol"], reverse=True)
        _cache_set(ck, sorted_result)
        return sorted_result


analytics_service = AnalyticsService()

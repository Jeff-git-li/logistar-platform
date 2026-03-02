"""
Warehouse capacity API — CRUD for user-configured warehouse total capacity (CBM).
Also provides live inventory aggregation from cached inventory snapshots.
"""
import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from database import get_db
from models import WarehouseCapacity, CachedInventory
from config import settings
from services.wms_client import wms_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/warehouses", tags=["warehouses"])

# Mapping from WMS warehouse_code to our internal warehouse_id
WAREHOUSE_CODE_TO_ID = {
    "ONT002": "13",     # Ontario, CA
    "NY01": "5",        # New York, NY
    "FLT01": "3",       # Rialto, CA (FLT01 = warehouse_id 3)
    "RIA001": "15",     # Rialto, CA (RIA001 = warehouse_id 15)
}


class CapacityPayload(BaseModel):
    warehouse_id: str
    total_capacity_cbm: float


class CapacityResponse(BaseModel):
    warehouse_id: str
    warehouse_name: str
    total_capacity_cbm: float


@router.get("/capacities")
async def list_capacities(db: AsyncSession = Depends(get_db)):
    """Get all warehouse capacities."""
    rows = (await db.execute(select(WarehouseCapacity))).scalars().all()
    warehouse_map = settings.WAREHOUSE_MAP
    # Ensure every known warehouse appears
    result = {}
    for wid, info in warehouse_map.items():
        result[wid] = {
            "warehouse_id": wid,
            "warehouse_name": info.get("name", f"Warehouse {wid}"),
            "total_capacity_cbm": 0,
        }
    for row in rows:
        wid = str(row.warehouse_id)
        info = warehouse_map.get(wid, {})
        result[wid] = {
            "warehouse_id": wid,
            "warehouse_name": info.get("name", f"Warehouse {wid}"),
            "total_capacity_cbm": row.total_capacity_cbm or 0,
        }
    return list(result.values())


@router.put("/capacities")
async def set_capacity(payload: CapacityPayload, db: AsyncSession = Depends(get_db)):
    """Create or update a warehouse capacity."""
    row = (
        await db.execute(
            select(WarehouseCapacity).where(
                WarehouseCapacity.warehouse_id == payload.warehouse_id
            )
        )
    ).scalar_one_or_none()

    if row:
        row.total_capacity_cbm = payload.total_capacity_cbm
    else:
        row = WarehouseCapacity(
            warehouse_id=payload.warehouse_id,
            total_capacity_cbm=payload.total_capacity_cbm,
        )
        db.add(row)
    await db.commit()

    info = settings.WAREHOUSE_MAP.get(payload.warehouse_id, {})
    return {
        "warehouse_id": payload.warehouse_id,
        "warehouse_name": info.get("name", f"Warehouse {payload.warehouse_id}"),
        "total_capacity_cbm": payload.total_capacity_cbm,
    }


def _safe_float(val) -> float:
    """Safely parse a float value, returning 0.0 on failure."""
    try:
        return float(val) if val else 0.0
    except (ValueError, TypeError):
        return 0.0


# ─── Background sync: fetch WMS API → cached_inventory table ─────────────

async def sync_inventory_cache(db: AsyncSession) -> int:
    """
    Fetch all product inventory from WMS API and replace cached_inventory table.
    Returns the number of rows written.
    """
    logger.info("Inventory cache sync: fetching from WMS API...")
    try:
        all_items = await wms_client.get_all_product_inventory(page_size=100000)
    except Exception as e:
        logger.error("Inventory cache sync FAILED: %s", e)
        raise

    # Build rows
    rows_to_insert = []
    for item in all_items:
        qty = int(item.get("available_inventory_cnt", 0)) + int(item.get("hold_inventory_cnt", 0))
        if qty <= 0:
            continue

        wh_code = item.get("warehouse_code", "")
        wid = WAREHOUSE_CODE_TO_ID.get(wh_code)
        if wid is None:
            continue

        length_cm = _safe_float(item.get("product_length"))
        width_cm = _safe_float(item.get("product_width"))
        height_cm = _safe_float(item.get("product_height"))
        vol_per_unit = (length_cm * width_cm * height_cm) / 1_000_000 if (length_cm and width_cm and height_cm) else 0
        total_vol = vol_per_unit * qty

        rows_to_insert.append(CachedInventory(
            product_barcode=item.get("product_barcode", ""),
            warehouse_id=wid,
            warehouse_code=wh_code,
            customer_code=item.get("customer_code", "UNKNOWN"),
            quantity=qty,
            volume_cbm=round(total_vol, 6),
            length_cm=length_cm,
            width_cm=width_cm,
            height_cm=height_cm,
            synced_at=datetime.utcnow(),
        ))

    # Atomic replace: delete all, then bulk insert
    await db.execute(delete(CachedInventory))
    db.add_all(rows_to_insert)
    await db.commit()

    logger.info("Inventory cache sync: wrote %d rows.", len(rows_to_insert))
    return len(rows_to_insert)


@router.get("/live-inventory")
async def live_inventory(
    warehouse_id: Optional[str] = Query(None, description="Filter by internal warehouse ID"),
    db: AsyncSession = Depends(get_db),
):
    """
    Return product inventory aggregated by warehouse and customer.
    Reads from the cached_inventory table (refreshed every 2 hours).
    """
    warehouse_map = settings.WAREHOUSE_MAP

    # Check if cache exists
    count = (await db.execute(select(func.count(CachedInventory.id)))).scalar() or 0
    if count == 0:
        # No cached data yet — try a one-time sync
        try:
            await sync_inventory_cache(db)
        except Exception as e:
            return {"error": f"No cached data and API sync failed: {e}", "warehouses": []}

    # Build query with optional warehouse filter
    q = select(CachedInventory)
    if warehouse_id:
        q = q.where(CachedInventory.warehouse_id == warehouse_id)

    rows = (await db.execute(q)).scalars().all()

    # Aggregate
    wh_agg: dict[str, dict] = {}
    for item in rows:
        wid = item.warehouse_id
        if wid not in wh_agg:
            info = warehouse_map.get(wid, {})
            wh_agg[wid] = {
                "warehouse_id": wid,
                "warehouse_code": item.warehouse_code or "",
                "warehouse_name": info.get("name", f"Warehouse {wid}"),
                "total_qty": 0,
                "total_volume_cbm": 0.0,
                "total_skus": 0,
                "customers": {},
            }

        wh = wh_agg[wid]
        wh["total_qty"] += item.quantity
        wh["total_volume_cbm"] += item.volume_cbm or 0
        wh["total_skus"] += 1

        cc = item.customer_code
        if cc not in wh["customers"]:
            wh["customers"][cc] = {"qty": 0, "volume_cbm": 0.0, "skus": 0}
        cust = wh["customers"][cc]
        cust["qty"] += item.quantity
        cust["volume_cbm"] += item.volume_cbm or 0
        cust["skus"] += 1

    # Get last sync time
    last_sync = (await db.execute(
        select(func.max(CachedInventory.synced_at))
    )).scalar()

    # Convert to sorted list
    result = []
    for wid, wh in sorted(wh_agg.items()):
        wh["total_volume_cbm"] = round(wh["total_volume_cbm"], 2)
        cust_list = []
        for cc, cv in sorted(wh["customers"].items(), key=lambda x: x[1]["volume_cbm"], reverse=True):
            cust_list.append({
                "customer_code": cc,
                "qty": cv["qty"],
                "volume_cbm": round(cv["volume_cbm"], 2),
                "skus": cv["skus"],
            })
        wh["customers"] = cust_list
        result.append(wh)

    return {
        "warehouses": result,
        "last_synced": last_sync.isoformat() if last_sync else None,
    }


@router.post("/refresh-inventory")
async def refresh_inventory(db: AsyncSession = Depends(get_db)):
    """Manually trigger an inventory cache refresh."""
    try:
        count = await sync_inventory_cache(db)
        return {"status": "ok", "rows_synced": count}
    except Exception as e:
        return {"status": "error", "message": str(e)}

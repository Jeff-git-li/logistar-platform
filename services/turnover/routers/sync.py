"""
Sync API Router — trigger data syncs from WMS API.
Sync operations run as background tasks so the endpoint returns immediately.
"""
import asyncio
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, delete, func as sa_func

from database import get_db, async_session_factory
from models import SyncLog
from services.sync_service import sync_service

router = APIRouter(prefix="/api/sync", tags=["sync"])


async def _run_sync_in_background(coro_factory):
    """Run a sync operation with its own DB session so it doesn't depend on request lifecycle."""
    async with async_session_factory() as db:
        try:
            await coro_factory(db)
        except Exception:
            pass  # errors are already logged/recorded in SyncLog by the service


@router.post("/products")
async def sync_products(background_tasks: BackgroundTasks):
    """Trigger product master data sync from WMS API (runs in background)."""
    background_tasks.add_task(
        _run_sync_in_background,
        lambda db: sync_service.sync_products(db),
    )
    return {"status": "started", "message": "Product sync started in background. Check /api/sync/logs for progress."}


@router.post("/inventory-logs")
async def sync_inventory_logs(
    background_tasks: BackgroundTasks,
    start_time: str = Query(
        ...,
        description="Start time in China time (UTC+8), format: YYYY-MM-DD HH:MM:SS",
    ),
    end_time: str = Query(
        ...,
        description="End time in China time (UTC+8), format: YYYY-MM-DD HH:MM:SS",
    ),
    warehouse_id: Optional[int] = Query(None, description="Warehouse ID (13=Ontario CA, 5=New York)"),
    customer_code: Optional[str] = Query(None),
):
    """
    Trigger inventory log sync from WMS inventoryLog API (runs in background).
    Date range auto-chunked into ≤6-month segments.
    Times must be in China Standard Time (UTC+8).
    """
    start_dt = datetime.strptime(start_time, "%Y-%m-%d %H:%M:%S")
    end_dt = datetime.strptime(end_time, "%Y-%m-%d %H:%M:%S")

    background_tasks.add_task(
        _run_sync_in_background,
        lambda db: sync_service.sync_inventory_logs(
            db,
            start_time=start_dt,
            end_time=end_dt,
            warehouse_id=warehouse_id,
            customer_code=customer_code,
        ),
    )
    return {
        "status": "started",
        "message": f"Inventory log sync started for {start_time} → {end_time}. Check /api/sync/logs for progress.",
    }


@router.post("/daily")
async def trigger_daily_sync(background_tasks: BackgroundTasks):
    """Trigger a daily incremental sync (last 7 days of inventory logs + products)."""
    background_tasks.add_task(
        _run_sync_in_background,
        lambda db: sync_service.daily_sync(db),
    )
    return {"status": "started", "message": "Daily sync started in background."}


@router.get("/logs")
async def get_sync_logs(
    limit: int = Query(20, ge=1, le=100),
    sync_type: Optional[str] = Query(None, description="Filter by sync_type (e.g. inventory_log, product)"),
    status: Optional[str] = Query(None, description="Filter by status (running, success, failed)"),
    db: AsyncSession = Depends(get_db),
):
    """Get recent sync operation logs."""
    q = select(SyncLog).order_by(desc(SyncLog.started_at))
    if sync_type:
        q = q.where(SyncLog.sync_type == sync_type)
    if status:
        q = q.where(SyncLog.status == status)
    q = q.limit(limit)

    result = await db.execute(q)
    logs = result.scalars().all()
    return [
        {
            "id": log.id,
            "sync_type": log.sync_type,
            "status": log.status,
            "records_synced": log.records_synced,
            "error_message": log.error_message,
            "started_at": str(log.started_at) if log.started_at else None,
            "finished_at": str(log.finished_at) if log.finished_at else None,
        }
        for log in logs
    ]


@router.delete("/logs")
async def delete_sync_logs(
    status: Optional[str] = Query(None, description="Delete only logs with this status (e.g. 'failed', 'running')"),
    keep_latest: int = Query(10, ge=0, description="Keep the N most recent logs (per sync_type) and delete the rest"),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete stale sync logs.
    - If `status` is given, delete all logs with that status.
    - Otherwise, keep the latest N logs per sync_type and delete the rest.
    """
    if status:
        # Delete all logs with the given status
        result = await db.execute(
            delete(SyncLog).where(SyncLog.status == status)
        )
        await db.commit()
        return {"deleted": result.rowcount, "filter": f"status={status}"}

    # Keep latest N per sync_type
    # Get distinct sync_types
    types = (await db.execute(
        select(SyncLog.sync_type).distinct()
    )).scalars().all()

    total_deleted = 0
    for st in types:
        # Find the Nth most recent id for this type
        cutoff_row = (await db.execute(
            select(SyncLog.id)
            .where(SyncLog.sync_type == st)
            .order_by(desc(SyncLog.started_at))
            .offset(keep_latest)
            .limit(1)
        )).scalar()

        if cutoff_row is not None:
            # Delete all older entries
            result = await db.execute(
                delete(SyncLog).where(
                    SyncLog.sync_type == st,
                    SyncLog.id <= cutoff_row,
                )
            )
            total_deleted += result.rowcount

    await db.commit()
    return {"deleted": total_deleted, "kept_per_type": keep_latest}

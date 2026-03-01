"""
Analytics API Router — serves turnover KPIs and dashboard data
from inventory logs.  Includes error handling to return 503 on slow queries.
"""
import asyncio
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from services.analytics import analytics_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/analytics", tags=["analytics"])

QUERY_TIMEOUT = 120  # seconds — return 503 if a query takes longer


def _parse_date(val: Optional[str]) -> Optional[datetime]:
    if not val:
        return None
    return datetime.fromisoformat(val)


async def _safe(coro, label: str):
    """Wrap an analytics coroutine with a timeout and error handling."""
    try:
        return await asyncio.wait_for(coro, timeout=QUERY_TIMEOUT)
    except asyncio.TimeoutError:
        logger.error("Query timed out after %ds: %s", QUERY_TIMEOUT, label)
        return JSONResponse(
            status_code=503,
            content={"detail": f"{label} query timed out. Try a shorter date range or filter by warehouse."},
        )
    except Exception as exc:
        logger.exception("Query error in %s: %s", label, exc)
        return JSONResponse(
            status_code=500,
            content={"detail": f"Error computing {label}: {str(exc)[:200]}"},
        )


def _parse_date(val: Optional[str]) -> Optional[datetime]:
    if not val:
        return None
    return datetime.fromisoformat(val)


@router.get("/invlog/dashboard")
async def invlog_dashboard(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    warehouse_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Dashboard summary from inventory logs."""
    return await _safe(
        analytics_service.invlog_dashboard_summary(
            db,
            date_from=_parse_date(date_from),
            date_to=_parse_date(date_to),
            warehouse_id=warehouse_id,
        ),
        "dashboard",
    )


@router.get("/invlog/volume")
async def invlog_volume(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    granularity: str = Query("day", regex="^(day|week|month)$"),
    warehouse_id: Optional[str] = Query(None),
    customer_code: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Inbound vs outbound volume time series from inventory logs."""
    return await _safe(
        analytics_service.invlog_volume(
            db,
            date_from=_parse_date(date_from),
            date_to=_parse_date(date_to),
            granularity=granularity,
            warehouse_id=warehouse_id,
            customer_code=customer_code,
        ),
        "volume",
    )


@router.get("/invlog/turnover")
async def invlog_turnover(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    warehouse_id: Optional[str] = Query(None),
    customer_code: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Inventory turnover rate from inventory logs."""
    return await _safe(
        analytics_service.invlog_turnover(
            db,
            date_from=_parse_date(date_from),
            date_to=_parse_date(date_to),
            warehouse_id=warehouse_id,
            customer_code=customer_code,
        ),
        "turnover",
    )


@router.get("/invlog/customers")
async def invlog_customers(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    warehouse_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Customer breakdown from inventory logs."""
    return await _safe(
        analytics_service.invlog_customer_breakdown(
            db,
            date_from=_parse_date(date_from),
            date_to=_parse_date(date_to),
            warehouse_id=warehouse_id,
        ),
        "customers",
    )


@router.get("/invlog/skus")
async def invlog_skus(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    warehouse_id: Optional[str] = Query(None),
    customer_code: Optional[str] = Query(None),
    sort_by: str = Query("outbound_vol", regex="^(outbound_qty|inbound_qty|outbound_vol|inbound_vol)$"),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    """SKU-level movement analysis from inventory logs."""
    return await _safe(
        analytics_service.invlog_sku_analysis(
            db,
            date_from=_parse_date(date_from),
            date_to=_parse_date(date_to),
            warehouse_id=warehouse_id,
            customer_code=customer_code,
            sort_by=sort_by,
            limit=limit,
        ),
        "skus",
    )


@router.get("/invlog/warehouses")
async def invlog_warehouses(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    customer_code: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Warehouse comparison from inventory logs."""
    return await _safe(
        analytics_service.invlog_warehouse_comparison(
            db,
            date_from=_parse_date(date_from),
            date_to=_parse_date(date_to),
            customer_code=customer_code,
        ),
        "warehouses",
    )

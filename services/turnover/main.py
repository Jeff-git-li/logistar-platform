"""
Logistar Turnover — FastAPI Backend
Warehouse sales/turnover analytics dashboard.
"""
import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from config import settings
from database import init_db, async_session_factory
from routers import analytics, sync, warehouse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


async def _daily_sync_loop():
    """Run daily_sync at the configured hour/minute (server-local time)."""
    from datetime import datetime, timedelta
    from services.sync_service import SyncService

    while True:
        now = datetime.now()
        target = now.replace(
            hour=settings.DAILY_SYNC_HOUR,
            minute=settings.DAILY_SYNC_MINUTE,
            second=0,
            microsecond=0,
        )
        if target <= now:
            target += timedelta(days=1)
        wait_seconds = (target - now).total_seconds()
        logger.info(
            "Daily sync scheduled at %s (in %.0f seconds)",
            target.isoformat(),
            wait_seconds,
        )
        await asyncio.sleep(wait_seconds)
        logger.info("Daily auto-sync triggered")
        try:
            async with async_session_factory() as db:
                svc = SyncService()
                await svc.daily_sync(db)
            logger.info("Daily auto-sync completed successfully")
        except Exception:
            logger.exception("Daily auto-sync FAILED")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle."""
    logger.info("Starting up — initializing database...")
    await init_db()
    logger.info("Database initialized.")
    # launch daily sync background loop
    sync_task = asyncio.create_task(_daily_sync_loop())
    yield
    sync_task.cancel()
    logger.info("Shutting down.")


app = FastAPI(
    title="Logistar Turnover API",
    description="Warehouse turnover rate analytics & data visualization backend",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL, "http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(analytics.router)
app.include_router(sync.router)
app.include_router(warehouse.router)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "logistar-turnover"}

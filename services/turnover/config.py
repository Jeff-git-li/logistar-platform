from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # WMS API Configuration
    WMS_API_BASE_URL: str = "http://hx.wms.yunwms.com/default/svc-for-api/web-service"
    WMS_USER_TOKEN: str = "6b8546d4-2760-afa0-0d86-8e17f81b3886"

    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///./turnover.db"
    DATABASE_SYNC_URL: str = "sqlite:///./turnover.db"

    # Sync settings
    SYNC_INTERVAL_MINUTES: int = 60  # How often to sync data from WMS
    DEFAULT_PAGE_SIZE: int = 100000
    INVENTORY_LOG_PAGE_SIZE: int = 100000  # page size for inventoryLog API
    DAILY_SYNC_HOUR: int = 2  # Hour (24h) in local time to run daily sync
    DAILY_SYNC_MINUTE: int = 0

    # CORS
    FRONTEND_URL: str = "http://localhost:3000"
    BACKEND_PORT: int = 8001

    # Warehouse mapping (id → info)
    # Times sent to WMS API are in China Standard Time (UTC+8)
    WAREHOUSE_MAP: dict = {
        "13": {"name": "Ontario, CA", "timezone": "America/Los_Angeles"},
        "5": {"name": "New York, NY", "timezone": "America/New_York"},
        "3": {"name": "Rialto, CA", "timezone": "America/Los_Angeles"},
        "15": {"name": "Rialto, CA", "timezone": "America/Los_Angeles"},
    }
    DEFAULT_WAREHOUSE_ID: int = 13

    # Operation types for classification
    INBOUND_OPERATION_TYPES: list = ["上架"]
    OUTBOUND_OPERATION_TYPES: list = ["订单签出", "FBA签出"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()

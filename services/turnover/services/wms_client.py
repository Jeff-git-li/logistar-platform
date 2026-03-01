"""
WMS API Client — handles all communication with the warehouse management system.
"""
import httpx
import logging
from datetime import datetime, timedelta
from typing import Optional
from config import settings

logger = logging.getLogger(__name__)

WMS_API_URL = settings.WMS_API_BASE_URL
USER_TOKEN = settings.WMS_USER_TOKEN
DEFAULT_PAGE_SIZE = settings.DEFAULT_PAGE_SIZE
INVENTORY_LOG_PAGE_SIZE = settings.INVENTORY_LOG_PAGE_SIZE


class WMSClient:
    """Async HTTP client for the WMS API."""

    def __init__(self, base_url: str = WMS_API_URL, user_token: str = USER_TOKEN):
        self.base_url = base_url
        self.user_token = user_token

    async def _request(self, payload: dict) -> dict:
        """Send a POST request to the WMS API."""
        payload["user_token"] = self.user_token
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(self.base_url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            if data.get("ask") != "Success":
                raise Exception(f"WMS API error: {data.get('message', 'Unknown error')}")
            return data

    # -------------------------------------------------------------------------
    # Product List
    # -------------------------------------------------------------------------
    async def get_product_list(
        self,
        page: int = 1,
        page_size: int = DEFAULT_PAGE_SIZE,
    ) -> dict:
        """Fetch product master data."""
        payload = {
            "service": "getProductList",
            "page": page,
            "pageSize": page_size,
        }
        return await self._request(payload)

    async def get_all_products(self, page_size: int = DEFAULT_PAGE_SIZE) -> list[dict]:
        """Fetch ALL products with pagination."""
        all_data = []
        page = 1
        while True:
            result = await self.get_product_list(page=page, page_size=page_size)
            data = result.get("data", [])
            all_data.extend(data)
            total = int(result.get("totalCount", 0))
            logger.info(f"Products: fetched page {page}, got {len(data)}, total={total}")
            if len(all_data) >= total or not data:
                break
            page += 1
        return all_data

    # -------------------------------------------------------------------------
    # Inventory Log (comprehensive inbound/outbound/adjustment log)
    # -------------------------------------------------------------------------
    async def get_inventory_log(
        self,
        start_time: str,
        end_time: str,
        warehouse_id: Optional[int] = None,
        product_barcode: Optional[str] = None,
        customer_code: Optional[str] = None,
        page: int = 1,
        page_size: int = INVENTORY_LOG_PAGE_SIZE,
    ) -> dict:
        """
        Fetch inventory movement logs.
        start_time / end_time must be in Chinese time (UTC+8), format: "YYYY-MM-DD HH:MM:SS".
        Max range = 6 months.
        """
        payload = {
            "service": "inventoryLog",
            "page": page,
            "page_size": page_size,
            "start_time": start_time,
            "end_time": end_time,
        }
        if warehouse_id is not None:
            payload["warehouse_id"] = warehouse_id
        if product_barcode:
            payload["product_barcode"] = product_barcode
        if customer_code:
            payload["customer_code"] = customer_code

        return await self._request(payload)

    async def get_all_inventory_logs(
        self,
        start_time: str,
        end_time: str,
        warehouse_id: Optional[int] = None,
        product_barcode: Optional[str] = None,
        customer_code: Optional[str] = None,
        page_size: int = INVENTORY_LOG_PAGE_SIZE,
    ) -> list[dict]:
        """
        Fetch ALL inventory logs for a given time range (max 6 months) with pagination.
        The response structure uses data.list for records and data.total for count.
        """
        all_data = []
        page = 1
        while True:
            result = await self.get_inventory_log(
                start_time=start_time,
                end_time=end_time,
                warehouse_id=warehouse_id,
                product_barcode=product_barcode,
                customer_code=customer_code,
                page=page,
                page_size=page_size,
            )
            data_obj = result.get("data", {})
            records = data_obj.get("list", [])
            total = int(data_obj.get("total", 0))
            all_data.extend(records)
            logger.info(
                f"InventoryLog: fetched page {page}, got {len(records)}, "
                f"accumulated {len(all_data)}/{total}, range={start_time} → {end_time}"
            )
            if len(all_data) >= total or not records:
                break
            page += 1
        return all_data

    async def get_inventory_logs_chunked(
        self,
        start_time: datetime,
        end_time: datetime,
        warehouse_id: Optional[int] = None,
        product_barcode: Optional[str] = None,
        customer_code: Optional[str] = None,
        page_size: int = INVENTORY_LOG_PAGE_SIZE,
        chunk_months: int = 6,
    ) -> list[dict]:
        """
        Fetch inventory logs across an arbitrary date range by splitting into
        ≤6-month chunks (API limit). Dates are auto-converted to China time strings.
        """
        all_data = []
        chunk_start = start_time
        while chunk_start < end_time:
            # Advance by chunk_months, but don't exceed end_time
            chunk_end = chunk_start + timedelta(days=chunk_months * 30)
            if chunk_end > end_time:
                chunk_end = end_time

            start_str = chunk_start.strftime("%Y-%m-%d %H:%M:%S")
            end_str = chunk_end.strftime("%Y-%m-%d %H:%M:%S")

            logger.info(f"InventoryLog chunk: {start_str} → {end_str}")
            chunk_data = await self.get_all_inventory_logs(
                start_time=start_str,
                end_time=end_str,
                warehouse_id=warehouse_id,
                product_barcode=product_barcode,
                customer_code=customer_code,
                page_size=page_size,
            )
            all_data.extend(chunk_data)
            chunk_start = chunk_end

        logger.info(f"InventoryLog total fetched: {len(all_data)} records")
        return all_data

    # -------------------------------------------------------------------------
    # Product Inventory (live current stock per SKU per warehouse)
    # -------------------------------------------------------------------------
    async def get_product_inventory(
        self,
        page: int = 1,
        page_size: int = DEFAULT_PAGE_SIZE,
    ) -> dict:
        """Fetch current product inventory (available + hold counts, dimensions)."""
        payload = {
            "service": "getProductInventory",
            "page": page,
            "pageSize": page_size,
        }
        return await self._request(payload)

    async def get_all_product_inventory(self, page_size: int = DEFAULT_PAGE_SIZE) -> list[dict]:
        """Fetch ALL product inventory records with pagination."""
        all_data = []
        page = 1
        while True:
            result = await self.get_product_inventory(page=page, page_size=page_size)
            data = result.get("data", [])
            all_data.extend(data)
            total = int(result.get("totalCount", 0))
            logger.info(f"ProductInventory: fetched page {page}, got {len(data)}, total={total}")
            if len(all_data) >= total or not data:
                break
            page += 1
        return all_data


# Singleton
wms_client = WMSClient()

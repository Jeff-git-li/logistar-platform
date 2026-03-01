from sqlalchemy import Column, Integer, String, Float, DateTime, Date, Text, Index
from sqlalchemy.sql import func
from database import Base


class Product(Base):
    """Product master data from getProductList API."""
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, autoincrement=True)
    product_barcode = Column(String(200), unique=True, index=True)
    reference_no = Column(String(200))
    customer_code = Column(String(50), index=True)
    product_length = Column(Float)
    product_width = Column(Float)
    product_height = Column(Float)
    product_weight = Column(Float)
    product_declared_value = Column(Float)
    size_unit = Column(String(10))
    weight_unit = Column(String(10))

    # Calculated
    volume_cbm = Column(Float)  # in cubic meters

    # Metadata
    synced_at = Column(DateTime, server_default=func.now())


class WarehouseCapacity(Base):
    """User-configured total warehouse capacity (CBM) for utilization tracking."""
    __tablename__ = "warehouse_capacities"

    id = Column(Integer, primary_key=True, autoincrement=True)
    warehouse_id = Column(String(20), unique=True, nullable=False, index=True)
    total_capacity_cbm = Column(Float, nullable=False, default=0)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class SyncLog(Base):
    """Track data sync operations."""
    __tablename__ = "sync_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sync_type = Column(String(50))  # 'outbound', 'inbound', 'product', 'excel', 'inventory_log'
    status = Column(String(20))     # 'running', 'success', 'failed'
    records_synced = Column(Integer, default=0)
    error_message = Column(Text)
    started_at = Column(DateTime, server_default=func.now())
    finished_at = Column(DateTime)


class InventoryLog(Base):
    """
    Inventory movement logs from the inventoryLog API.
    Each row = one inventory change event (inbound shelf, outbound checkout, adjustment, etc.)
    This is the primary data source for turnover analytics.
    """
    __tablename__ = "inventory_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ref_no = Column(String(200), index=True)                 # 操作单号
    reference_no = Column(String(200))                       # 参考号
    product_barcode = Column(String(200), index=True)        # 产品代码 / SKU
    warehouse_id = Column(String(20), index=True)            # 仓库ID
    quantity = Column(Integer)                               # 数量
    receiving_code = Column(String(200))                     # 入库单号
    ibl_add_time = Column(DateTime, index=True)              # 操作时间 (Chinese time)
    ibl_note = Column(Text)                                  # 备注
    customer_code = Column(String(50), index=True)           # 客户代码
    tracking_number = Column(String(200))                    # 跟踪号
    warehouse_operation_time = Column(DateTime, index=True)  # 仓库本地操作时间 (for display)
    operation_type = Column(String(100), index=True)         # 操作类型 (上架, 订单签出, FBA签出, etc.)
    inventory_type = Column(Integer)                         # 库存类型: 0=良品, 1=不良品, 2=暂存
    inventory_type_name = Column(String(50))                 # 库存类型名称
    inventory_status = Column(Integer)                       # 变化状态: 1=增加, 2=减少
    user_name = Column(String(100))                          # 操作人

    # Derived classification
    direction = Column(String(10), index=True)               # 'inbound', 'outbound', 'other'

    # Composite indexes for analytics query performance
    __table_args__ = (
        Index("ix_invlog_dir_optime", "direction", "warehouse_operation_time"),
        Index("ix_invlog_dir_wh_optime", "direction", "warehouse_id", "warehouse_operation_time"),
        Index("ix_invlog_wh_dir_optime", "warehouse_id", "direction", "warehouse_operation_time"),
        Index("ix_invlog_dir_cust_optime", "direction", "customer_code", "warehouse_operation_time"),
        Index("ix_invlog_barcode_dir", "product_barcode", "direction"),
    )


class InvlogDailySummary(Base):
    """
    Pre-aggregated daily summary of inventory movements per warehouse/direction/customer.
    Reduces 6M+ raw inventory_logs to ~3-5K summary rows for fast analytics.
    """
    __tablename__ = "invlog_daily_summary"

    id = Column(Integer, primary_key=True, autoincrement=True)
    summary_date = Column(Date, nullable=False)          # date of activity
    warehouse_id = Column(String(20), nullable=False)
    direction = Column(String(10), nullable=False)       # 'inbound', 'outbound'
    customer_code = Column(String(50), nullable=False)
    event_count = Column(Integer, default=0)
    total_qty = Column(Integer, default=0)
    total_volume_cbm = Column(Float, default=0)          # SUM(qty * product.volume_cbm)
    unique_skus = Column(Integer, default=0)

    # Metadata
    synced_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_daily_date_dir", "summary_date", "direction"),
        Index("ix_daily_wh_dir_date", "warehouse_id", "direction", "summary_date"),
        Index("ix_daily_dir_date", "direction", "summary_date"),
        Index("ix_daily_cust_dir_date", "customer_code", "direction", "summary_date"),
        {"extend_existing": True},
    )

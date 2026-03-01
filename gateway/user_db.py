"""
User Database Module for Logistar Platform
Handles user authentication, roles, and permissions
"""

import sqlite3
import os
import json
from datetime import datetime
from flask_login import UserMixin

# Database path
USER_DB_PATH = os.path.join(os.path.dirname(__file__), 'users.db')

# Define available permissions/tabs - grouped by section
AVAILABLE_PERMISSIONS = {
    # 自营FedEx section
    'dashboard': '运营数据面板',
    'verify': '账单核对',
    'search': '搜索',
    # 其它服务商 section
    'supplier_operations': '其它服务商',
    # 定价 section
    'rate_comparison': '尾程服务商比价',
    'customer_quote': '尾程运费试算',
    'rate_debug': '运费报价调试',
    # 仓库 section
    'wms_monitor': '仓库监控',
    'turnover_dashboard': '库存周转分析',
    # 管理 section
    'downloads': '下载中心',
    'settings': '参数设置（总开关）',
    'user_management': '用户管理',
    # 参数设置 subsections
    'settings_fedex_rates': 'FedEx合同费率',
    'settings_customer_pricing': '客户加价规则',
    'settings_supplier': '尾程服务商成本管理',
    'settings_quote_pricing': '尾程运费报价管理',
    'settings_warehouse_ops': '一件代发库内操作',
    'settings_zone_charts': '分区表管理',
    'settings_product_mapping': '产品映射',
    # 尾程运费试算 profit visibility
    'view_cost_profit': '查看成本和利润',
}

# Permission groups for UI display (ordered same as left nav panel)
PERMISSION_GROUPS = {
    '自营FedEx': ['dashboard', 'verify', 'search'],
    '其它服务商': ['supplier_operations'],
    '定价': ['rate_comparison', 'customer_quote', 'rate_debug'],
    '仓库': ['wms_monitor', 'turnover_dashboard'],
    '管理': ['downloads', 'settings', 'user_management'],
    '参数设置': ['settings_fedex_rates', 'settings_customer_pricing', 'settings_quote_pricing', 'settings_supplier', 'settings_warehouse_ops', 'settings_zone_charts', 'settings_product_mapping'],
    '尾程运费试算高级': ['view_cost_profit']
}

# Default role permissions
DEFAULT_ROLE_PERMISSIONS = {
    'admin': list(AVAILABLE_PERMISSIONS.keys()),  # Admin has all permissions
    'sub-admin': ['dashboard', 'verify', 'search', 'supplier_operations', 'rate_comparison', 'customer_quote', 'rate_debug', 'downloads', 'settings', 
                  'settings_fedex_rates', 'settings_customer_pricing', 'settings_quote_pricing', 'settings_supplier', 'settings_warehouse_ops',
                  'settings_zone_charts', 'settings_product_mapping',
                  'view_cost_profit', 'user_management', 'wms_monitor', 'turnover_dashboard'],
    'manager': ['dashboard', 'verify', 'search', 'supplier_operations', 'rate_comparison', 'customer_quote', 'rate_debug', 'downloads', 'settings', 
                'settings_fedex_rates', 'settings_customer_pricing', 'settings_quote_pricing', 'settings_supplier', 'settings_warehouse_ops',
                'settings_zone_charts', 'settings_product_mapping',
                'view_cost_profit', 'wms_monitor', 'turnover_dashboard'],
    'operator': ['dashboard', 'verify', 'search', 'supplier_operations', 'downloads', 'wms_monitor'],
    'viewer': ['customer_quote']
}

class User(UserMixin):
    """User class for Flask-Login"""
    
    def __init__(self, id, username, email, role, permissions, display_name=None, is_active=True, created_at=None, last_login=None):
        self.id = id
        self.username = username
        self.email = email
        self.role = role
        self.permissions = permissions if isinstance(permissions, list) else json.loads(permissions or '[]')
        self.display_name = display_name or username
        self._is_active = is_active  # Use private variable to avoid conflict with UserMixin property
        self.created_at = created_at
        self.last_login = last_login
    
    @property
    def is_active(self):
        """Override UserMixin's is_active property"""
        return self._is_active
    
    def has_permission(self, permission):
        """Check if user has a specific permission"""
        return permission in self.permissions or self.role == 'admin'
    
    def get_permissions(self):
        """Get list of permissions"""
        if self.role == 'admin':
            return list(AVAILABLE_PERMISSIONS.keys())
        return self.permissions
    
    def to_dict(self):
        """Convert user to dictionary (for API responses)"""
        return {
            'id': self.id,
            'username': self.username,
            'email': self.email,
            'role': self.role,
            'permissions': self.get_permissions(),
            'display_name': self.display_name,
            'is_active': self._is_active,
            'created_at': self.created_at,
            'last_login': self.last_login
        }


def init_user_db():
    """Initialize the user database with tables"""
    conn = sqlite3.connect(USER_DB_PATH)
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT,
            display_name TEXT,
            role TEXT DEFAULT 'viewer',
            permissions TEXT DEFAULT '[]',
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            last_login TEXT,
            created_by INTEGER,
            FOREIGN KEY (created_by) REFERENCES users(id)
        )
    ''')
    
    # Create login_history table for audit
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS login_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            login_time TEXT DEFAULT CURRENT_TIMESTAMP,
            ip_address TEXT,
            user_agent TEXT,
            success INTEGER DEFAULT 1,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    ''')
    
    conn.commit()
    conn.close()


def get_user_by_id(user_id):
    """Get user by ID"""
    conn = sqlite3.connect(USER_DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, username, email, role, permissions, display_name, is_active, created_at, last_login
        FROM users WHERE id = ?
    ''', (user_id,))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return User(
            id=row[0],
            username=row[1],
            email=row[2],
            role=row[3],
            permissions=row[4],
            display_name=row[5],
            is_active=bool(row[6]),
            created_at=row[7],
            last_login=row[8]
        )
    return None


def get_user_by_username(username):
    """Get user by username"""
    conn = sqlite3.connect(USER_DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, username, email, role, permissions, display_name, is_active, created_at, last_login
        FROM users WHERE username = ?
    ''', (username,))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return User(
            id=row[0],
            username=row[1],
            email=row[2],
            role=row[3],
            permissions=row[4],
            display_name=row[5],
            is_active=bool(row[6]),
            created_at=row[7],
            last_login=row[8]
        )
    return None


def get_password_hash(username):
    """Get password hash for a username"""
    conn = sqlite3.connect(USER_DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT password_hash FROM users WHERE username = ?', (username,))
    row = cursor.fetchone()
    conn.close()
    return row[0] if row else None


def create_user(username, password_hash, email=None, display_name=None, role='viewer', permissions=None, created_by=None):
    """Create a new user"""
    if permissions is None:
        permissions = DEFAULT_ROLE_PERMISSIONS.get(role, [])
    
    conn = sqlite3.connect(USER_DB_PATH)
    cursor = conn.cursor()
    
    try:
        cursor.execute('''
            INSERT INTO users (username, password_hash, email, display_name, role, permissions, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (username, password_hash, email, display_name or username, role, json.dumps(permissions), created_by))
        conn.commit()
        user_id = cursor.lastrowid
        conn.close()
        return user_id
    except sqlite3.IntegrityError:
        conn.close()
        return None  # Username already exists


def update_user(user_id, email=None, display_name=None, role=None, permissions=None, is_active=None):
    """Update user details"""
    conn = sqlite3.connect(USER_DB_PATH)
    cursor = conn.cursor()
    
    updates = []
    params = []
    
    if email is not None:
        updates.append('email = ?')
        params.append(email)
    if display_name is not None:
        updates.append('display_name = ?')
        params.append(display_name)
    if role is not None:
        updates.append('role = ?')
        params.append(role)
    if permissions is not None:
        updates.append('permissions = ?')
        params.append(json.dumps(permissions))
    if is_active is not None:
        updates.append('is_active = ?')
        params.append(1 if is_active else 0)
    
    if updates:
        params.append(user_id)
        cursor.execute(f'UPDATE users SET {", ".join(updates)} WHERE id = ?', params)
        conn.commit()
    
    conn.close()
    return True


def update_password(user_id, password_hash):
    """Update user password"""
    conn = sqlite3.connect(USER_DB_PATH)
    cursor = conn.cursor()
    cursor.execute('UPDATE users SET password_hash = ? WHERE id = ?', (password_hash, user_id))
    conn.commit()
    conn.close()
    return True


def update_last_login(user_id):
    """Update last login timestamp"""
    conn = sqlite3.connect(USER_DB_PATH)
    cursor = conn.cursor()
    cursor.execute('UPDATE users SET last_login = ? WHERE id = ?', 
                   (datetime.now().isoformat(), user_id))
    conn.commit()
    conn.close()


def log_login_attempt(user_id, ip_address=None, user_agent=None, success=True):
    """Log a login attempt"""
    conn = sqlite3.connect(USER_DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO login_history (user_id, ip_address, user_agent, success)
        VALUES (?, ?, ?, ?)
    ''', (user_id, ip_address, user_agent, 1 if success else 0))
    conn.commit()
    conn.close()


def get_all_users():
    """Get all users (for admin)"""
    conn = sqlite3.connect(USER_DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, username, email, role, permissions, display_name, is_active, created_at, last_login
        FROM users ORDER BY created_at DESC
    ''')
    rows = cursor.fetchall()
    conn.close()
    
    users = []
    for row in rows:
        users.append(User(
            id=row[0],
            username=row[1],
            email=row[2],
            role=row[3],
            permissions=row[4],
            display_name=row[5],
            is_active=bool(row[6]),
            created_at=row[7],
            last_login=row[8]
        ))
    return users


def delete_user(user_id):
    """Delete a user permanently from the database"""
    conn = sqlite3.connect(USER_DB_PATH)
    cursor = conn.cursor()
    # Delete login history first (foreign key reference)
    cursor.execute('DELETE FROM login_history WHERE user_id = ?', (user_id,))
    # Delete the user
    cursor.execute('DELETE FROM users WHERE id = ?', (user_id,))
    conn.commit()
    conn.close()
    return True


def deactivate_user(user_id):
    """Deactivate a user (soft delete by setting is_active=0)"""
    conn = sqlite3.connect(USER_DB_PATH)
    cursor = conn.cursor()
    cursor.execute('UPDATE users SET is_active = 0 WHERE id = ?', (user_id,))
    conn.commit()
    conn.close()
    return True


def get_user_count():
    """Get total number of active users"""
    conn = sqlite3.connect(USER_DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT COUNT(*) FROM users WHERE is_active = 1')
    count = cursor.fetchone()[0]
    conn.close()
    return count


def create_default_admin(bcrypt):
    """Create default admin user if no users exist"""
    if get_user_count() == 0:
        password_hash = bcrypt.generate_password_hash('admin123').decode('utf-8')
        create_user(
            username='admin',
            password_hash=password_hash,
            email='admin@logistarinc.net',
            display_name='Administrator',
            role='admin',
            permissions=list(AVAILABLE_PERMISSIONS.keys())
        )
        print("Default admin user created: admin / admin123")
        return True
    return False

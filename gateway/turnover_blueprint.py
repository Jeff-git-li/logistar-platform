"""
Turnover Analytics Blueprint — proxies API requests to the logistar-turnover
FastAPI backend running on a separate port. Also manages the subprocess lifecycle.

The FastAPI backend handles all async SQLAlchemy operations, and this blueprint
simply forwards requests, adding authentication via Flask-Login.
"""

import logging
import subprocess
import sys
import os
import time
import requests as http_requests
from pathlib import Path

from flask import Blueprint, jsonify, request, Response
from flask_login import login_required

logger = logging.getLogger(__name__)

TURNOVER_BACKEND_PORT = 8001
TURNOVER_BACKEND_URL = f"http://127.0.0.1:{TURNOVER_BACKEND_PORT}"
TURNOVER_BACKEND_DIR = Path(__file__).parent.parent / "services" / "turnover"

turnover_bp = Blueprint('turnover', __name__, url_prefix='/api/turnover')

# Subprocess handle for the turnover backend
_turnover_process = None


def start_turnover_backend():
    """Start the turnover FastAPI backend as a subprocess."""
    global _turnover_process
    if _turnover_process and _turnover_process.poll() is None:
        logger.info("Turnover backend already running (PID %d)", _turnover_process.pid)
        return

    if not TURNOVER_BACKEND_DIR.exists():
        logger.warning("Turnover backend directory not found: %s", TURNOVER_BACKEND_DIR)
        return

    try:
        python_exe = sys.executable
        _turnover_process = subprocess.Popen(
            [python_exe, "-m", "uvicorn", "main:app",
             "--host", "127.0.0.1",
             "--port", str(TURNOVER_BACKEND_PORT),
             "--log-level", "warning"],
            cwd=str(TURNOVER_BACKEND_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0,
        )
        logger.info("Turnover backend started (PID %d) on port %d",
                     _turnover_process.pid, TURNOVER_BACKEND_PORT)

        # Wait briefly for it to become ready
        for _ in range(10):
            time.sleep(1)
            try:
                resp = http_requests.get(f"{TURNOVER_BACKEND_URL}/api/health", timeout=2)
                if resp.status_code == 200:
                    logger.info("Turnover backend is ready")
                    return
            except http_requests.ConnectionError:
                continue
        logger.warning("Turnover backend started but health check not responding yet")
    except Exception as e:
        logger.error("Failed to start turnover backend: %s", e)


def stop_turnover_backend():
    """Stop the turnover FastAPI backend subprocess."""
    global _turnover_process
    if _turnover_process and _turnover_process.poll() is None:
        logger.info("Stopping turnover backend (PID %d)", _turnover_process.pid)
        _turnover_process.terminate()
        try:
            _turnover_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _turnover_process.kill()
        _turnover_process = None


def _proxy_request(path, method='GET'):
    """Proxy a request to the turnover FastAPI backend."""
    target_url = f"{TURNOVER_BACKEND_URL}/api/{path}"

    try:
        if method == 'GET':
            resp = http_requests.get(
                target_url,
                params=request.args,
                timeout=130  # slightly > the 120s query timeout in turnover
            )
        elif method == 'POST':
            resp = http_requests.post(
                target_url,
                params=request.args,
                json=request.get_json(silent=True),
                timeout=130
            )
        elif method == 'PUT':
            resp = http_requests.put(
                target_url,
                params=request.args,
                json=request.get_json(silent=True),
                timeout=130
            )
        else:
            return jsonify({"error": f"Unsupported method: {method}"}), 405

        # Forward the response
        return Response(
            resp.content,
            status=resp.status_code,
            content_type=resp.headers.get('content-type', 'application/json')
        )
    except http_requests.ConnectionError:
        return jsonify({
            "error": "Turnover backend is not running",
            "detail": "The turnover analytics backend is not available. It may still be starting up."
        }), 503
    except http_requests.Timeout:
        return jsonify({"error": "Request to turnover backend timed out"}), 504
    except Exception as e:
        logger.error("Proxy error: %s", e)
        return jsonify({"error": str(e)}), 500


# --- Health check ---
@turnover_bp.route('/health')
@login_required
def turnover_health():
    return _proxy_request('health')


# --- Analytics endpoints ---
@turnover_bp.route('/analytics/invlog/dashboard')
@login_required
def turnover_dashboard():
    return _proxy_request('analytics/invlog/dashboard')


@turnover_bp.route('/analytics/invlog/volume')
@login_required
def turnover_volume():
    return _proxy_request('analytics/invlog/volume')


@turnover_bp.route('/analytics/invlog/turnover')
@login_required
def turnover_turnover():
    return _proxy_request('analytics/invlog/turnover')


@turnover_bp.route('/analytics/invlog/customers')
@login_required
def turnover_customers():
    return _proxy_request('analytics/invlog/customers')


@turnover_bp.route('/analytics/invlog/skus')
@login_required
def turnover_skus():
    return _proxy_request('analytics/invlog/skus')


@turnover_bp.route('/analytics/invlog/warehouses')
@login_required
def turnover_warehouses():
    return _proxy_request('analytics/invlog/warehouses')


# --- Sync endpoints ---
@turnover_bp.route('/sync/products', methods=['POST'])
@login_required
def turnover_sync_products():
    return _proxy_request('sync/products', method='POST')


@turnover_bp.route('/sync/inventory-logs', methods=['POST'])
@login_required
def turnover_sync_logs():
    return _proxy_request('sync/inventory-logs', method='POST')


@turnover_bp.route('/sync/daily', methods=['POST'])
@login_required
def turnover_sync_daily():
    return _proxy_request('sync/daily', method='POST')


@turnover_bp.route('/sync/logs')
@login_required
def turnover_sync_logs_list():
    return _proxy_request('sync/logs')


# --- Warehouse capacity endpoints ---
@turnover_bp.route('/warehouses/capacities')
@login_required
def turnover_capacities():
    return _proxy_request('warehouses/capacities')


@turnover_bp.route('/warehouses/capacities', methods=['PUT'])
@login_required
def turnover_set_capacity():
    return _proxy_request('warehouses/capacities', method='PUT')


@turnover_bp.route('/warehouses/live-inventory')
@login_required
def turnover_live_inventory():
    return _proxy_request('warehouses/live-inventory')


@turnover_bp.route('/warehouses/refresh-inventory', methods=['POST'])
@login_required
def turnover_refresh_inventory():
    return _proxy_request('warehouses/refresh-inventory', method='POST')

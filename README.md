# Logistar Platform

Unified internal operations platform for Logistar, consolidating FedEx invoice verification, WMS monitoring, and warehouse turnover analytics into a single application.

## Architecture

```
logistar-platform/
├── frontend/               # Vanilla JS + HTML frontend
│   ├── static/             # CSS, JS modules, images
│   └── templates/          # Jinja2 HTML templates
│
├── gateway/                # Flask API gateway (port 5000)
│   ├── app.py              # Main Flask app — routes, auth, FedEx logic
│   ├── scheduler.py        # APScheduler — WMS monitor, TMS export, turnover sync
│   ├── turnover_blueprint.py   # Proxy to turnover FastAPI backend
│   ├── wms_blueprint.py    # WMS dashboard API (reads wms-monitor DB)
│   ├── data/               # Rate cards, pricing JSON files
│   └── exports/            # Generated export files
│
├── services/
│   ├── turnover/           # FastAPI backend (port 8001) — turnover analytics
│   │   ├── main.py         # FastAPI app + daily sync loop
│   │   ├── routers/        # API routes (analytics, sync, warehouse)
│   │   └── services/       # Business logic (WMS client, sync, analytics)
│   │
│   └── wms-monitor/        # WMS data collector
│       └── wms_monitor.py  # Polls WMS API every 10 min, stores in SQLite
│
├── start_platform.bat      # One-click startup (all services + tunnel)
└── requirements.txt        # Combined Python dependencies
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| Gateway (Flask) | 5000 | Main app — auth, FedEx verification, rate comparison, dashboard |
| Turnover (FastAPI) | 8001 | Warehouse turnover analytics — auto-started by gateway |
| WMS Monitor | — | Background data collector — writes to SQLite |

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Start everything (Windows)
start_platform.bat

# Or manually:
cd gateway && python app.py
```

## Environment Files

- `gateway/.env` — Flask secret key, TMS credentials
- `services/turnover/.env` — WMS API token (see `.env.example`)
- `services/wms-monitor/.env` — WMS API token, warehouse config

## Background Jobs (APScheduler)

| Job | Schedule | Description |
|-----|----------|-------------|
| WMS Monitor | Every 10 min | Fetches unlabeled order counts from WMS API |
| TMS Export | 9:00 AM daily | Exports previous day's TMS shipment records |
| Turnover Sync | 2:00 AM daily | Syncs inventory logs + products from WMS API |

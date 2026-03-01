@echo off
REM ================================================
REM Logistar Platform - Unified Startup Script
REM ================================================
REM Starts:
REM   1. Logistar Platform (main Flask app on port 5000)
REM      - Turnover FastAPI backend auto-starts on port 8001
REM      - Background scheduler:
REM        * WMS Monitor (every 10 min)
REM        * TMS Daily Export (9 AM)
REM        * Turnover Sync (2 AM)
REM   2. Cloudflare Tunnel (remote access)
REM ================================================

echo.
echo ================================================
echo   Logistar Platform v3.0 - Starting All Services
echo ================================================
echo.

REM --- 1. Start Main Platform (Flask + Turnover backend + Scheduler) ---
echo [1/2] Starting Logistar Platform (port 5000)...
echo       Turnover backend will auto-start on port 8001
echo       WMS Monitor runs via built-in scheduler (every 10 min)
start /min "Logistar Platform" cmd /k "cd /d %~dp0gateway && python app.py"
timeout /t 5 /nobreak >nul

REM --- 2. Start Cloudflare Tunnel ---
echo [2/2] Starting Cloudflare Tunnel...
start /min "Cloudflare Tunnel" cmd /k "cloudflared tunnel --config %~dp0gateway\config.yaml --loglevel debug run aae93165-6564-4819-9742-8216fd9f2f01"

echo.
echo ================================================
echo   All Services Started Successfully!
echo ================================================
echo.
echo   Services running (minimized windows):
echo     - Logistar Platform   (http://localhost:5000)
echo       - FedEx Invoice Verification
echo       - WMS Dashboard (data collected every 10 min)
echo       - Turnover Analytics (backend on :8001)
echo     - Cloudflare Tunnel   (remote access)
echo.
echo   To stop: Close the minimized windows from taskbar
echo.
pause

@echo off
REM ================================================
REM Logistar Platform - Unified Startup Script
REM ================================================
REM Starts all services:
REM   1. WMS Monitor (data collector) - background process
REM   2. Logistar Platform (main Flask app on port 5000)
REM      - Turnover FastAPI backend auto-starts on port 8001
REM      - Background scheduler (WMS monitor, TMS export, Turnover sync)
REM   3. Cloudflare Tunnel (remote access)
REM ================================================

echo.
echo ================================================
echo   Logistar Platform v3.0 - Starting All Services
echo ================================================
echo.

REM --- 1. Start WMS Monitor data collector ---
echo [1/3] Starting WMS Monitor data collector...
start /min "WMS Monitor (Data Collector)" cmd /k "cd /d %~dp0services\wms-monitor && python wms_monitor.py"
timeout /t 2 /nobreak >nul

REM --- 2. Start Main Platform (Flask + Turnover backend) ---
echo [2/3] Starting Logistar Platform (port 5000)...
echo       Turnover backend will auto-start on port 8001
start /min "Logistar Platform" cmd /k "cd /d %~dp0gateway && python app.py"
timeout /t 5 /nobreak >nul

REM --- 3. Start Cloudflare Tunnel ---
echo [3/3] Starting Cloudflare Tunnel...
start /min "Cloudflare Tunnel" cmd /k "cloudflared tunnel --config %~dp0gateway\config.yaml --loglevel debug run aae93165-6564-4819-9742-8216fd9f2f01"

echo.
echo ================================================
echo   All Services Started Successfully!
echo ================================================
echo.
echo   Services running (minimized windows):
echo     - WMS Monitor         (data collection)
echo     - Logistar Platform   (http://localhost:5000)
echo       - FedEx Invoice Verification
echo       - WMS Dashboard
echo       - Turnover Analytics (backend on :8001)
echo     - Cloudflare Tunnel   (remote access)
echo.
echo   To stop: Close the minimized windows from taskbar
echo.
pause

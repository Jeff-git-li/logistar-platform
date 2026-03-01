# WMS Monitoring System

This folder contains all files related to WMS (Warehouse Management System) monitoring:

- **wms_monitor.py** - Selenium scraper that collects unpacked order data every 10 minutes
- **wms_dashboard.py** - Flask web dashboard displaying real-time and historical data
- **wms_counts.db** - SQLite database storing order counts and breakdowns
- **process_ds_labels.py** - DS label processing with carrier normalization
- **process_ds_labels_custom.py** - Custom DS label processing
- **start_ngrok.bat** - Script to expose dashboard via ngrok tunnel

## Setup

1. **Install dependencies:**
   ```
   pip install selenium webdriver-manager Flask
   ```

2. **Configure .env file** (in parent directory):
   ```
   WMS_URL=http://hx.wms.yunwms.com/
   WMS_USER=your_username
   WMS_PASS=your_password
   WMS_INTERVAL_MIN=10
   WMS_DEBUG=false
   ```

3. **Run the monitor:**
   ```
   python wms_monitor.py
   ```

4. **Run the dashboard:**
   ```
   python wms_dashboard.py
   ```

5. **Access locally:** http://localhost:5080

6. **Share remotely:** Run `start_ngrok.bat` (requires ngrok installed)

## Features

- Real-time unpacked order count
- Type breakdown (一票一件 vs 一票一件多个)
- Carrier breakdown (normalized: FedEx, UPS, USPS, etc.)
- Historical data (last 24 hours)
- Auto-refresh every 30 seconds
- Pacific Time timestamps

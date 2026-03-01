"""
TMS Bulk Export Tool
Exports all records or date-filtered records from TMS system

IMPORTANT DISCOVERY (2026-01-12):
When you click the export button (导出) WITHOUT selecting any checkboxes,
TMS will export ALL records (not just the current page), eliminating the
need for pagination loops. This makes exports much simpler and faster!

Usage:
- For full export: Set no filters, click export directly
- For date export: Set date filter, click export directly
- TMS handles the rest automatically
"""
import logging
import time
import os
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException

# Import from existing tms_scraper
from tms_scraper import (
    load_env_file, get_env, build_driver, login_tms, 
    navigate_to_order_list, parse_tms_excel
)
from tms_database import init_database, insert_records, get_database_stats

# Configure logging to handle Unicode on Windows
import sys
if sys.platform == 'win32':
    # Reconfigure stdout/stderr to use UTF-8
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')


def set_date_range(driver: webdriver.Chrome, start_time: str, end_time: str) -> bool:
    """
    Set date range filter in TMS order list
    
    Args:
        start_time: Start time in format "YYYY-MM-DD HH:mm:ss"
        end_time: End time in format "YYYY-MM-DD HH:mm:ss"
    
    Returns:
        True if successful
    """
    try:
        from datetime import datetime
        wait = WebDriverWait(driver, 30)
        
        logging.info(f"[DATE_RANGE] Setting date range: {start_time} to {end_time}")
        
        # Parse the dates to check if we can use quick selectors
        start_date = datetime.strptime(start_time.split()[0], "%Y-%m-%d")
        end_date = datetime.strptime(end_time.split()[0], "%Y-%m-%d")
        today = datetime.now().date()
        
        # Check if it's today or yesterday (single day)
        if start_date.date() == end_date.date():
            use_quick_selector = None
            if start_date.date() == today:
                use_quick_selector = "今天"
            elif (today - start_date.date()).days == 1:
                use_quick_selector = "昨天"
            
            if use_quick_selector:
                logging.info(f"[DATE_RANGE] Using quick selector: {use_quick_selector}")
                
                # Find the date range picker
                logging.info("[DATE_RANGE] Looking for date range picker...")
                date_picker = wait.until(EC.presence_of_element_located(
                    (By.CSS_SELECTOR, "span.ant-calendar-picker")))
                logging.info("[DATE_RANGE] Found picker, clicking input field...")
                
                # Try clicking the input field inside the picker
                try:
                    input_field = date_picker.find_element(By.CSS_SELECTOR, "input.ant-calendar-range-picker-input")
                    driver.execute_script("arguments[0].scrollIntoView(true);", input_field)
                    time.sleep(0.5)
                    driver.execute_script("arguments[0].click();", input_field)
                except Exception as e:
                    logging.error(f"[DATE_RANGE] Failed to click input field: {e}")
                    raise
                
                time.sleep(3)  # Wait for calendar to render
                
                # Wait for calendar to appear - check using JavaScript
                logging.info("[DATE_RANGE] Waiting for calendar popup...")
                calendar_visible = False
                for attempt in range(3):
                    try:
                        # Use JavaScript to check for calendar and quick selector
                        js_check = """
                        var containers = document.querySelectorAll('.ant-calendar-picker-container');
                        var quickBtns = document.querySelectorAll('.ant-tag.ant-tag-blue');
                        var result = {
                            containers: containers.length,
                            quickButtons: quickBtns.length,
                            containerVisible: false,
                            quickBtnText: []
                        };
                        for (var i = 0; i < containers.length; i++) {
                            var rect = containers[i].getBoundingClientRect();
                            if (rect.width > 0 && rect.height > 0) {
                                result.containerVisible = true;
                                break;
                            }
                        }
                        for (var i = 0; i < quickBtns.length; i++) {
                            result.quickBtnText.push(quickBtns[i].textContent);
                        }
                        return result;
                        """
                        result = driver.execute_script(js_check)
                        
                        if result['containerVisible'] and use_quick_selector in result['quickBtnText']:
                            calendar_visible = True
                            logging.info("[DATE_RANGE] ✓ Calendar popup visible")
                            break
                        
                        if not calendar_visible and attempt < 2:
                            driver.execute_script("arguments[0].click();", date_picker)
                            time.sleep(3)
                    except Exception as e:
                        logging.warning(f"[DATE_RANGE] Calendar check error: {e}")
                        if attempt < 2:
                            time.sleep(1)
                
                if not calendar_visible:
                    logging.error("[DATE_RANGE] Calendar popup did not become visible")
                    raise Exception("Calendar popup not visible")
                
                # Click the quick selector button using JavaScript
                try:
                    js_click_quick = f"""
                    var quickBtns = document.querySelectorAll('.ant-tag.ant-tag-blue');
                    for (var i = 0; i < quickBtns.length; i++) {{
                        if (quickBtns[i].textContent === '{use_quick_selector}') {{
                            quickBtns[i].click();
                            return true;
                        }}
                    }}
                    return false;
                    """
                    clicked = driver.execute_script(js_click_quick)
                    if clicked:
                        time.sleep(2)  # Wait for calendar to close automatically
                        logging.info(f"[DATE_RANGE] ✓ Date range set to '{use_quick_selector}'")
                        return True
                    else:
                        raise Exception(f"Could not find quick selector button '{use_quick_selector}'")
                except Exception as e:
                    logging.warning(f"[DATE_RANGE] Quick selector failed: {e}, falling back to manual entry")
        
        # Fall back to manual date entry
        logging.info("[DATE_RANGE] Using manual date entry...")
        
        # Find the date range picker - try multiple selectors
        logging.info("[DATE_RANGE] Looking for date range picker...")
        date_picker = None
        selectors = [
            "span.ant-calendar-picker",
            ".ant-calendar-picker-input",
            "input[placeholder*='时间']",
            ".ant-input"
        ]
        
        for selector in selectors:
            try:
                date_picker = wait.until(EC.presence_of_element_located(
                    (By.CSS_SELECTOR, selector)))
                logging.info(f"[DATE_RANGE] Found picker with selector: {selector}")
                break
            except:
                continue
        
        if not date_picker:
            logging.error("[DATE_RANGE] Could not find date picker")
            return False
        
        # Check if calendar is already open
        existing_calendar = driver.find_elements(By.CSS_SELECTOR, ".ant-calendar-picker-container")
        calendar_already_open = False
        if existing_calendar:
            for cal in existing_calendar:
                if cal.is_displayed():
                    calendar_already_open = True
                    break
        
        if calendar_already_open:
            logging.info("[DATE_RANGE] Calendar already open, proceeding...")
        else:
            logging.info("[DATE_RANGE] Clicking date range picker...")
            # Try clicking the input field directly instead of the span
            try:
                input_field = driver.find_element(By.CSS_SELECTOR, 
                    ".ant-calendar-picker-input input[placeholder='开始时间']")
                logging.info("[DATE_RANGE] Found start time input, clicking it...")
                driver.execute_script("arguments[0].scrollIntoView(true);", input_field)
                time.sleep(0.5)
                # Use ActionChains for a more realistic click
                from selenium.webdriver.common.action_chains import ActionChains
                ActionChains(driver).move_to_element(input_field).click().perform()
                time.sleep(2)
            except Exception as e:
                logging.warning(f"[DATE_RANGE] Could not click input field, trying span: {e}")
                driver.execute_script("arguments[0].scrollIntoView(true);", date_picker)
                time.sleep(0.5)
                driver.execute_script("arguments[0].click();", date_picker)
                time.sleep(2)
            
            # Wait for calendar popup to appear - it's absolutely positioned outside app div
            logging.info("[DATE_RANGE] Waiting for calendar popup (absolute positioned)...")
            calendar_appeared = False
            for attempt in range(3):
                try:
                    # Find all calendar containers and check if any have size (more reliable)
                    calendars = driver.find_elements(By.CSS_SELECTOR, ".ant-calendar-picker-container")
                    for cal in calendars:
                        # Check if element has actual dimensions
                        size = cal.size
                        if size['width'] > 0 and size['height'] > 0:
                            calendar_appeared = True
                            logging.info(f"[DATE_RANGE] Calendar popup visible (size: {size['width']}x{size['height']}, attempt {attempt + 1})")
                            break
                    
                    if calendar_appeared:
                        break
                        
                    if attempt < 2:
                        logging.info(f"[DATE_RANGE] Calendar not visible, trying to click again...")
                        # Try clicking the parent span
                        try:
                            parent_span = driver.find_element(By.CSS_SELECTOR, "span.ant-calendar-picker")
                            ActionChains(driver).move_to_element(parent_span).click().perform()
                            time.sleep(2.5)
                        except:
                            driver.execute_script("arguments[0].click();", date_picker)
                            time.sleep(2.5)
                except Exception as e:
                    logging.warning(f"[DATE_RANGE] Attempt {attempt + 1} error: {e}")
                    if attempt < 2:
                        time.sleep(1)
            
            if not calendar_appeared:
                logging.error("[DATE_RANGE] Calendar popup did not appear after 3 attempts")
                return False
        
        # Find start time input (first input in the calendar)
        logging.info("[DATE_RANGE] Setting start time...")
        start_inputs = driver.find_elements(By.CSS_SELECTOR, 
            ".ant-calendar-input.ant-input")
        
        if len(start_inputs) >= 2:
            # Clear and set start time
            start_input = start_inputs[0]
            driver.execute_script("arguments[0].value = '';", start_input)
            driver.execute_script(f"arguments[0].value = '{start_time}';", start_input)
            
            # Clear and set end time
            end_input = start_inputs[1]
            driver.execute_script("arguments[0].value = '';", end_input)
            driver.execute_script(f"arguments[0].value = '{end_time}';", end_input)
            
            logging.info(f"[DATE_RANGE] Start time set: {start_time}")
            logging.info(f"[DATE_RANGE] End time set: {end_time}")
            
            # Click OK button to confirm
            logging.info("[DATE_RANGE] Looking for OK button...")
            ok_button = wait.until(EC.element_to_be_clickable(
                (By.CSS_SELECTOR, ".ant-calendar-ok-btn")))
            driver.execute_script("arguments[0].click();", ok_button)
            
            logging.info("[DATE_RANGE] Date range set successfully")
            time.sleep(2)
            return True
        else:
            logging.error("[DATE_RANGE] Could not find date inputs")
            return False
            
    except Exception as e:
        logging.error(f"[DATE_RANGE] Failed to set date range: {e}")
        return False


def export_without_search(driver: webdriver.Chrome, use_date_range: bool = False, 
                         start_time: str = None, end_time: str = None) -> Optional[str]:
    """
    Export all records without searching (or with date filter)
    
    NOTE: Clicking the export button (导出) directly without selecting checkboxes
    will export ALL records, not just the current page. No need for pagination loop!
    
    Args:
        driver: Selenium WebDriver
        use_date_range: Whether to filter by date range
        start_time: Start time in format "YYYY-MM-DD HH:mm:ss"
        end_time: End time in format "YYYY-MM-DD HH:mm:ss"
    
    Returns:
        Path to downloaded Excel file
    """
    start = time.time()
    
    try:
        wait = WebDriverWait(driver, 60)
        
        # If date range specified, set it
        if use_date_range and start_time and end_time:
            if not set_date_range(driver, start_time, end_time):
                raise Exception("Failed to set date range")
            
            # The quick selector already filters - no need to click search button
            logging.info("[EXPORT] Date filter applied via quick selector, waiting for results...")
            time.sleep(5)  # Wait for results to load
        
        # Step 1: Click export button directly (no need to select checkboxes or change pagination)
        # When no records are selected, clicking export will export ALL filtered records
        logging.info("[EXPORT] Clicking export button to export all filtered records...")
        time.sleep(2)
        
        export_btn = wait.until(EC.element_to_be_clickable(
            (By.XPATH, "//button[contains(@class, 'sblingBtn')]//span[text()='导出']")))
        driver.execute_script("arguments[0].click();", export_btn)
        logging.info("[EXPORT] ✓ Export button clicked - will export all filtered records")
        time.sleep(2)
        
        # Step 2: Select export sections
        export_sections = [
            '订单信息', '收件人信息', '发件人信息', '箱子信息',
            '申报信息', '应收费用', '应付费用'
        ]
        
        logging.info(f"[EXPORT] Selecting export sections: {', '.join(export_sections)}...")
        for section in export_sections:
            try:
                checkbox_label = wait.until(EC.element_to_be_clickable(
                    (By.XPATH, f"//div[@class='sonTitle']//label[contains(@class, 'ant-checkbox-wrapper')]//span[contains(text(), '{section}')]")))
                
                parent_label = checkbox_label.find_element(By.XPATH, "./ancestor::label[contains(@class, 'ant-checkbox-wrapper')]")
                is_checked = 'ant-checkbox-wrapper-checked' in parent_label.get_attribute('class')
                
                if not is_checked:
                    driver.execute_script("arguments[0].click();", checkbox_label)
                    
                time.sleep(0.3)
            except Exception as e:
                logging.warning(f"[EXPORT] Could not select {section}: {e}")
        
        logging.info("[EXPORT] ✓ Export sections selected")
        
        # Step 3: Confirm export
        logging.info("[EXPORT] Looking for export confirmation button...")
        confirm_export_btn = wait.until(EC.element_to_be_clickable(
            (By.XPATH, "//button[contains(@class, 'ant-btn-primary')]//span[text()='导 出']")))
        driver.execute_script("arguments[0].click();", confirm_export_btn)
        logging.info("[EXPORT] ✓ Export confirmed, waiting for TMS to process...")
        time.sleep(5)
        
        # Step 4: Open notification center
        try:
            # Check if notification panel is already open
            existing_panel = driver.find_elements(By.CSS_SELECTOR, ".ant-drawer-open, .ant-drawer-content")
            if not existing_panel:
                bell_icon = wait.until(EC.element_to_be_clickable(
                    (By.XPATH, "//i[@aria-label='图标: bell' and contains(@class, 'anticon-bell')]")))
                driver.execute_script("arguments[0].click();", bell_icon)
                time.sleep(2)
        except:
            time.sleep(1)
        
        # Step 5: Click work tasks tab
        try:
            work_tasks_tab = wait.until(EC.element_to_be_clickable(
                (By.XPATH, "//div[@role='tab']//div[contains(text(), '工作任务')]")))
            driver.execute_script("arguments[0].click();", work_tasks_tab)
        except:
            # Try alternative selector
            try:
                work_tasks_tab = wait.until(EC.element_to_be_clickable(
                    (By.XPATH, "//div[contains(@class, 'ant-tabs-tab') and contains(., '工作任务')]")))
                driver.execute_script("arguments[0].click();", work_tasks_tab)
            except:
                pass  # Tab might already be active
        
        time.sleep(3)
        
        # Step 6: Wait for export to complete and get download link
        logging.info("[EXPORT] Waiting for export to complete...")
        
        max_wait_export = 60  # Wait up to 60 seconds for export to complete
        export_completed = False
        
        for i in range(max_wait_export):
            # Click manual refresh button to update task status
            try:
                refresh_btn = driver.find_element(
                    By.XPATH,
                    "//button[contains(@class, 'ant-btn')]//span[text()='手动刷新']"
                )
                driver.execute_script("arguments[0].click();", refresh_btn)
                time.sleep(1)
            except:
                time.sleep(1)
            
            # Look for completed export tasks
            try:
                completed_tasks = driver.find_elements(
                    By.XPATH, 
                    "//li[contains(@class, 'ant-list-item')][.//span[contains(@class, 'ant-tag') and text()='已完成']]//a[text()='下载']"
                )
                
                if completed_tasks:
                    logging.info(f"[EXPORT] ✓ Export completed! Found {len(completed_tasks)} completed task(s)")
                    export_completed = True
                    break
            except:
                pass
        
        if not export_completed:
            logging.error("[EXPORT] ✗ Export did not complete within 60 seconds")
            raise Exception("Export timeout - task did not complete")
        
        # Now get the download link for the most recent completed task
        download_links = driver.find_elements(
            By.XPATH,
            "//li[contains(@class, 'ant-list-item')][.//span[contains(@class, 'ant-tag') and text()='已完成']]//a[text()='下载']"
        )
        
        if not download_links:
            logging.error("[EXPORT] ✗ No download links found even though export completed")
            raise Exception("No download link found in task list")
        
        logging.info(f"[EXPORT] ✓ Found {len(download_links)} download link(s), clicking first one (most recent)...")
        
        # Get downloads folder
        downloads_folder = os.path.join(os.path.expanduser('~'), 'Downloads')
        existing_files = set(os.listdir(downloads_folder))
        
        driver.execute_script("arguments[0].click();", download_links[0])
        logging.info("[EXPORT] ✓ Download initiated, monitoring Downloads folder...")
        
        # Step 7: Wait for file to download
        timeout = 60
        for i in range(timeout):
            time.sleep(1)
            current_files = set(os.listdir(downloads_folder))
            new_files = current_files - existing_files
            
            for file in new_files:
                if file.endswith('.xlsx') and '订单列表导出' in file:
                    file_path = os.path.join(downloads_folder, file)
                    logging.info(f"[EXPORT] ✓ Found new file: {file}")
                    logging.info(f"[EXPORT] ✓ Download completed: {file}")
                    
                    elapsed = time.time() - start
                    logging.info(f"[EXPORT] Total export time: {elapsed:.1f}s")
                    
                    return file_path
        
        raise Exception(f"Download did not complete within {timeout} seconds")
        
    except Exception as e:
        logging.error(f"[EXPORT] Failed: {e}")
        raise

def send_notification(message: str, is_error: bool = False):
    """
    Send notification (email/webhook) on script completion or failure
    Configure via environment variables:
    - NOTIFICATION_EMAIL: Email to send notifications
    - NOTIFICATION_WEBHOOK: Webhook URL for notifications
    """
    email = get_env("NOTIFICATION_EMAIL")
    webhook = get_env("NOTIFICATION_WEBHOOK")
    
    if not email and not webhook:
        return
    
    subject = "[TMS Export] Error" if is_error else "[TMS Export] Success"
    
    # Email notification (requires smtp configuration)
    if email:
        try:
            import smtplib
            from email.message import EmailMessage
            
            smtp_server = get_env("SMTP_SERVER", "smtp.gmail.com")
            smtp_port = int(get_env("SMTP_PORT", "587"))
            smtp_user = get_env("SMTP_USER")
            smtp_pass = get_env("SMTP_PASS")
            
            if smtp_user and smtp_pass:
                msg = EmailMessage()
                msg.set_content(message)
                msg['Subject'] = subject
                msg['From'] = smtp_user
                msg['To'] = email
                
                with smtplib.SMTP(smtp_server, smtp_port) as server:
                    server.starttls()
                    server.login(smtp_user, smtp_pass)
                    server.send_message(msg)
                    logging.info("✓ Email notification sent")
        except Exception as e:
            logging.warning(f"Failed to send email notification: {e}")
    
    # Webhook notification
    if webhook:
        try:
            import urllib.request
            import json
            
            data = json.dumps({
                'text': f"{subject}\n{message}",
                'status': 'error' if is_error else 'success'
            }).encode('utf-8')
            
            req = urllib.request.Request(webhook, data=data, headers={'Content-Type': 'application/json'})
            urllib.request.urlopen(req, timeout=10)
            logging.info("✓ Webhook notification sent")
        except Exception as e:
            logging.warning(f"Failed to send webhook notification: {e}")


def daily_export_previous_day(username: str = None, password: str = None, 
                             target_date: datetime = None) -> int:
    """
    Export records from previous day (in China timezone) and save to database
    
    Args:
        target_date: Date to export (defaults to yesterday in China timezone)
    
    Returns:
        Number of records inserted into database
    """
    load_env_file()
    
    username = username or get_env("TMS_USER")
    password = password or get_env("TMS_PASS")
    
    if not username or not password:
        raise ValueError("TMS_USER and TMS_PASS must be set in .env file")
    
    # Calculate date range (China timezone is UTC+8)
    if target_date is None:
        # Get yesterday in China timezone
        from datetime import timezone
        china_tz = timezone(timedelta(hours=8))
        china_now = datetime.now(china_tz)
        target_date = china_now - timedelta(days=1)
    
    start_time = target_date.replace(hour=0, minute=0, second=0).strftime("%Y-%m-%d %H:%M:%S")
    end_time = target_date.replace(hour=23, minute=59, second=59).strftime("%Y-%m-%d %H:%M:%S")
    
    driver = None
    try:
        logging.info("="*60)
        logging.info(f"DAILY EXPORT: Exporting records for {target_date.strftime('%Y-%m-%d')}")
        logging.info(f"  Date range: {start_time} to {end_time}")
        logging.info("="*60)
        
        # Initialize database
        init_database()
        
        # Build driver and login
        driver = build_driver(headless=True)
        
        if not login_tms(driver, username, password):
            raise Exception("Login failed")
        
        if not navigate_to_order_list(driver):
            raise Exception("Navigation failed")
        
        # Export with date range filter - all records in one go!
        logging.info("[DAILY_EXPORT] Exporting all records for date range in single export...")
        excel_path = export_without_search(driver, use_date_range=True, 
                                          start_time=start_time, end_time=end_time)
        
        # Parse Excel file
        logging.info(f"[DAILY_EXPORT] Parsing Excel file: {excel_path}")
        all_records = parse_tms_excel(excel_path)
        
        if not all_records:
            logging.warning("[DAILY_EXPORT] No records found for this date")
            return 0
        
        logging.info(f"[DAILY_EXPORT] Found {len(all_records)} total records")
        
        # Insert all records into database
        logging.info(f"[DAILY_EXPORT] Inserting {len(all_records)} records into database...")
        inserted = insert_records(all_records)
        
        # Show statistics
        stats = get_database_stats()
        logging.info("="*60)
        logging.info("✓ DAILY EXPORT COMPLETED")
        logging.info(f"  Records inserted: {inserted}")
        logging.info(f"  Total in database: {stats['total_records']}")
        logging.info(f"  Unique tracking #s: {stats['unique_tracking_numbers']}")
        logging.info("="*60)
        
        # Send success notification
        send_notification(
            f"Daily export completed successfully\n"
            f"Records inserted: {inserted}\n"
            f"Total in database: {stats['total_records']}\n"
            f"Date: {target_date.strftime('%Y-%m-%d')}"
        )
        
        return inserted
        
    except Exception as e:
        error_msg = f"Daily export failed: {e}\nDate: {target_date.strftime('%Y-%m-%d') if target_date else 'N/A'}"
        logging.error(error_msg)
        send_notification(error_msg, is_error=True)
        raise
    finally:
        if driver:
            try:
                driver.quit()
            except:
                pass


def import_excel_file(excel_path: str) -> int:
    """
    Import an existing TMS Excel file directly into the database
    Useful for bulk importing historical data
    
    Args:
        excel_path: Path to the Excel file to import
        
    Returns:
        Number of records inserted into database
    """
    from pathlib import Path
    
    try:
        excel_file = Path(excel_path)
        
        if not excel_file.exists():
            raise FileNotFoundError(f"Excel file not found: {excel_path}")
        
        logging.info("="*60)
        logging.info(f"IMPORT EXCEL: Importing records from file")
        logging.info(f"  File: {excel_file.name}")
        logging.info(f"  Size: {excel_file.stat().st_size / 1024 / 1024:.2f} MB")
        logging.info("="*60)
        
        # Initialize database
        init_database()
        
        # Parse Excel file
        logging.info("[IMPORT] Parsing Excel file...")
        all_records = parse_tms_excel(excel_path)
        
        if not all_records:
            logging.warning("[IMPORT] No records found in Excel file")
            return 0
        
        logging.info(f"[IMPORT] ✓ Parsed {len(all_records)} records from Excel")
        
        # Insert all records into database
        logging.info(f"[IMPORT] Inserting {len(all_records)} records into database...")
        inserted = insert_records(all_records)
        
        # Show statistics
        stats = get_database_stats()
        logging.info("="*60)
        logging.info("✓ IMPORT COMPLETED")
        logging.info(f"  Records parsed: {len(all_records)}")
        logging.info(f"  Records inserted: {inserted}")
        logging.info(f"  Total in database: {stats['total_records']}")
        logging.info(f"  Unique tracking #s: {stats['unique_tracking_numbers']}")
        logging.info("="*60)
        
        # Send success notification
        send_notification(
            f"Excel import completed successfully\n"
            f"File: {excel_file.name}\n"
            f"Records inserted: {inserted}\n"
            f"Total in database: {stats['total_records']}"
        )
        
        return inserted
        
    except Exception as e:
        error_msg = f"Excel import failed: {e}"
        logging.error(error_msg)
        send_notification(error_msg, is_error=True)
        raise


if __name__ == '__main__':
    import sys
    import io
    
    # Force UTF-8 encoding for stdout to handle Unicode characters
    if sys.platform == 'win32':
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=True)
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s %(levelname)s: %(message)s',
        handlers=[logging.StreamHandler(sys.stdout)]
    )
    
    # Check command line arguments
    if len(sys.argv) > 1:
        mode = sys.argv[1]
        
        if mode == 'daily':
            # Run daily export
            daily_export_previous_day()
        elif mode == 'import':
            # Import existing Excel file
            if len(sys.argv) < 3:
                print("Error: Please provide Excel file path")
                print("Usage: python tms_bulk_export.py import <excel_file_path>")
                sys.exit(1)
            excel_path = sys.argv[2]
            import_excel_file(excel_path)
        else:
            print("Usage:")
            print("  python tms_bulk_export.py daily             - Export previous day's records from TMS")
            print("  python tms_bulk_export.py import <file>     - Import existing Excel file into database")
            print("")
            print("Example:")
            print('  python tms_bulk_export.py import "C:\\Users\\Downloads\\订单列表导出.xlsx"')
    else:
        print("Usage:")
        print("  python tms_bulk_export.py daily             - Export previous day's records from TMS")
        print("  python tms_bulk_export.py import <file>     - Import existing Excel file into database")
        print("")
        print("Example:")
        print('  python tms_bulk_export.py import "C:\\Users\\Downloads\\订单列表导出.xlsx"')

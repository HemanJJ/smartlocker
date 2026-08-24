@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Admin\Desktop\kiosk-print-poller.ps1" -NoPrint > "C:\Users\Admin\Desktop\poller.log" 2>&1

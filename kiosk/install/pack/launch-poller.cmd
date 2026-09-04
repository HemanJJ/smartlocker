@echo off
rem kiosk poller COM3 hidden
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\Users\Admin\Desktop\kiosk-print-poller.ps1" -SerialPort COM3 > "C:\Users\Admin\Desktop\poller.log" 2>&1

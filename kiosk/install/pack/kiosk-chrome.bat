@echo off
rem Chrome kiosk launcher (robust): kill existing chrome, clean kiosk profile
taskkill /IM chrome.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk "https://shop.dearfly.com.tw/" --disable-context-menu --no-first-run --disable-session-crashed-bubble --overscroll-history-navigation=0 --disable-pinch --user-data-dir="C:\Users\Admin\kiosk-profile"

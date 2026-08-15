@echo off
REM ============================================================
REM  start-kiosk.bat  -  Chrome kiosk watchdog loop
REM
REM  Waits for SkbBridge to answer, then launches Chrome in
REM  kiosk mode. If Chrome is closed or crashes, it restarts.
REM
REM  Edit CHROME below if Chrome is installed elsewhere.
REM  Win7 supports Chrome up to version 109.
REM
REM  NOTE: ASCII-only on purpose. See README-kiosk.md for the
REM        Chinese explanation of every flag.
REM ============================================================

title Kiosk Watchdog
cd /d "%~dp0"

set "URL=http://localhost:8080/"
set "PROFILE=%~dp0chrome-profile"

set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo [ERROR] Chrome not found. Edit CHROME= in this file.
  pause
  exit /b 1
)

REM ---- wait for the bridge to come up (max 60s) ----
echo Waiting for SkbBridge on %URL% ...
set /a tries=0
:wait
set /a tries+=1
ping -n 2 127.0.0.1 >nul
powershell -NoProfile -Command "try{(New-Object Net.WebClient).DownloadString('http://localhost:8080/health')|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 goto ready
if %tries% GEQ 30 (
  echo [WARN] Bridge did not answer. Starting Chrome anyway ^(DEMO mode^).
  goto ready
)
goto wait

:ready
echo Bridge is up. Launching kiosk...

:loop
REM Clear the "Restore pages?" bubble left behind by an unclean exit
if exist "%PROFILE%\Default\Preferences" (
  powershell -NoProfile -Command "$p='%PROFILE%\Default\Preferences';$j=Get-Content $p -Raw;$j=$j -replace '\"exit_type\":\"[^\"]*\"','\"exit_type\":\"Normal\"';Set-Content $p $j -NoNewline" >nul 2>&1
)

"%CHROME%" ^
  --kiosk ^
  --app=%URL% ^
  --user-data-dir="%PROFILE%" ^
  --no-first-run ^
  --no-default-browser-check ^
  --disable-infobars ^
  --disable-session-crashed-bubble ^
  --disable-translate ^
  --disable-features=TranslateUI,Translate ^
  --disable-pinch ^
  --overscroll-history-navigation=0 ^
  --noerrdialogs ^
  --check-for-update-interval=31536000

echo [%date% %time%] Chrome exited. Restarting in 3s...
timeout /t 3 /nobreak >nul
goto loop

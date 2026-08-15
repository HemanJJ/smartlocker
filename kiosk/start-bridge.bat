@echo off
REM ============================================================
REM  start-bridge.bat  -  SkbBridge watchdog loop
REM
REM  Keeps SkbBridge.exe running. If it crashes or is closed,
REM  it restarts after 5 seconds.
REM
REM  Run this with Administrator rights (HttpListener needs it),
REM  or register the urlacl once - see README-kiosk.md.
REM
REM  NOTE: this file is intentionally ASCII-only. Chinese text in
REM        .bat files renders as garbage under the Windows console
REM        codepage. All explanations live in README-kiosk.md.
REM ============================================================

title SkbBridge Watchdog
cd /d "%~dp0"

:loop
echo.
echo [%date% %time%] Starting SkbBridge...
SkbBridge.exe
echo [%date% %time%] SkbBridge exited (code %errorlevel%). Restarting in 5s...
timeout /t 5 /nobreak >nul
goto loop

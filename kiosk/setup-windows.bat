@echo off
REM ============================================================
REM  setup-windows.bat  -  one-time Windows 7 kiosk hardening
REM
REM  RUN AS ADMINISTRATOR. Run once, then reboot.
REM
REM  What it does:
REM    1. Never turn off monitor / sleep / hibernate / spin down disk
REM    2. Disable the screen saver and its "require password" lock
REM    3. Register the HttpListener URL so SkbBridge can run
REM       without Administrator rights afterwards
REM    4. Stop Windows Update from rebooting on its own
REM
REM  What it does NOT do (must be done by hand, see README):
REM    - auto-login  (run: netplwiz)
REM    - AnyDesk "lock account on session end"  (AnyDesk settings)
REM
REM  NOTE: ASCII-only on purpose - Chinese in .bat renders as
REM        garbage under the Windows console codepage.
REM ============================================================

net session >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Please right-click this file and "Run as administrator".
  pause
  exit /b 1
)

echo.
echo === 1/4  Power settings: never sleep, never blank ===
powercfg -change -monitor-timeout-ac 0
powercfg -change -monitor-timeout-dc 0
powercfg -change -standby-timeout-ac 0
powercfg -change -standby-timeout-dc 0
powercfg -change -disk-timeout-ac 0
powercfg -change -hibernate-timeout-ac 0

echo.
echo === 2/4  Screen saver off, no lock on resume ===
reg add "HKCU\Control Panel\Desktop" /v ScreenSaveActive     /t REG_SZ /d 0 /f >nul
reg add "HKCU\Control Panel\Desktop" /v ScreenSaverIsSecure  /t REG_SZ /d 0 /f >nul
reg add "HKCU\Control Panel\Desktop" /v ScreenSaveTimeOut    /t REG_SZ /d 0 /f >nul
echo    done.

echo.
echo === 3/4  Reserve HTTP port 8080 for SkbBridge ===
netsh http add urlacl url=http://localhost:8080/ user=Everyone
netsh http add urlacl url=http://127.0.0.1:8080/ user=Everyone
echo    ^(An "already exists" error here is harmless.^)

echo.
echo === 4/4  Windows Update: download but never auto-reboot ===
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" /v NoAutoRebootWithLoggedOnUsers /t REG_DWORD /d 1 /f >nul
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" /v AUOptions /t REG_DWORD /d 3 /f >nul
echo    done.

echo.
echo ============================================================
echo  Done. Two things still need doing by hand:
echo    A) Auto-login       : run  netplwiz   and untick the
echo                          "users must enter a password" box
echo    B) AnyDesk          : Settings - Security - untick
echo                          "Lock account on session end"
echo  Then reboot.
echo ============================================================
pause

@echo off
REM ============================================================
REM  1-diagnose.bat  -  ONE CLICK diagnostic.
REM
REM  v2 CHANGE: the log filename now carries a timestamp, so
REM             running it twice NEVER overwrites the first log.
REM             Old behaviour lost the "before wire swap" run.
REM
REM  Usage:   double-click it
REM           1-diagnose.bat COM3
REM           1-diagnose.bat COM3 greenA      <- optional label,
REM                                              ASCII only, no spaces
REM
REM  Output:  diag_<label>_<YYYYMMDD_HHMMSS>.txt
REM  Then send that one file back. Nothing to read on screen.
REM
REM  ASCII-only on purpose (Chinese breaks in the console).
REM ============================================================

setlocal enabledelayedexpansion
cd /d "%~dp0"

set "PORT=%~1"
if "%PORT%"=="" set "PORT=COM3"

set "LABEL=%~2"
if "%LABEL%"=="" set "LABEL=run"

REM ---- locale-independent timestamp via wmic ----
set "STAMP="
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value 2^>nul') do set "DT=%%I"
if defined DT set "STAMP=!DT:~0,8!_!DT:~8,6!"
if not defined STAMP set "STAMP=nodate"

set "LOG=diag_%LABEL%_%STAMP%.txt"

cls
echo.
echo   ============================================
echo     SKB DIAGNOSTIC v2  -  port: %PORT%
echo   ============================================
echo.
echo     Log file: %LOG%
echo     ^(timestamped - it will NOT overwrite old logs^)
echo.
echo     Running. Takes about 2 minutes.
echo     Nothing to read here - just wait.
echo.
echo     *** At the LISTEN step it will ask you to press
echo         the RESET button on the board. Watch for it. ***
echo.

REM ---------- find csc.exe ----------
set "CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"

REM ---------- everything below goes to the log ----------
(
  echo ==================================================
  echo  SKB DIAGNOSTIC LOG v2
  echo ==================================================
  echo Date: %date%  Time: %time%
  echo Port requested: %PORT%
  echo Wiring label: %LABEL%
  echo Folder: %CD%
  echo.

  echo === [1] Windows version ===
  ver
  echo.

  echo === [2] .NET Framework ===
  reg query "HKLM\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" /v Release 2>&1
  reg query "HKLM\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" /v Version 2>&1
  echo.

  echo === [3] Serial ports ===
  wmic path Win32_PnPEntity where "Caption like '%%(COM%%'" get Caption /value 2>&1
  echo.

  echo === [4] Compile ===
  if not exist "%CSC%" (
    echo [FAIL] csc.exe not found
  ) else (
    "%CSC%" /nologo /utf8output /codepage:65001 /target:exe /out:SkbProbe.exe Program.cs UpusSkb.cs 2>&1
    echo compile exit code: !errorlevel!
    "%CSC%" /nologo /utf8output /codepage:65001 /target:exe /out:SkbBridge.exe SkbBridge.cs SheetSync.cs UpusSkb.cs 2>&1
    echo compile exit code: !errorlevel!
  )
  echo.

  echo === [5] RAW - send 3 frames, any bytes back? ===
  if exist SkbProbe.exe SkbProbe.exe %PORT% raw 2>&1
  echo.
) > "%LOG%" 2>&1

REM ---------- LISTEN needs the user to press a button, so it
REM            runs on screen AND is appended to the log ----------
cls
echo.
echo   ============================================
echo     STEP 6 of 8  -  LISTEN TEST
echo   ============================================
echo.
echo     This one needs you.
echo.
echo     For the next 20 seconds, go press the RESET
echo     button on the lock board a few times.
echo     ^(or hold the "open all" button^)
echo.
echo     This tests whether the board can talk TO the PC,
echo     which is a different wire path than PC-to-board.
echo.
pause

(
  echo === [6] LISTEN - receive only, no transmit ===
  echo -- user was asked to press RESET on the board during this
) >> "%LOG%" 2>&1
if exist SkbProbe.exe SkbProbe.exe %PORT% listen 20 >> "%LOG%" 2>&1

cls
echo.
echo     Thanks. Finishing the last two tests...
echo.

(
  echo.
  echo === [7] SWEEP - 5 baud rates ===
  if exist SkbProbe.exe SkbProbe.exe %PORT% sweep 2>&1
  echo.

  echo === [8] SIM self-test ^(proves software is OK^) ===
  if exist SkbProbe.exe SkbProbe.exe sim demo 2>&1
  echo.

  echo ==================================================
  echo  END OF LOG
  echo ==================================================
) >> "%LOG%" 2>&1

cls
echo.
echo   ============================================
echo     DONE.
echo   ============================================
echo.
echo     Created:  %CD%\%LOG%
echo.
echo     Send that ONE file back. That's all.
echo     You don't need to read it.
echo.
echo     Old logs are kept - nothing was overwritten.
echo.
dir /b diag_*.txt
echo.
pause

@echo off
REM ============================================================
REM  1-diagnose.bat  -  ONE CLICK. Collects everything into
REM                     diag-log.txt, then stops.
REM
REM  Usage:   double-click it.
REM           optional:  1-diagnose.bat COM5
REM
REM  Then send diag-log.txt back. Nothing to read on screen.
REM
REM  ASCII-only on purpose (Chinese breaks in the console).
REM ============================================================

setlocal enabledelayedexpansion
cd /d "%~dp0"

set "PORT=%~1"
if "%PORT%"=="" set "PORT=COM3"
set "LOG=diag-log.txt"

cls
echo.
echo   ============================================
echo     SKB DIAGNOSTIC  -  port: %PORT%
echo   ============================================
echo.
echo     Running. Takes about 1-2 minutes.
echo     Nothing to read here - just wait.
echo.

REM ---------- find csc.exe ----------
set "CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"

REM ---------- everything below goes to the log ----------
(
  echo ==================================================
  echo  SKB DIAGNOSTIC LOG
  echo ==================================================
  echo Date: %date%  Time: %time%
  echo Port requested: %PORT%
  echo Folder: %CD%
  echo.

  echo === [1] Windows version ===
  ver
  echo.

  echo === [2] .NET Framework installed ===
  echo -- Framework64 folder:
  if exist "%WINDIR%\Microsoft.NET\Framework64" dir /b "%WINDIR%\Microsoft.NET\Framework64"
  echo -- v4 Full Release key ^(378389+ means 4.5 or newer^):
  reg query "HKLM\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" /v Release 2>&1
  reg query "HKLM\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" /v Version 2>&1
  echo.

  echo === [3] Serial ports present ===
  wmic path Win32_PnPEntity where "Caption like '%%(COM%%'" get Caption /value 2>&1
  echo -- mode output:
  mode 2>&1
  echo.

  echo === [4] Files in this folder ===
  dir /b
  echo.

  echo === [5] Compile ===
  echo CSC = %CSC%
  if not exist "%CSC%" (
    echo [FAIL] csc.exe not found - .NET Framework 4.x missing
  ) else (
    "%CSC%" /nologo /utf8output /codepage:65001 /target:exe /out:SkbProbe.exe Program.cs UpusSkb.cs 2>&1
    echo compile exit code: !errorlevel!
    "%CSC%" /nologo /utf8output /codepage:65001 /target:exe /out:SkbBridge.exe SkbBridge.cs SheetSync.cs UpusSkb.cs 2>&1
    echo compile exit code: !errorlevel!
  )
  echo.

  echo === [6] Simulator self-test ^(no hardware needed^) ===
  echo -- if this fails, the problem is software, not wiring
  if exist SkbProbe.exe SkbProbe.exe sim demo 2>&1
  echo.

  echo === [7] RAW - any bytes coming back at all? ===
  echo -- 0 bytes    = wiring problem ^(A/B swapped, GND, broken wire^)
  echo -- garbage    = wiring OK, wrong baud rate
  echo -- 55 A1 ...  = comms fine
  if exist SkbProbe.exe SkbProbe.exe %PORT% raw 2>&1
  echo.

  echo === [8] SWEEP - try 5 baud rates ===
  if exist SkbProbe.exe SkbProbe.exe %PORT% sweep 2>&1
  echo.

  echo === [9] PROBE - full board check at 9600 ===
  if exist SkbProbe.exe SkbProbe.exe %PORT% probe 2>&1
  echo.

  echo ==================================================
  echo  END OF LOG
  echo ==================================================
) > "%LOG%" 2>&1

cls
echo.
echo   ============================================
echo     DONE.
echo   ============================================
echo.
echo     Created:  %CD%\%LOG%
echo.
echo     Send that one file back. That's all.
echo     You don't need to read it.
echo.
pause

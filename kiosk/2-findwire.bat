@echo off
REM ============================================================
REM  2-findwire.bat  -  BENCH TOOL. Board in front of you.
REM
REM  Recompiles, then starts continuous detection.
REM  It BEEPS when the wiring is right, so you can watch your
REM  hands instead of the screen.
REM
REM  Just move wires. No typing, no re-running.
REM  Ctrl+C to stop.
REM
REM  ASCII-only on purpose.
REM ============================================================

cd /d "%~dp0"
set "PORT=%~1"
if "%PORT%"=="" set "PORT=COM3"

set "CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"

echo Compiling...
"%CSC%" /nologo /utf8output /codepage:65001 /target:exe /out:SkbProbe.exe Program.cs UpusSkb.cs
if errorlevel 1 (
  echo [FAIL] compile error
  pause
  exit /b 1
)

SkbProbe.exe %PORT% hunt
pause

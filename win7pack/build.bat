@echo off
REM ==================================================
REM  SkbProbe ���g�_����Win7 �Ƚ� csc.exe�����b Visual Studio��
REM  ֱ���p���@���n���͕����g�� SkbProbe.exe
REM ==================================================

set CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if exist "%CSC%" goto FOUND
set CSC=C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe
if exist "%CSC%" goto FOUND

echo [�e�`] �Ҳ��� csc.exe��Ո�Ȱ��b .NET Framework 4.x
pause
exit /b 1

:FOUND
echo ʹ�þ��g��: %CSC%
echo.
"%CSC%" /nologo /utf8output /codepage:65001 /target:exe /out:SkbProbe.exe Program.cs UpusSkb.cs
if errorlevel 1 goto FAIL
"%CSC%" /nologo /utf8output /codepage:65001 /target:winexe /out:SkbPanel.exe SkbPanel.cs UpusSkb.cs
if errorlevel 1 goto FAIL
"%CSC%" /nologo /utf8output /codepage:65001 /target:exe /out:SkbBridge.exe SkbBridge.cs SheetSync.cs UpusSkb.cs
if errorlevel 1 goto FAIL

echo.
echo [�ɹ�] ���g��ɣ�SkbProbe.exe
echo.
echo ��Ӳ�w����ģ�M��ԇԇ��
echo     SkbProbe.exe sim demo
echo.
pause
exit /b 0

:FAIL
echo.
echo [ʧ��] ���gʧ�����������ӍϢ���Ղ��o��
pause
exit /b 1

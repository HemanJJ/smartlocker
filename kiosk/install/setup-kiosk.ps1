# =====================================================================
#  setup-kiosk.ps1 — 智慧拍櫃 kiosk 一鍵裝機（在乾淨的 Win10/11 上執行）
#  把一台新的 Windows 變成「羽拍有約 24h 無人拍櫃」kiosk：
#    Chrome kiosk 全螢幕 → 鎖控板 poller(RS-485) → 標籤列印 → watchdog
#  使用（右鍵「以系統管理員身分執行 PowerShell」）：
#    powershell -ExecutionPolicy Bypass -File setup-kiosk.ps1 -Password 123456
#  重跑安全（idempotent）——複製會覆蓋、任務用 /F 重建。
# =====================================================================
param(
  [string]$KioskUser = 'Admin',        # 本機使用者（自動登入＋排程用）
  [string]$Password   = '123456',      # 該使用者密碼（自動登入需要）
  [string]$StoreName  = '太平永成店',   # 店名（印標籤用，poller 內也可改）
  [switch]$SkipChromeInstall
)
$ErrorActionPreference = 'Stop'
$me = $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $me
$pack = Join-Path $root 'pack'

# ---- 1) 確認系統管理員 ----
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host '需要系統管理員權限。請用右鍵「以系統管理員身分執行 PowerShell」再跑。' -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $pack)) { Write-Host "找不到 pack 資料夾（應與本腳本同層）：$pack" -ForegroundColor Red; exit 1 }

Write-Host '=== 1) 檢查/安裝 Chrome ===' -ForegroundColor Cyan
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path $chrome) -and -not $SkipChromeInstall) {
  try { winget install -e --id Google.Chrome --silent --accept-package-agreements --accept-source-agreements | Out-Null }
  catch { Write-Host 'winget 安裝 Chrome 失敗，請自行安裝 Chrome 後再跑。' -ForegroundColor Yellow }
}

# ---- 2) 建資料夾 + 複製母版 ----
Write-Host '=== 2) 複製 kiosk 執行檔 ===' -ForegroundColor Cyan
$userProfile = Join-Path 'C:\Users' $KioskUser
$desktop     = Join-Path $userProfile 'Desktop'
$kioskDir    = 'C:\kiosk'
if (-not (Test-Path $userProfile)) { Write-Host "找不到使用者 $userProfile（請先建立該使用者）" -ForegroundColor Red; exit 1 }
New-Item -ItemType Directory -Force -Path $desktop, (Join-Path $desktop 'kiosk-voice'), $kioskDir | Out-Null

# C:\kiosk\kiosk-shell.vbs（Chrome kiosk 保活）
Copy-Item (Join-Path $pack 'kiosk-shell.vbs') "$kioskDir\kiosk-shell.vbs" -Force
Write-Host "  ✓ C:\kiosk\kiosk-shell.vbs"

# Desktop 上的執行檔（.vbs/.bat/.cmd/.ps1），kiosk-shell.vbs 除外（它去 C:\kiosk）
Get-ChildItem $pack -File | Where-Object { $_.Name -ne 'kiosk-shell.vbs' -and $_.Extension -in '.vbs','.bat','.cmd','.ps1' } | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $desktop $_.Name) -Force
  Write-Host "  ✓ Desktop\$($_.Name)"
}
# 語音檔
Get-ChildItem (Join-Path $pack 'kiosk-voice') -Filter '*.wav' -File | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $desktop "kiosk-voice\$($_.Name)") -Force
}
Write-Host "  ✓ kiosk-voice\*.wav（$( (Get-ChildItem (Join-Path $desktop 'kiosk-voice') -Filter *.wav).Count ) 個）"

# ---- 3) 自動登入（Admin / 密碼） ----
Write-Host '=== 3) 設定自動登入 ===' -ForegroundColor Cyan
$wl = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
New-Item -Path $wl -Force | Out-Null
Set-ItemProperty -Path $wl -Name AutoAdminLogon -Value '1' -Type String
Set-ItemProperty -Path $wl -Name DefaultUserName -Value $KioskUser -Type String
Set-ItemProperty -Path $wl -Name DefaultPassword -Value $Password -Type String
Set-ItemProperty -Path $wl -Name DefaultDomainName -Value $env:COMPUTERNAME -Type String

# ---- 4) 電源永不睡 / 關閉鎖屏 / 螢幕保護 ----
Write-Host '=== 4) 電源永不睡＋鎖屏關閉 ===' -ForegroundColor Cyan
powercfg /change standby-timeout-ac 0 | Out-Null
powercfg /change monitor-timeout-ac 0 | Out-Null
powercfg /change hibernate-timeout-ac 0 | Out-Null
powercfg /change disk-timeout-ac 0 | Out-Null
New-Item -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization' -Name NoLockScreen -Value 1 -Type DWord
New-Item -Path 'HKCU:\Control Panel\Desktop' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name ScreenSaveActive -Value '0' -Type String

# ---- 5) 建立排程任務（重跑用 /F 覆蓋） ----
Write-Host '=== 5) 建立排程任務 ===' -ForegroundColor Cyan
function New-Task($tn, $sc, $mo, $tr) {
  if ($mo) {
    schtasks.exe /Create /F /TN $tn /SC $sc /MO $mo /RU $KioskUser /RP $Password /TR $tr 2>&1 | Out-Null
  } else {
    schtasks.exe /Create /F /TN $tn /SC $sc /RU $KioskUser /RP $Password /TR $tr 2>&1 | Out-Null
  }
  Write-Host "  ✓ $tn ($sc)"
}
New-Task 'KioskShell'            'ONLOGON' $null "wscript.exe `"$kioskDir\kiosk-shell.vbs`""
New-Task 'KioskPrintPoller'      'ONLOGON' $null "wscript.exe `"$desktop\launch-poller-hidden.vbs`""
New-Task 'KioskPollerWatchdog'   'MINUTE' 1 "wscript.exe `"$desktop\watchdog-hidden.vbs`""

# ---- 6) 立刻啟動 poller（watchdog 1 分鐘內也會接管） ----
Write-Host '=== 6) 啟動 poller ===' -ForegroundColor Cyan
Start-Process wscript -ArgumentList "$desktop\launch-poller-hidden.vbs" -WindowStyle Hidden

# ---- 7) 硬體偵測報告 ----
Write-Host ''
Write-Host '=== 7) 硬體偵測 ===' -ForegroundColor Cyan
$prn = Get-Printer -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Gprinter' }
if ($prn) { Write-Host "  ✓ 印表機: $($prn.Name)" } else { Write-Host '  ✗ 未見 Gprinter 印表機 → 需安裝 Gprinter GP-3120TN 驅動' -ForegroundColor Yellow }
$com = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'CH340|USB-SERIAL' }
if ($com) { Write-Host "  ✓ 鎖控板串口: $($com.Name)" } else { Write-Host '  ✗ 未見 CH340/USB-SERIAL → 請插上 USB-485 並安裝 CH340 驅動(drivers/WCH.CN)' -ForegroundColor Yellow }
if (Test-Path $chrome) { Write-Host '  ✓ Chrome 已安裝' } else { Write-Host '  ✗ Chrome 未安裝 → 重跑或自行安裝' -ForegroundColor Yellow }

Write-Host ''
Write-Host '========== 安裝完成 ==========' -ForegroundColor Green
Write-Host "使用者: $KioskUser（自動登入）  店名: $StoreName"
Write-Host '排程: KioskShell(登入) / KioskPrintPoller(登入) / KioskPollerWatchdog(每1分)'
Write-Host '重開機後即進入 kiosk。要驗證串口請開 poller.log 看「開始輪詢」。'

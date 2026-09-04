# watchdog-poller.ps1 — 每分鐘檢查 kiosk poller 是否活著，死了就自動重啟（走 VBS 隱藏啟動，不冒視窗）
$proc = Get-CimInstance Win32_Process -Filter "name='powershell.exe'" | Where-Object { $_.CommandLine -like '*kiosk-print-poller*' }
if (-not $proc) {
  Start-Process wscript -ArgumentList 'C:\Users\Admin\Desktop\launch-poller-hidden.vbs' -WindowStyle Hidden
}

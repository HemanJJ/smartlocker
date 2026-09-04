# launch-kiosk.ps1 - kill chrome, reset profile, launch kiosk, force foreground
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$url = 'https://shop.dearfly.com.tw/'
$prof = 'C:\Users\Admin\kiosk-profile'

taskkill /IM chrome.exe /F 2>$null | Out-Null
Start-Sleep -Milliseconds 800
if (Test-Path $prof) { Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue }

Start-Process $chrome -ArgumentList '--kiosk',$url,'--disable-context-menu','--no-first-run','--disable-session-crashed-bubble','--overscroll-history-navigation=0','--disable-pinch',"--user-data-dir=$prof"
Start-Sleep -Seconds 4

Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class W{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);}'
$p = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) {
  [W]::ShowWindow($p.MainWindowHandle, 9)   # SW_RESTORE
  [W]::SetForegroundWindow($p.MainWindowHandle)
  Write-Host 'Kiosk foreground OK, hwnd=' $p.MainWindowHandle
} else {
  Write-Host 'No chrome window found'
}

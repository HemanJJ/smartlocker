# uninstall-kingsoft.ps1 — 移除金山毒霸 / 新毒霸（含自保護處理）
# 用法（kiosk 上，以系統管理員身份）：
#   powershell -ExecutionPolicy Bypass -File uninstall-kingsoft.ps1
# 移除完建議重開機，之後再用「程式與功能」確認是否清乾淨。

$ErrorActionPreference = 'SilentlyContinue'

Write-Host "=== 1) 停掉金山相關程序（解除自保護） ==="
$procs = @(
  'kxetray','kxescore','kxedefend','kprotect','ksoftmgr','ksafe',
  'kwsprotect64','ksapi','kxesapp','kxeweb','kupdata','kavstart','kavsvc',
  'KxLive.exe','KxStart.exe'
)
foreach ($p in $procs) {
  taskkill /F /IM "$p.exe" 2>$null | Out-Null
}

Write-Host "=== 2) 從登錄檔找解除安裝字串 ==="
$roots = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$entries = Get-ItemProperty $roots -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -match '金山|毒霸|Kingsoft|kismain|新毒霸' }

if (-not $entries) {
  Write-Host "找不到金山相關的解除安裝項目（可能已移除，或裝在非標準位置）。"
  Write-Host "請改用「程式與功能」手動檢查。"
  exit 0
}

foreach ($e in $entries) {
  Write-Host ("找到：{0}" -f $e.DisplayName)
  $cmd = $e.UninstallString
  Write-Host ("  UninstallString: {0}" -f $cmd)
  if ($cmd) {
    $cmd = $cmd -replace '^"|"$', ''
    Write-Host "  執行解除安裝（加 /S 靜默，若跳出視窗需手動按確認）..."
    try {
      Start-Process -FilePath $cmd -ArgumentList '/S' -Wait
      Write-Host "  已觸發：$cmd"
    } catch {
      Write-Host ("  執行失敗：{0}" -f $_.Exception.Message)
    }
  }
}

Write-Host "=== 3) 清常見殘留目錄 ==="
$dirs = @(
  "$env:ProgramFiles\kingsoft",
  "${env:ProgramFiles(x86)}\kingsoft",
  "$env:ProgramFiles\金山毒霸",
  "${env:ProgramFiles(x86)}\金山毒霸",
  "$env:LOCALAPPDATA\kingsoft"
)
foreach ($d in $dirs) {
  if (Test-Path $d) {
    Write-Host "刪除目錄：$d"
    Remove-Item -Recurse -Force $d -ErrorAction SilentlyContinue
  }
}

Write-Host "=== 完成。請重開機，再到「程式與功能」確認沒有金山殘留。 ==="

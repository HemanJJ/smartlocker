# kiosk-print-poller.ps1 — poll print-jobs → print label (print-label.ps1) → open slot → mark done
# Runs on the Win10 kiosk (no node needed). Base URL = deployed backend.
param(
  [string]$Base = "https://shop.dearfly.com.tw",
  [string]$Store = "太平永成店",
  [string]$StoreEn = "Pai store",
  [string]$Printer = "Gprinter GP-3120TN",
  [string]$LockBridge = "http://192.168.0.178:4321",  # mock board (sim). Real kiosk: point to SkbBridge or RS-485.
  [int]$IntervalMs = 3000,
  [switch]$Once                                        # run one pass and exit (demo/verification)
)

$ScriptFile = Join-Path $PSScriptRoot "print-label.ps1"

function Send-Unlock([int]$slotNo) {
  try {
    # build frame: 55 A1 addr func=0xE2 len=1 data=slotNo + XOR
    $addr = 1
    $bytes = @(0x55, 0xA1, $addr, 0xE2, 1, $slotNo)
    $xor = 0
    foreach ($b in $bytes) { $xor = $xor -bxor $b }
    $bytes = $bytes + @($xor -band 0xFF)
    $hex = ($bytes | ForEach-Object { $_.ToString("X2") }) -join ""
    $body = @{ hex = $hex } | ConvertTo-Json
    Invoke-RestMethod -Method POST -Uri "$LockBridge/rs485" -Body $body -ContentType "application/json" -TimeoutSec 5 | Out-Null
    Write-Host "  [開格] 格$slotNo → TX $hex"
  } catch {
    Write-Host "  [開格] 格$slotNo 失敗: $($_.Exception.Message)"
  }
}

Write-Host "[poller] 開始輪詢 $Base/api/print-jobs (Store=$Store, interval=${IntervalMs}ms)"
while ($true) {
  try {
    # 用 HttpWebRequest + UTF8 抓 API（正確解碼中文，例如 color「白」；避開 Invoke-RestMethod 的誤解碼）
    $req = [System.Net.HttpWebRequest]::Create("$Base/api/print-jobs?status=pending")
    $req.Method = 'GET'
    $req.Timeout = 10000
    $req.UserAgent = 'kiosk-poller'
    $resp = $req.GetResponse()
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
    $json = $reader.ReadToEnd()
    $r = $json | ConvertFrom-Json
    if ($r.ok -and $r.jobs) {
      foreach ($job in $r.jobs) {
        $L = $job.label
        $line1 = if ($L.color) { "$($L.model) $($L.color)" } else { $L.model }
        $line2 = "$($L.tension) lbs"
        $line3 = 'NT$' + $L.price
        $line4 = "取件號 $($L.pickupCode)"
        $cfg = @{ store = $Store; storeEn = $StoreEn; line1 = $line1; line2 = $line2; line3 = $line3; line4 = $line4; printer = $Printer }
        $tmp = Join-Path $env:TEMP "label-$($L.pickupCode).json"
        $cfg | ConvertTo-Json | Set-Content -Path $tmp -Encoding UTF8
        Write-Host "[交拍] 單號 $($L.orderNo) 取件碼 $($L.pickupCode) 格$($L.slotNo)"
        & powershell -NoProfile -ExecutionPolicy Bypass -File $ScriptFile -ConfigFile $tmp
        Send-Unlock ([int]$L.slotNo)
        Invoke-RestMethod -Method POST -Uri "$Base/api/print-jobs/$($job.id)/done" -TimeoutSec 10 | Out-Null
        Write-Host "[交拍] ✓ 完成（已印＋開格$($L.slotNo)）"
      }
    }
  } catch {
    Write-Host "[poller] 錯誤: $($_.Exception.Message)"
  }
  if ($Once) { break }
  Start-Sleep -Milliseconds $IntervalMs
}

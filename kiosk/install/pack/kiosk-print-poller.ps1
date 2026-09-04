# kiosk-print-poller.ps1 — poll print-jobs → print label (print-label.ps1) → open slot → mark done
# Runs on the Win10 kiosk (no node needed). Base URL = deployed backend.
param(
  [string]$Base = "https://shop.dearfly.com.tw",
  [string]$Store = "太平永成店",
  [string]$StoreEn = "Pai store",
  [string]$Printer = "Gprinter GP-3120TN",
  [string]$LockBridge = "http://192.168.0.178:4321",  # mock board (sim). 模擬橋（SerialPort 設 none 才用）
  [string]$SerialPort = "COM3",                        # 實體鎖控板 USB-485 串口；設 "" 或 none = 走模擬橋
  [int]$Baud = 9600,                                   # RS-485 預設 9600-N-8-1
  [int]$IntervalMs = 3000,
  [switch]$Once,                                        # run one pass and exit (demo/verification)
  [switch]$NoPrint                                      # 印表機拿走時設此開關 → 略過列印(其餘照常)
)

$ScriptFile = Join-Path $PSScriptRoot "print-label.ps1"

function Send-Unlock([int]$slotNo) {
  # build frame: 55 A1 addr func=0xE2 len=1 data=slotNo + XOR
  $addr = 1
  $bytes = @(0x55, 0xA1, $addr, 0xE2, 1, $slotNo)
  $xor = 0
  foreach ($b in $bytes) { $xor = $xor -bxor $b }
  $frame = $bytes + @($xor -band 0xFF)
  $hex = ($frame | ForEach-Object { $_.ToString("X2") }) -join ""

  $useSerial = -not [string]::IsNullOrEmpty($SerialPort) -and ($SerialPort -ine "none")
  if ($useSerial) {
    # 實體鎖控板：直接對 COM 送 RS-485 幀＋讀回應
    $sp = New-Object System.IO.Ports.SerialPort($SerialPort, $Baud, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
    try {
      $sp.ReadTimeout = 1000
      $sp.WriteTimeout = 1000
      $sp.Open()
      $sp.Write([byte[]]$frame, 0, $frame.Count)
      Start-Sleep -Milliseconds 300
      $rx = New-Object System.Collections.Generic.List[byte]
      while ($sp.BytesToRead -gt 0) { $rx.Add([byte]$sp.ReadByte()) }
      $rxHex = ($rx | ForEach-Object { $_.ToString("X2") }) -join " "
      Write-Host "  [開格] 格$slotNo → $SerialPort TX $hex  RX $rxHex"
    } catch {
      Write-Host "  [開格] 格$slotNo 串口失敗($SerialPort@$Baud): $($_.Exception.Message)"
    } finally {
      if ($sp.IsOpen) { $sp.Close() }
    }
  } else {
    # 模擬橋：HTTP /rs485（測試用，SerialPort 設 none 才走這條）
    try {
      $body = @{ hex = $hex } | ConvertTo-Json
      Invoke-RestMethod -Method POST -Uri "$LockBridge/rs485" -Body $body -ContentType "application/json" -TimeoutSec 5 | Out-Null
      Write-Host "  [開格] 格$slotNo → TX $hex"
    } catch {
      Write-Host "  [開格] 格$slotNo 失敗: $($_.Exception.Message)"
    }
  }
}

# 播放 kiosk 語音（SoundPlayer，非同步不卡流程）。wav 放在 <scripts>\kiosk-voice\
function Play-Sound([string]$name) {
  try {
    $p = Join-Path $PSScriptRoot "kiosk-voice\$name.wav"
    if (Test-Path $p) {
      (New-Object System.Media.SoundPlayer $p).Play()
      Write-Host "  [語音] 🔊 $name"
    }
  } catch { /* 忽略語音錯誤 */ }
}

# 中文語音播報（Windows TTS，同步）——不需要 wav 檔
function Speak([string]$text) {
  try {
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $synth.SetOutputToDefaultAudioDevice()
    $synth.Speak($text)
    $synth.Dispose()
  } catch { /* 忽略語音錯誤 */ }
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
        $slot = "格 $($L.slotNo)"
        $note = if ($L.note) { $L.note.Substring(0, [Math]::Min(5, $L.note.Length)) } else { '' }
        $cfg = @{ store = $Store; storeEn = $StoreEn; line1 = $line1; line2 = $line2; line3 = $line3; line4 = $line4; slot = $slot; note = $note; printer = $Printer }
        $tmp = Join-Path $env:TEMP "label-$($L.pickupCode).json"
        $cfg | ConvertTo-Json | Set-Content -Path $tmp -Encoding UTF8
        Write-Host "[交拍] 單號 $($L.orderNo) 取件碼 $($L.pickupCode) 格$($L.slotNo)"
        if (-not $NoPrint) {
          # 以 CreateNoWindow 真正無視窗執行印貼紙（避免在全螢幕冒 cmd/powershell 黑窗嚇到客人）
          $psi = New-Object System.Diagnostics.ProcessStartInfo
          $psi.FileName = 'powershell.exe'
          $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptFile`" -ConfigFile `"$tmp`""
          $psi.UseShellExecute = $false
          $psi.CreateNoWindow = $true
          $pp = [System.Diagnostics.Process]::Start($psi)
          $pp.WaitForExit()
        }
        # 放拍語音由網頁「綁定完成」時播（anon-order + wait-open）；此處不再播，避免與網頁重複
        Send-Unlock ([int]$L.slotNo)
        Invoke-RestMethod -Method POST -Uri "$Base/api/print-jobs/$($job.id)/done" -TimeoutSec 10 | Out-Null
        Write-Host "[交拍] ✓ 完成（$($L.orderNo)，印=$(-not $NoPrint)，開格$($L.slotNo)）"
      }
    }

    # ── 開格（取件 / 員工取件）：輪詢 cell_commands → 開格 → 回報完成 ──
    $creq = [System.Net.HttpWebRequest]::Create("$Base/api/cell-commands?status=pending")
    $creq.Method = 'GET'
    $creq.Timeout = 10000
    $creq.UserAgent = 'kiosk-poller'
    $cresp = $creq.GetResponse()
    $creader = New-Object System.IO.StreamReader($cresp.GetResponseStream(), [System.Text.Encoding]::UTF8)
    $cjson = $creader.ReadToEnd()
    $cr = $cjson | ConvertFrom-Json
    if ($cr.ok -and $cr.commands) {
      foreach ($cmd in $cr.commands) {
        Write-Host "[開格] 指令 $($cmd.id) → 格$($cmd.slotNo)"
        # 開格前播放語音：等待櫃門開啟
        Play-Sound "wait-open"
        Send-Unlock ([int]$cmd.slotNo)
        Invoke-RestMethod -Method POST -Uri "$Base/api/cell-commands/$($cmd.id)/done" -TimeoutSec 10 | Out-Null
        Write-Host "[開格] ✓ 完成（格$($cmd.slotNo)）"
      }
    }
  } catch {
    Write-Host "[poller] 錯誤: $($_.Exception.Message)"
  }
  if ($Once) { break }
  Start-Sleep -Milliseconds $IntervalMs
}

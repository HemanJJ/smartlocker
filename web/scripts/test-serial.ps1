# test-serial.ps1 - single E2 unlock frame to RS-485 board (ASCII only)
param([int]$Slot = 1, [string]$Port = "COM3", [int]$Baud = 9600, [int]$Addr = 1)
$bytes = @(0x55, 0xA1, $Addr, 0xE2, 1, $Slot)
$x = 0
foreach ($b in $bytes) { $x = $x -bxor $b }
$frame = $bytes + @($x -band 0xFF)
$hex = ($frame | ForEach-Object { $_.ToString("X2") }) -join ""

$sp = New-Object System.IO.Ports.SerialPort($Port, $Baud, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
$sp.ReadTimeout = 1500
$sp.WriteTimeout = 1500
$sp.Open()
$sp.Write([byte[]]$frame, 0, $frame.Count)
Start-Sleep -Milliseconds 500
$rx = New-Object System.Collections.Generic.List[byte]
while ($sp.BytesToRead -gt 0) { $rx.Add([byte]$sp.ReadByte()) }
$rxHex = ($rx | ForEach-Object { $_.ToString("X2") }) -join " "
Write-Host ("TX " + $hex + "  RX [" + $rxHex + "]  (RX bytes: " + $rx.Count + ")")
$sp.Close()

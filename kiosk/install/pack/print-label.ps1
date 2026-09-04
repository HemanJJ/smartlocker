# print-label.ps1 — render label (Traditional Chinese via Windows font) + print via Seagull driver
# EDIT the params below to change the text (this is your "editor": change a value, re-run).
# Store names (太平永成店 / 長壽店 ...) all render fine because we use the Windows Chinese font.
param(
  [string]$Printer = "Gprinter GP-3120TN",
  [string]$Store = "太平永成店",        # Chinese store name (line 3 right)
  [string]$StoreEn = "Pai store",       # English store name (line 2 right)
  [string]$Line1 = "YOUNG66 RED",       # 線種+色 (line 1)
  [string]$Line2 = "24 lbs",            # 磅數 (line 2 left)
  [string]$Line3 = 'NT$250',            # 金額 (line 3 left)
  [string]$Line4 = "取件號 924588",      # 取件號 (line 4)
  [string]$Slot = "格 5",                # slot number (line 4 right)
  [string]$Note = "",                    # optional remark (right of line 1)
  [string]$ConfigFile = ""              # optional JSON config (poller uses this; avoids CLI escaping)
)

# If a config JSON is supplied, it overrides the params above (fields: printer,store,storeEn,line1..line4,slot).
if ($ConfigFile -and (Test-Path $ConfigFile)) {
  $cfg = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($cfg.printer)  { $Printer = [string]$cfg.printer }
  if ($cfg.store)    { $Store = [string]$cfg.store }
  if ($cfg.storeEn)  { $StoreEn = [string]$cfg.storeEn }
  if ($cfg.line1)    { $Line1 = [string]$cfg.line1 }
  if ($cfg.line2)    { $Line2 = [string]$cfg.line2 }
  if ($cfg.line3)    { $Line3 = [string]$cfg.line3 }
  if ($cfg.line4)    { $Line4 = [string]$cfg.line4 }
  if ($cfg.slot)     { $Slot = [string]$cfg.slot }
  if ($cfg.note)     { $Note = [string]$cfg.note }
}

Add-Type -AssemblyName System.Drawing

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $Printer

# Use the DRIVER's built-in paper size so orientation/scale match the label.
$ps = New-Object System.Drawing.Printing.PrinterSettings
$ps.PrinterName = $Printer
$paper = $ps.PaperSizes | Where-Object { $_.PaperName -eq "40 mm x 30 mm" } | Select-Object -First 1
if ($paper -eq $null) {
  $w100 = [int][Math]::Round(40 / 25.4 * 100)
  $h100 = [int][Math]::Round(30 / 25.4 * 100)
  $paper = New-Object System.Drawing.Printing.PaperSize("Label", $w100, $h100)
}
$doc.DefaultPageSettings.PaperSize = $paper
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

$script:store = $Store
$script:storeEn = $StoreEn
$script:l1 = $Line1
$script:l2 = $Line2
$script:l3 = $Line3
$script:l4 = $Line4
$script:slot = $Slot
$script:note = $Note

$doc.add_PrintPage({
  param($s, $e)
  $g = $e.Graphics
  $g.PageUnit = [System.Drawing.GraphicsUnit]::Millimeter
  $g.Clear([System.Drawing.Color]::White)
  $brush = [System.Drawing.Brushes]::Black
  $f8  = New-Object System.Drawing.Font("Microsoft JhengHei", 8)
  $f9b = New-Object System.Drawing.Font("Microsoft JhengHei", 9, [System.Drawing.FontStyle]::Bold)
  $f10 = New-Object System.Drawing.Font("Microsoft JhengHei", 10)

  # Line 1: 線種+色 (8pt) + optional note on the right (整版面左移 2mm)
  $g.DrawString($script:l1, $f8, $brush, 0, 2)
  if ($script:note) {
    $w1 = $g.MeasureString($script:l1, $f8).Width
    $g.DrawString($script:note, $f8, $brush, (0 + $w1 + 1), 2)
  }
  # Line 2: 磅數 + English store  (9pt, same size)
  $g.DrawString($script:l2, $f9b, $brush, 0, 9)
  $g.DrawString($script:storeEn, $f9b, $brush, 19, 9)
  # Line 3: 金額 + Chinese store  (8pt)
  $g.DrawString($script:l3, $f8, $brush, 0, 16)
  $g.DrawString($script:store, $f8, $brush, 20, 16)
  # Line 4: 取件號 (10pt, one level bigger) + 格號 on the right
  $g.DrawString($script:l4, $f10, $brush, 0, 23)
  if ($script:slot) {
    $w4 = $g.MeasureString($script:l4, $f10).Width
    $g.DrawString($script:slot, $f8, $brush, (0 + $w4 + 1), 24)
  }
})

$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$doc.Print()
Write-Host "Sent label to '$Printer' (store=$Store / $StoreEn)"


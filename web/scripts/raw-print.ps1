# raw-print.ps1 — send TSPL raw to Gprinter GP-3120TN (USB001)
# NOTE 2026-08-23: this printer has single-byte FONT 0-8 only (NO built-in Chinese font)
# and it does NOT accept the BITMAP command, so Chinese via raw TSPL is impossible.
# -> This label is English/pinyin only. For Chinese use the Gprinter Windows driver
#    or a downloaded TSS24 Chinese font (NEXT STEP).
param(
  [string]$PrinterName = "Gprinter GP-3120TN",
  [string]$TspText = ""
)

if (-not $TspText) {
  $cmds = @(
    'SIZE 40 mm, 30 mm',
    'GAP 2 mm, 0',
    'DENSITY 15',
    'DIRECTION 1',
    'CLS',
    'TEXT 10,30,"3",0,1,1,"YOUNG66 RED"',
    'TEXT 10,80,"3",0,1,1,"24 lbs"',
    'TEXT 10,130,"3",0,1,1,"NT$250"',
    'TEXT 10,185,"3",0,1,1,"924588"',
    'TEXT 150,100,"2",0,1,1,"Pai store"',
    'TEXT 150,125,"2",0,1,1,"TAIPING"',
    'PRINT 1'
  )
  $TspText = ($cmds -join "`r`n") + "`r`n"
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string p, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr h, int level, ref DOCINFO d);
  [DllImport("winspool.drv")]
  public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv")]
  public static extern bool WritePrinter(IntPtr h, byte[] b, int c, out int w);
  [DllImport("winspool.drv")]
  public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv")]
  public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv")]
  public static extern bool ClosePrinter(IntPtr h);

  public static bool Send(string printer, string text) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return false;
    var di = new DOCINFO { pDocName = "TSPL", pDataType = "RAW" };
    if (!StartDocPrinter(h, 1, ref di)) { ClosePrinter(h); return false; }
    StartPagePrinter(h);
    int written;
    var enc = System.Text.Encoding.GetEncoding(936);
    var bytes = enc.GetBytes(text);
    WritePrinter(h, bytes, bytes.Length, out written);
    EndPagePrinter(h);
    EndDocPrinter(h);
    ClosePrinter(h);
    return true;
  }
}
"@

$ok = [RawPrinter]::Send($PrinterName, $TspText)
if ($ok) {
  Write-Host "OK: TSPL sent (chars=$($TspText.Length))"
} else {
  Write-Host "FAIL: could not send. Check printer name / port."
}

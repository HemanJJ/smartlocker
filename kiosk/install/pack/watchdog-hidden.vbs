' watchdog-hidden.vbs — 以隱藏視窗啟動 poller watchdog，避免每分鐘冒 powershell 視窗
' WshShell.Run command, 0(隱藏), False(不等待)
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """powershell.exe"" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""C:\Users\Admin\Desktop\watchdog-poller.ps1""", 0, False

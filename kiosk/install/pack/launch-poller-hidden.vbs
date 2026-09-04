' launch-poller-hidden.vbs — 以隱藏視窗啟動 poller(launch-poller.cmd)，不冒 cmd 視窗
' WshShell.Run command, 0(隱藏), False(不等待)
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """cmd.exe"" /c ""C:\Users\Admin\Desktop\launch-poller.cmd""", 0, False

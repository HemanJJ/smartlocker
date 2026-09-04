' kiosk-shell.vbs - launch Chrome kiosk, auto-relaunch, no console window
Set WshShell = CreateObject("WScript.Shell")
Do
  WshShell.Run """C:\Program Files\Google\Chrome\Application\chrome.exe"" --kiosk ""https://shop.dearfly.com.tw/"" --disable-context-menu --no-first-run --disable-session-crashed-bubble --overscroll-history-navigation=0 --disable-pinch --lang=zh-TW --disable-features=TranslateUI --disable-notifications --user-data-dir=""C:\Users\Admin\kiosk-profile""", 1, True
  WScript.Sleep 2000
Loop

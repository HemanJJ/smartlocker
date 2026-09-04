# kiosk 一鍵裝機（setup-kiosk）

把一台**乾淨的 Windows 10/11** 變成「羽拍有約 24h 無人拍櫃」kiosk,一鍵完成:
Chrome kiosk 全螢幕 + RS-485 鎖控板 poller + 標籤列印 + watchdog 保活 + 自動登入。

## 怎麼用(新機器)
1. 先準備:
   - 建本機使用者 `Admin`(密碼例如 `123456`),並把它加入系統管理員群組。
   - **先裝印表機驅動**(Gprinter GP-3120TN / Seagull)與 **CH340 USB-485 驅動**(repo 的 `drivers/WCH.CN`);插上 USB-485 確認出現 `COM3`。
   - 把本資料夾(`kiosk/install/`)整個複製到新機,例如 `C:\kiosk-setup\`。
2. 右鍵開始 →「Windows PowerShell(系統管理員)」,執行:
   ```powershell
   cd C:\kiosk-setup
   powershell -ExecutionPolicy Bypass -File setup-kiosk.ps1 -Password 123456
   ```
   (密碼 = Admin 的密碼;店名預設太平永成店,可在 poller 內改。)
3. 重開機 → 自動登入 → Chrome kiosk 全螢幕 + poller 開始輪詢。看 `Desktop\poller.log` 有「開始輪詢」即成功。

> 重跑安全:會覆蓋檔案、`/F` 重建排程,不會裝兩份。

## 腳本做的事
| 項目 | 內容 |
|---|---|
| 複製檔 | `pack\*.ps1/.cmd/.bat/.vbs` → `Desktop`;`kiosk-shell.vbs` → `C:\kiosk`;語音 → `Desktop\kiosk-voice\` |
| 自動登入 | Winlogon `AutoAdminLogon=1`(Admin/密碼) |
| 電源/鎖屏 | 永不睡眠、關閉鎖屏、關螢幕保護 |
| 排程任務 | `KioskShell`(登入→Chrome kiosk 保活)、`KioskPrintPoller`(登入)、`KioskPollerWatchdog`(每 1 分鐘檢查 poller) |
| 啟動 | 立刻跑 launch-poller-hidden.vbs |
| 偵測 | 回報 Gprinter / CH340 / Chrome 是否就緒 |

## pack\ 內容(由現役 kiosk 匯出,勿手動改名)
- `kiosk-print-poller.ps1` 輪詢 print-jobs + cell-commands → 印標籤、RS-485 開鎖(COM3)
- `print-label.ps1` 印 40x30 標籤(StandardPrintController 靜默)
- `launch-poller.cmd` / `launch-poller-hidden.vbs` 隱藏啟動 poller(→ poller.log)
- `watchdog-poller.ps1` / `watchdog-hidden.vbs` 每分鐘檢查、死掉就重啟
- `kiosk-shell.vbs`(→ C:\kiosk)Chrome kiosk 保活迴圈
- `launch-kiosk.ps1` 重啟 Chrome 到 kiosk 模式(排障用)
- `kiosk-chrome.bat` / `kiosk-chrome-hidden.vbs` 另一支 Chrome 啟動器
- `kiosk-voice\*.wav` kiosk 語音

## 硬體建議(24h 無人店)
- 現役是 2011 老筆電(i7-2675QM/8G/SSD),效能足夠,但建議下一台用**無風扇迷你機(N100/N305 等級)**,並先清風扇/換散熱膏。
- 電源建議接 UPS 或確認插座穩定(曾紀錄到不正常斷電)。

# Win7 智慧拍櫃 Kiosk 建置手冊

從一台乾淨的 Win7 到「插電就自己跑起來、客人碰不出去」的完整步驟。
照順序做，每一步都有驗收方式。

---

## 0. 先確認機器條件

| 項目 | 要求 | 怎麼確認 |
|---|---|---|
| 作業系統 | Win7 SP1 | 「我的電腦」右鍵 → 內容 |
| .NET Framework | **4.5 以上** | 控制台 → 解除安裝程式，找 `.NET Framework 4.x` |
| 瀏覽器 | **Chrome 109** | Win7 最後支援的版本，110 以後裝不上 |
| CH340 驅動 | 已安裝 | 裝置管理員 → 連接埠 (COM 和 LPT) 看得到 COM 埠 |

> ⚠️ **.NET 4.5 這條很重要**。Google 強制 TLS 1.2，而 .NET 4.0 預設只談到
> TLS 1.0。機器上沒有 4.5 以上，Google Sheet 取件碼會一直同步失敗。
> （開鎖不受影響，但拿不到新碼。）

---

## 1. 檔案擺放

在 C 槽建一個資料夾，把東西擺成這樣：

```
C:\kiosk\
├── SkbBridge.exe            ← build.bat 編譯出來的
├── SkbProbe.exe             ← 驗板工具，排查 485 用
├── SkbPanel.exe             ← 視覺化驗板面板
├── sheet.ini                ← 設定檔（串口、Google Sheet 網址）
├── cells.csv                ← 格號 → 板位址/通道 映射
├── setup-windows.bat        ← 一次性系統設定
├── start-bridge.bat         ← 橋接服務（含當掉自動重啟）
├── start-kiosk.bat          ← Chrome kiosk（含當掉自動重啟）
└── web\
    └── index.html           ← kiosk 網頁
```

**`index.html` 一定要放進 `web\` 子資料夾**。SkbBridge 會從那裡供應網頁，
kiosk 就能用 `http://localhost:8080/` 開啟——同源載入，不會遇到
瀏覽器擋 `file://` 連 localhost 的問題。

---

## 2. 一次性系統設定

對 `setup-windows.bat` 按右鍵 → **以系統管理員身分執行**。

它會做四件事：

1. **電源全設「從不」**——螢幕不關、不休眠、硬碟不停轉
2. **關掉螢幕保護裝置**，以及「恢復時顯示登入畫面」
3. **註冊 HTTP 8080 埠**（`netsh http add urlacl`）——做完這步，
   之後 SkbBridge 就**不需要系統管理員權限**也能開埠
4. **Windows Update 不准自己重開機**

> 出現「urlacl 已存在」的錯誤是正常的，代表之前跑過了，可以忽略。

### 還有兩件事要手動做

**A. 自動登入**——不然停電復電後會卡在登入畫面

按 `Win + R` → 輸入 `netplwiz` → Enter
取消勾選「**必須輸入使用者名稱和密碼**」→ 套用 → 輸入密碼兩次

**B. AnyDesk 別鎖螢幕**（這就是您前面遇到的那個問題）

AnyDesk → 設定 → 安全性 → 取消勾選「**工作階段結束後鎖定帳戶**」

做完這兩件，**重開機**。

**驗收**：重開機後應該直接進到桌面，不需要打密碼、不出現鎖定畫面。

---

## 3. 先手動跑一次，確認會動

在正式設定開機自啟之前，先手動確認整條路是通的。

### 3-1 測 485

```
C:\kiosk> SkbProbe.exe COM3 raw
C:\kiosk> SkbProbe.exe COM3 sweep
C:\kiosk> SkbProbe.exe COM3 probe
```

`probe` 印出 MCU ID 和 25 格信號 = 硬體通了。

### 3-2 測橋接

雙擊 `start-bridge.bat`。主控台應該印出：

```
[OK] 服務已啟動，等待前端呼叫。
     Kiosk 網頁：http://localhost:8080/
```

如果 `sheet.ini` 有填 `csv=`，還會看到：

```
[同步] Sheet 已更新，取件碼 N 筆
```

**沒看到這行**就是 TLS 1.2 的問題，回頭確認 .NET 4.5 有沒有裝。

### 3-3 測網頁

開 Chrome，網址列打 `http://localhost:8080/`

右上角燈號應該是**綠色**、顯示「硬體」（或「模擬」）。
輸入 Google Sheet 上的取件碼，格口應該實際打開。

**這三步都過了才往下做。**

---

## 4. 設定開機自動啟動

按 `Win + R` → `shell:startup` → 開啟「啟動」資料夾。

把這兩個檔案的**捷徑**拉進去（不是檔案本身，是捷徑）：

1. `start-bridge.bat`
2. `start-kiosk.bat`

`start-kiosk.bat` 已經內建等待邏輯——它會先確認橋接有回應（最多等 60 秒）
才啟動 Chrome，所以兩個誰先誰後都沒關係。

**驗收**：重開機，什麼都不用碰，應該自動跑出全螢幕的 kiosk 畫面。

---

## 5. Chrome 那些旗標在做什麼

`start-kiosk.bat` 裡的參數，逐個說明：

| 旗標 | 作用 |
|---|---|
| `--kiosk` | 全螢幕、無網址列、無分頁、擋掉 F11 與大部分逃脫鍵 |
| `--app=` | 以應用程式模式開啟，連視窗邊框都沒有 |
| `--user-data-dir=` | 用獨立設定檔，不受店員平常用的 Chrome 影響 |
| `--disable-session-crashed-bubble` | 不跳「Chrome 未正確關閉，要還原嗎？」 |
| `--disable-infobars` | 不跳「Chrome 正受自動測試軟體控制」那條黃帶 |
| `--noerrdialogs` | 當掉時不彈錯誤視窗，直接讓 watchdog 重啟 |
| `--disable-pinch` | 觸控螢幕上兩指縮放會把版面弄壞，關掉 |
| `--overscroll-history-navigation=0` | 防止客人左右滑就上一頁 |
| `--check-for-update-interval` | 設成一年，避免 Chrome 自己跳更新提示 |

批次檔每次啟動前還會把設定檔裡的 `exit_type` 改回 `Normal`——
這是消除「要還原頁面嗎」提示最可靠的做法。

---

## 6. 防止客人跑出去

| 手法 | 有沒有被擋 | 說明 |
|---|---|---|
| F11 / Esc | ✅ 擋掉 | `--kiosk` 已處理 |
| Alt + F4 | ⚠️ 關得掉 | 但 watchdog 3 秒後重開 |
| Ctrl + W / Ctrl + T | ✅ 擋掉 | kiosk 模式無分頁 |
| 右鍵選單 | ⚠️ 開得出來 | 見下方補強 |
| **Ctrl + Alt + Del** | ❌ **擋不掉** | 需要群組原則，見下方 |
| Win 鍵 | ❌ 擋不掉 | 見下方 |

### 補強做法（依需求選用）

**最實際的一招：拔掉鍵盤。** 客人只需要觸控螢幕和掃碼器
（掃碼器是 HID 鍵盤模擬，不影響）。這一招解決上表 90% 的問題，
而且零設定、零維護。強烈建議優先採用。

**擋 Ctrl+Alt+Del 的工作管理員**（Win7 旗艦版有 gpedit）：

`Win + R` → `gpedit.msc` → 使用者設定 → 系統管理範本 → 系統
→ Ctrl+Alt+Del 選項 → 「移除工作管理員」設為**已啟用**

**擋 Win 鍵**：

```
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoWinKeys /t REG_DWORD /d 1 /f
```

**擋右鍵選單**：在 `index.html` 的 `<script>` 開頭加一行

```javascript
document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
```

---

## 7. 日常維運

| 我想… | 怎麼做 |
|---|---|
| 改取件碼 | 直接編輯 Google Sheet，最久 60 秒後生效 |
| 立刻套用 Sheet 變更 | 瀏覽器開 `http://localhost:8080/sync` |
| 看系統狀態 | 瀏覽器開 `http://localhost:8080/health` |
| 查沒回寫成功的取件記錄 | 打開 `C:\kiosk\pickups.queue` |
| 遠端維護 | AnyDesk（記得先裝成服務，才能操作鎖定畫面） |
| 離開 kiosk 進桌面 | 接上鍵盤按 Alt+F4，或 AnyDesk 進去關掉 watchdog 視窗 |

---

## 8. 常見狀況

**畫面停在「離線」橘燈**
→ `start-bridge.bat` 沒跑起來，或 8080 埠被佔。
   開 `http://localhost:8080/health` 看有沒有回應。

**取件碼一直說「查無此碼」**
→ 看橋接主控台有沒有 `[同步] Sheet 已更新`。
   沒有的話：確認 .NET 4.5 有裝、`sheet.ini` 的 `csv=` 網址正確、
   而且 Sheet 真的「發布到網路」過（不是只有共用連結）。

**開鎖失敗，但按板子 reset 全開正常**
→ reset 按鈕不走 485。用 `SkbProbe.exe COM3 raw` 判斷是
   完全沒訊號（線路問題）還是收到亂碼（波特率問題）。

**停電復電後卡在登入畫面**
→ 自動登入沒設好，回到第 2 節的 A。

**Chrome 跳「要還原頁面嗎」**
→ 批次檔應該已經處理掉了。還是會跳的話，把整個
   `C:\kiosk\chrome-profile` 資料夾刪掉重來一次。

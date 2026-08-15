# pi/ — 樹莓派版智慧拍櫃（5 家店架構）

> 取代 Win7 + .NET。同一份協議、同一份前端，換成 Linux + Python。
>
> **設計前提：一開始就是 5 家，不是先做一家再改。**
> 所有檔案 5 台完全相同，**唯一的差異是 `config.ini`**。
> 任何需要「這家店特別改一下程式」的東西，都是設計錯誤。

---

## 🔖 開新對話時，把這段貼給 AI

```
讀 ~/Desktop/projects/code/smartlocker/pi/README.md 和 ../AGENTS.md，
接手智慧拍櫃 Pi 版。

Pi 已到貨，準備跑 install.sh。
```

---

## 檔案

| 檔案 | 用途 | 5 台是否相同 |
|---|---|:--:|
| `skb.py` | 協議庫 + 模擬器（移植自 `UpusSkb.cs`） | ✅ |
| `bridge.py` | HTTP ↔ RS-485 橋接 + 靜態網頁 | ✅ |
| `sheet.py` | Google Sheet 同步 + 遠端開格 | ✅ |
| `web/index.html` | Kiosk 前端（單檔、ES5、零相依） | ✅ |
| `install.sh` | 一鍵佈署（systemd + kiosk + udev + Tailscale） | ✅ |
| `cells.csv` | 格號 → (板位址, 通道) | ⚠️ 依實體櫃 |
| **`config.ini`** | **每店唯一差異** | ❌ **每台不同** |

---

## 為什麼從 Win7 換過來

| | Win7 + .NET | Pi + Python |
|---|---|---|
| 遠端維運 | AnyDesk（鎖定畫面進不去、黑屏、要裝服務） | **SSH**，一行指令 |
| 5 台一起操作 | 一台一台連 | `for s in ...; do ssh $s ...; done` |
| TLS 1.2 | 要 .NET 4.5+，不然 Google 連不上 | 沒這問題 |
| 串口驅動 | 要裝 CH341SER | 核心內建，插上就是 `/dev/ttyUSB0` |
| 開機自啟 | 捷徑丟啟動資料夾 | systemd，當掉自動重啟 |
| 安全更新 | ❌ 已停止 | ✅ |

> 2026-08-01 就決議過「**不要複製 Win7 到 300 間**」，見 Blueprint 附錄 C。

---

## 快速開始

### 在 Mac 上先看（免硬體、免 Pi）

```bash
cd pi
python3 bridge.py --sim
# 瀏覽器開 http://localhost:8080/
```

模擬器完整實作了協議，開格、門磁、A0 自動上傳都會動。
測試碼 `1234`（第 7 格）、`8352`（第 5 格）。

協議本身也能單獨自測：

```bash
python3 skb.py sim
```

### Pi 到貨後

```bash
sudo apt install -y git python3-serial
sudo git clone <repo> /opt/skb
cd /opt/skb/pi
sudo bash install.sh          # 裝服務、kiosk、udev、Tailscale
nano config.ini               # ★ 改 store_id
sudo reboot
```

開機後應該直接是全螢幕取件畫面。

### 板子到貨後

```bash
ls -l /dev/skb485                        # udev 固定名稱
python3 skb.py /dev/skb485 probe         # 驗板
sudo systemctl restart skbbridge
```

---

## 日常維運

```bash
systemctl status skbbridge          # 狀態
journalctl -u skbbridge -f          # 即時 log
sudo systemctl restart skbkiosk     # 重開畫面
curl localhost:8080/health          # 健康檢查
```

**5 台一起：**

```bash
STORES="difly-taiping store2 store3 store4 store5"

for s in $STORES; do echo -n "$s: "; ssh pi@$s 'systemctl is-active skbbridge'; done
for s in $STORES; do ssh pi@$s 'sudo systemctl restart skbbridge'; done
for s in $STORES; do ssh pi@$s 'cd /opt/skb && sudo git pull && sudo systemctl restart skbbridge'; done
```

**要看畫面時**（比 VNC 輕）：

```bash
ssh pi@store1 'DISPLAY=:0 scrot /tmp/s.png' && scp pi@store1:/tmp/s.png .
```

---

## HTTP 端點

| 端點 | 用途 |
|---|---|
| `GET /health` | 服務與連線狀態（含 Sheet 同步） |
| `GET /code?value=1234` | 查取件碼 → 格號（**查本機快取，不連網**） |
| `GET /unlock?cell=7` | E2 開第 7 格 |
| `GET /doors` | D2 讀全部格位門磁 |
| `GET /picked?value=1234&cell=7` | 標記取件完成 |
| `GET /events` | 取出並清空 A0 事件佇列 |
| `GET /sync` | 立刻強制同步 Sheet |
| `GET /scan` | DF 廣播尋址（診斷） |
| `GET /` | 供應 `web/index.html`（同源，免 CORS） |

只綁 `127.0.0.1`，不對外開放。

---

## Google Sheet 欄位

```csv
店號,取件碼,格號,狀態,效期,備註
difly-taiping,1234,7,待取,2026-08-20,王先生
store2,5678,9,待取,,別店的
```

| 欄位 | 必要 | 說明 |
|---|:--:|---|
| **店號** | ⭐ 5 家共用一份時必要 | **只載入 `store_id` 相符的列** |
| 取件碼 | ✅ | |
| 格號 | ✅ | |
| 狀態 | | 待取／已取／停用（空白＝待取） |
| 效期 | | `YYYY-MM-DD` 或含時間；空白＝不限期 |
| 備註 | | 不要放客人姓名電話（發布網址是公開的） |

> 🛑 **5 家共用一份 Sheet 時，「店號」欄不能省。**
> 沒有它，每台 Pi 會載入全部的碼 ——
> **A 店的客人輸入 B 店的碼，會打開 A 店的櫃子。**
> 有店號欄時，別店的碼在**載入階段**就被濾掉，不是查詢時才擋。

中英標題都認得（`store` / `code` / `cell` / `status` / `expires` / `note`）。

---

## 板子通道數

`config.ini` 的 `channels_per_board` 要填**板子實際通道數**。

目前設定：**30 路一塊板，涵蓋 22 格**，格號 = 通道號，走公式，`cells.csv` 不用填。

需要 `cells.csv` 的情況：

- 實體格口排列與通道號對不上（左右兩排交錯配線很常見）
- 有跳號、有停用格
- 多塊板級聯（板位址 = DIP 撥碼值 + 1）

**開機時會自動檢查**——映射若超出通道數，印 🛑 並指出是哪幾格，
且 `/doors` 不會整支掛掉（該格回 `error` 欄位）。

---

## 車隊層：MQTT

> ★ **最高原則（Blueprint B2）：開鎖路徑不得依賴網路。**
> MQTT 是**加法**——沒設定就不啟動、連不上就背景重試，**永不阻塞開鎖**。
> broker 掛掉店裡照常營運，只是遠端看不到。

在 `config.ini` 填 `mqtt_host` 就啟用（HiveMQ Cloud 帳號 grinder-pro 已在用）。

### Topic（`{store}` = `store_id`）

**雲端 → 裝置**

| Topic | Payload | 用途 |
|---|---|---|
| `skb/{store}/cmd/unlock` | `{"cell":7,"req":"abc"}` | **即時**遠端開格 |
| `skb/{store}/cmd/sync` | `{}` | 強制同步 Sheet |
| `skb/{store}/cmd/doors` | `{}` | 要求回報門磁 |
| `skb/{store}/cmd/ping` | `{}` | 要求立刻回報狀態 |

**裝置 → 雲端**

| Topic | retained | 用途 |
|---|:--:|---|
| `skb/{store}/status` | ✅ | 心跳（每 `mqtt_status_sec` 秒） |
| `skb/{store}/lwt` | ✅ | **遺囑** — 斷線時 broker 自動發 |
| `skb/{store}/evt/door` | | 門磁事件 |
| `skb/{store}/evt/picked` | | 取件完成 |
| `skb/{store}/evt/ack` | | 指令結果（帶 `req` 對應） |

訂閱全部店：`skb/+/status`（誰活著）、`skb/+/evt/#`（所有事件）

### LWT 是車隊監控的關鍵

不用輪詢。裝置斷線時 **broker 會自動幫它發** `{"online":false}`，
訂閱 `skb/+/lwt` 就知道哪一家掛了。

### 指令去重

`req` 是必要的。broker 重送或網路抖動時，**同一個 `req` 只會執行一次**——
沒有這個，一次網路抖動可能讓櫃子開兩次。

---

## ⚠️ A0 自動上傳：只能選一個方向

手冊（第 375–378 行）低 4 Bit **三選一，無法兩者都要**：

| 值 | 意義 |
|:--:|---|
| 0 | 關閉 |
| 1 | 信號斷開/低電平時上傳 → **門「開」**時 |
| 2 | 信號接通/高電平時上傳 → **門「關」**時 |

**預設選 2。** 理由：門關 = 客人拿走了 = 取件完成，是計費與客訴的依據。
門開不重要——送了 `E2` 本來就知道。

> 本地 Kiosk 兩個方向都要用（等門開、再等門關），走 `/doors` 輪詢，不受此限制。
> MQTT 的 A0 是給**雲端**知道交易完成用的。

**多板會碰撞。** 手冊明寫「同一時間多個設備發送狀態會造成資料混亂」。
程式**會自動偵測**——`cells.csv` 若映射到多塊板，A0 自動關閉並改用輪詢。

---

## 遠端開格：兩條路

| | Sheet 輪詢 | **MQTT** |
|---|---|---|
| 延遲 | 最久 `sync` 秒（預設 60） | **即時** |
| 需要 | 只要有網 | broker |
| 適用 | 備援 | ★ 主力 |

**客人站在櫃子前等一分鐘是不能接受的 —— 5 家店請用 MQTT。**
Sheet 輪詢留著當 MQTT 掛掉時的備援。

### Sheet 輪詢（備援）

客人拍子卡在裡面時用。做法是第二份發布的 CSV：

```csv
店號,格號
difly-taiping,12
```

每台 Pi 只認自己 `store_id` 的列，處理過的記在 `remote_done.json` 不會重複開。

> ⚠️ **這是 MVP 權宜做法**，延遲最久 = `sync` 秒（預設 60）。
> 客人站在櫃子前等一分鐘是不能接受的 —— **第 2 家店上線前應該換成 MQTT**。
> HiveMQ 帳號 grinder-pro 已經在用。

---

## 硬性規則

- **開鎖路徑不得依賴網路。** 取件碼一律查本機快取，Sheet 只負責更新快取。
  斷網、Google 掛掉都必須還能開格。開機先讀 `codes.cache.csv`。
- **`docs/skb-doc.txt` 是協議唯一真相。** 不要憑記憶寫幀格式。
- **`web/index.html` 維持單檔零相依、ES5。** 不拆 CSS/JS、不引 CDN。
- **不要把客人姓名電話放進 Google Sheet** —— 發布的 CSV 網址是公開的。
- **每店差異只能出現在 `config.ini`。**

---

## 執行時產生的檔案（已 gitignore）

| 檔案 | 內容 |
|---|---|
| `codes.cache.csv` | Sheet 的本機快取，斷網時靠它 |
| `pickups.queue` | 尚未回寫成功的取件記錄 |
| `remote_done.json` | 已處理過的遠端開格請求 |

> 開發測試後這三個檔可能留有假資料（`1234` / `8352` 等），刪掉即可，會自動重建。

---

## 驗證紀錄（2026-08-11）

| 項目 | 結果 |
|---|---|
| `skb.py sim` 協議自測 | ✅ 輸出與 C# 版逐字相同 |
| `/health` `/scan` `/unlock` `/doors` `/events` | ✅ |
| `/code` 有效／已取／不存在 | ✅ 三種情境正確 |
| 完整取件：開格 → 標記 → 重複使用被擋 | ✅ |
| Google Sheet CSV 同步 | ✅ |
| **多店隔離**（別店的碼查不到） | ✅ 載入階段就濾掉 |
| **效期**（已過期／未到期） | ✅ |
| 遠端開格（依 store_id 過濾） | ✅ |
| 單板 30 路 / 雙板級聯 兩種映射 | ✅ |
| **設定錯誤防護**（映射超出通道數） | ✅ 開機 🛑 警告 + `/doors` 不崩 |
| 前端錯誤分支（查無／已用／過期／格號錯） | ✅ |
| **MQTT 連線 + LWT + retained status** | ✅ 對真的 broker 測（amqtt） |
| **MQTT 遠端開格** | ✅ 即時，含 ack 回覆 |
| **MQTT 指令去重**（同 req 重送） | ✅ 只執行一次 |
| **MQTT 壞格號被擋** | ✅ ack 回 `ok:false` |
| **A0 門關事件上雲** | ✅ 寫 E0 配置後收到 |
| **多板自動關閉 A0**（防碰撞） | ✅ 偵測到 2 塊板即關閉並改輪詢 |
| **MQTT 掛掉不影響本地** | ✅ 背景重試（5→10→20s 退避），開鎖照常 |
| 靜態網頁供應 | ✅ HTTP 200 |
| `install.sh` 語法 | ✅ `bash -n` |

**尚未驗證**：實體板子（SKB18 未到貨）、Pi 實機、Chromium kiosk、觸控螢幕。

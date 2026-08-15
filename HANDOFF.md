# 交接：智慧拍櫃 RS-485 排查（截至 2026-08-10）

## 🔖 開新對話時，把這段貼給 AI

### 用 Claude Code（建議）

在專案目錄開 `claude`，它會自動讀 `CLAUDE.md`。第一句只要講您現在要做什麼：

```
RS-485 排查已到「協議不符」的結論，串口層全部窮盡。
我現在要跟廠商要協議文件和測試軟體，拿到後做協議逆向。
```

### 用其他 AI 介面

```
讀 ~/Desktop/projects/code/smartlocker/HANDOFF.md 和 AGENTS.md，接手智慧拍櫃。

RS-485 排查已到「協議不符」的結論，串口層全部窮盡。
我現在要跟廠商要協議文件和測試軟體，拿到後做協議逆向。
```

> 情境不同就換第二句，例如：
> - 「廠商給了新的協議文件，要改 UpusSkb.cs」
> - 「拿到廠商的 exe 了，要在 Win7 上跑並用第二支轉換器監聽」
> - 「485 先擱著，我要把 MQTT / 樹莓派那條線推進」

---

## 一句話現況

**硬體、線材、工具、串口參數全部證實正常；兩塊板卡對任何指令都完全不回應。
判斷是手上的協議文件與實際出貨板卡不符，需向廠商取得正確文件與測試軟體。**

---

## 手上有什麼

| 項目 | 狀態 |
|---|---|
| 25 路鎖控板（黑色 PCB，MCU `IAP15W4K61S4`） | 有電、RESET 有作用 |
| 50 路鎖控板（黑色 PCB，七段顯示器 + `設置`/`▲`/`▼` + `一鍵全開`） | **MCU 確認存活**，七段顯示 `01` |
| USB-485 轉換器 ×2（藍色透明殼，CH340） | **兩支都good**，對接自測互通 |
| USB-TTL 模組 ×1（CH340） | 尚未使用（25 路板 TTL 是空焊盤，需焊接） |
| 三用電表、杜邦線、USB-C 轉 USB-A | 齊 |
| Mac mini（主要開發機） | 環境已就緒 |
| Win7 主機 | **開不了機**（風扇轉 3 秒停，疑似記憶體未插實）— 非關鍵路徑 |

---

## 已證實正常（不要再重測）

- **匯流排電氣**：板卡 A 對 B 量得 **34.2 kΩ**（RS-485 收發晶片輸入阻抗）
- **板卡 MCU**：50 路板按 `一鍵全開`，繼電器動作、全通道 LED 亮
- **工具鏈**：兩支轉換器對接（A-A / B-B / GND-GND），一支 `hunt` 送、一支 `listen` 收，
  收到完全一致的 `55 A1 FF DF 00 D4`
- **線色（萬用表通斷實測，非推測）**：

  | 線色 | 功能 |
  |---|---|
  | **紅** | **485-A** |
  | **綠** | **485-B** |
  | **黃** | **485-GND** |

  白色 6P 座與綠色螺絲端子在板內是**同一條 485 線路**（通斷證實）

---

## 已徹底排除（不要再回頭查）

| 變數 | 已測範圍 |
|---|---|
| 波特率 | 1200 / 2400 / 4800 / 9600 / 19200 / 38400 / 57600 / 115200 |
| 校驗位 | N / E / O |
| 停止位 | 1 / 2 |
| 位址 | 廣播 `FF` + 點名 DD 1~32 + D0 1~8 |
| A/B 極性 | 兩種 |
| 板卡 | **兩塊獨立板卡，行為完全一致** |
| 上位機 | Win7 + C# 與 macOS + Python，兩套獨立實作，結果相同 |

`deep` 模式共 **48 種串口參數組合**，全數為零。

**最關鍵的觀察**：一支轉換器專職監聽、另一支專職發送，
全程只收到我方送出的幀，**板卡從未發送過任何一個位元組**。
若板卡以其他波特率回話，9600 監聽器會收到亂碼；但收到的是**絕對的零**。

---

## 為什麼判斷是「協議不符」

1. 兩塊不同型號的板卡行為完全一致 → 同時發送端故障的機率極低
2. **實體板卡與《锁控板技术文档 V3.1》的圖片完全不符**：
   - 文件是藍色 PCB，實物是黑色
   - 實物有 `Bluetooth module` / `Ethernet module` 空焊區，文件無
   - 25 路板 TTL 是 `TTL IO` 2×2 焊盤，文件是 `5V Rx Tx Gnd` 一排
   - **50 路板根本不在該文件內**（文件僅 SKB18 / SKB25 / SKB36）
3. 一塊正常的板卡收到看不懂的協議時，**正確行為就是完全不吭聲**

---

## 下一步（依順序）

### 1. 向廠商取得三樣東西

1. 兩塊板卡的**完整型號**（板緣或背面絲印）
2. 對應型號的**通訊協定文件**
3. **廠商自己的上位機測試軟體（.exe）** ← 最重要

### 2. 協議逆向（拿到廠商軟體後，十分鐘的事）

1. 在 Win7 上跑廠商軟體，用它成功開一次鎖
2. 把**第二支轉換器**並聯掛在同一條匯流排上（A、B、GND 三線並接）
3. Mac 上執行：

   ```bash
   cd ~/Desktop/projects/code/smartlocker/tools
   source .venv/bin/activate
   python3 skb_probe.py listen 120 --port /dev/cu.usbserial-XXXX
   ```

4. 廠商軟體送出的每一個位元組全部抓下來 → 幀頭、功能碼、校驗方式直接攤開
5. 依實測結果改寫 `src/UpusSkb.cs` 與 `tools/skb_probe.py` 的 `build_frame()`

### 3. 備案：走 TTL

25 路板的 `TTL IO` 是 **2×2 空焊盤，需焊接排針**。
換貨時可要求廠商**代焊**。TTL 沒有 A/B 極性與共模問題，
且是後續樹莓派路線的正式介面。

### 4. 換貨

`docs/廠商換貨報告.md` 已寫好（簡體），**結論已於 08-10 修正**（改為請求釐清型號／協議／測試軟體，換貨列為後續訴求），可直接發送。

---

## 驗板工具用法

```bash
cd ~/Desktop/projects/code/smartlocker/tools
source .venv/bin/activate          # 首次：python3 -m venv .venv && pip install pyserial

python3 skb_probe.py ports         # 列出序列埠（埠號會漂，每次先跑這個）
python3 skb_probe.py raw           # 送一次尋址幀
python3 skb_probe.py sweep         # 8 種波特率 × 3 種指令
python3 skb_probe.py ping          # DF 廣播 + DD 1~32 + D0 1~8
python3 skb_probe.py deep          # 48 種串口參數組合（波特率×校驗×停止位）
python3 skb_probe.py hunt          # 持續偵測，接對會嗶三聲（換線時用）
python3 skb_probe.py listen 120    # 只聽不送 ← 協議逆向就用這個
```

加 `--port /dev/cu.usbserial-XXXX` 指定埠。

> ⚠️ **埠號會漂**：換 USB 孔或重插就會變（Win7 也一樣，`COM3` → `COM5`）。
> 上樹莓派後務必用 **udev rules 綁 by-id**，固定成 `/dev/skb`、`/dev/labelprinter`。

---

## 平行推進中的另一條線：MQTT + 樹莓派

已定案的決策（細節見 README 與對話記錄）：

- **邊緣端選樹莓派 Pi 4 (4GB)，不是 ESP32**——USB 標籤印表機需要 USB Host，ESP32 沒有
- **不要 Pi 5**：需主動散熱，密閉櫃體 24 小時運轉，風扇是唯一活動零件
- **Broker 用現有的 HiveMQ Cloud 免費版**（100 連線 / 10GB 月流量），
  但需與既有的磨豆機專案做 **topic 前綴隔離 + 獨立 credentials**
- **Topic 設計**（一次定好）：

  ```
  rm/locker/{site}/{mac}/cmd/unlock     雲 → 櫃   QoS1
  rm/locker/{site}/{mac}/cmd/codes      雲 → 櫃   QoS1 + retained
  rm/locker/{site}/{mac}/cmd/print      雲 → 櫃   QoS1
  rm/locker/{site}/{mac}/evt/door       櫃 → 雲   QoS1
  rm/locker/{site}/{mac}/evt/picked     櫃 → 雲   QoS1
  rm/locker/{site}/{mac}/status         櫃 → 雲   retained + LWT
  ```

- **心跳用 MQTT 內建的 LWT + retained status**，不要自己寫
- **AGENTS.md 的硬性規則照樣適用**：開鎖路徑不得依賴網路，
  取件碼存本機（NVS/SPIFFS/檔案），MQTT 只負責更新快取

---

## 待辦

- [ ] 向廠商索取板卡型號、正確協議文件、上位機測試軟體
- [ ] 拿到軟體後做協議逆向（listen 監聽）
- [ ] 依實測協議改寫 `src/UpusSkb.cs` 與 `tools/skb_probe.py`
- [ ] 25 路板換貨（報告需先修正結論）
- [ ] 要求廠商代焊 TTL 排針
- [ ] Win7 主機開機故障排除（記憶體重插 → 清 CMOS → 換電源）— 低優先
- [ ] 撰寫 `docs/mqtt-blueprint.md`（架構 + topic 規格 + udev/overlayfs 設定）

# 🏪 開新店 SOP（擴第 2~5 家店標準流程）

> 架構：**雲端一套程式服務所有店**（Vercel＋Neon）；每台 kiosk 只是「瀏覽器開雲端網址」。
> 開新店 = ①雲端啟用店 ②現場裝硬體 ③kiosk 設網址 ④驗收。半天可完成一店。
> 依據：`smartlocker/docs/規格-販售與泡麵24h.md`、`規格-運動商城.md`、交接 18 篇。

---

## 〇、先搞懂：5 家店在系統裡長這樣（早已建好）

| 店 | ID | slug | 狀態 | 485 定址 |
|----|----|------|------|---------|
| 太平總店（總倉） | 1 | df-a | ✅ 營運中 | 位址 1（撥碼全 off） |
| B 館 | 2 | df-b | ⏸️ 停用 | 位址 2（撥 00001） |
| C 館 | 3 | df-c | ⏸️ 停用 | 位址 3（撥 00010） |
| D 館 | 4 | df-d | ⏸️ 停用 | 位址 4 |
| E 館 | 5 | df-e | ⏸️ 停用 | 位址 5 |
| 測試加盟店 | 6 | test-franchise | ⚠️ 測試用 | — |

> kiosk 畫面由網址參數決定店：`shop.dearfly.com.tw/?venue=2` = B 館。
> （前端有「分店切換器」可選店；kiosk 固定網址即可。）

---

## 一、雲端設定（10 分鐘，AI/工程師做）

### ① 啟用店＋改名
```sql
UPDATE venues SET is_active = TRUE, name = '迪飛○○館', address = '…', phone = '…'
WHERE id = 2;   -- 2 = B館、3 = C館、4 = D館、5 = E館
```

### ② 建立該店庫存主檔（複製總倉商品結構到新店）
```bash
# 新店每項商品從 0 開始（或直接配貨），用後台「📤 配貨」從總倉配過去
# 或 SQL 複製商品主檔（不含庫存數量）：
INSERT INTO inventory (venue_id, cabinet_id, slot_no, sku, name, category, price, qty, status, cost_price, min_qty)
SELECT 2, cabinet_id, slot_no, sku, name, category, price, 0, status, cost_price, min_qty
FROM inventory WHERE venue_id = 1 AND status = 'on_shelf';
```

### ③ 量價階梯（如有）複製
```sql
INSERT INTO price_tiers (sku, min_qty, percent, unit_price)
SELECT sku, min_qty, percent, unit_price FROM price_tiers
WHERE sku IN (SELECT sku FROM inventory WHERE venue_id = 2);
```

### ④ 配首批貨
```
後台 → 📤 配貨 → 選「總倉(1) → 新店(2)」→ 勾商品＋數量 → 核准 → 庫存移動＋LINE 通知
```

### ⑤ 開分店後台帳號（加盟商專屬）
```
後台 → 會員/帳號管理 → 建帳號（role=staff，只看自己店）
⚠️ 分店帳號功能待做（交接任務 #8）——目前後台是「切換器」看不同店，共用同一後台
```

---

## 二、現場硬體安裝（每店一套，廠商或現場）

| 項目 | 規格 | 備註 |
|------|------|------|
| kiosk 主機 | Win10（14 吋觸控佳） | Chrome 全螢幕跑雲端 |
| 485 鎖控板 | UPUS-SKB36（36 路，30 用 6 備） | **定址：第 N 店撥碼 = N-1** |
| 印表機 | GPRINTER GP-3120TN | 4×3cm 標籤，TSPL |
| 電源 | 每櫃獨立 DC（12V/24V 依鎖規格） | 485 只走訊號，不共電 |
| 網路 | 現場 Wi-Fi/有線 | 連外網即可 |

> 485 級聯：一條鏈 `[板1 位址1] ── [板2 位址2] ── [板3 位址3]`，
> 最後一片 A/B 端子焊 120Ω 跳線；主機端 120Ω。

---

## 三、kiosk 設定（現場 10 分鐘/台）

```bash
# 1. 裝 Chrome
# 2. 開機自動進 kiosk：Chrome 捷徑放「啟動」資料夾，參數：
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk "https://shop.dearfly.com.tw/?venue=2"
#    （venue=2 是 B 館；3=C、4=D、5=E）
# 3. F11 全螢幕（--kiosk 已全螢幕）
# 4. 確認店名顯示正確（畫面右上角 🏟️ 應顯示「迪飛○○館」）
```

---

## 四、驗收（開幕前必做）

```bash
# ① 485 通不通（現場 Win/本機）
python3 tools/skb_probe.py sweep          # 應該看到該店板子的位址
# ② 逐格開鎖實測
curl -X POST localhost:4321/rs485 -d '{"hex":"55A101E2010117"}'   # 或現場直接開
# ③ kiosk 下單實測
#    選線種→磅數→下單→印貼紙（列印對位）→開格放拍
# ④ 販售實測
#    商品有貨→選購（金流未開前是展示）→庫存正確
# ⑤ LINE 通知
#    新單→員工收到（⚠️ 額度 200/200 用完時收不到，等下月/升級）
```

---

## 五、開幕後例行（每店）

```
每日：後台看庫存（缺貨？低庫存預警 LINE）
補貨：後台「進貨/配貨」→ 現場上架
每週：確認 Neon 備份（自動，含所有店）
```

---

## ⚠️ 目前卡點（開第 2 家前先解決）

| 卡點 | 狀態 | 影響 |
|------|------|------|
| **太平總店硬體驗收**（485＋列印） | ⏳ 現場另做 | 第 2 家的硬體流程要照太平跑順的做 |
| 分店帳號（只看自己店） | 待做（交接 #8） | 加盟商共用後台（有切換器） |
| 金流（LINE Pay） | 等憑證 | 販售只能展示不能收款 |

---

## 六、開店 SOP 一句話

> **雲端啟用（SQL）→ 硬體裝一套（485 定址）→ kiosk 設網址（?venue=N）→ 驗收 → 開幕。**
> 軟體不用複製（雲端共用），要複製的是「硬體＋現場設定」。

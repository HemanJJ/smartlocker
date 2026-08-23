---

**交接時間**：2026-08-23（本次）  
**工作階段**：標籤印表機（GP-3120TN）＋ 串接服務 Web App ＋ DSH 圖片輸入修復  
**前次交接**：見下方 2026-08-18（Vercel + Neon + 5 店 MVP）

---

## 本期重點（2026-08-23）

### 1. 標籤印表機 GP-3120TN — 已定稿 ✅
- **硬體**：GPRINTER GP-3120TN（USB / Win10 kiosk，`192.168.0.172`，Tailscale `100.108.96.124`，AnyDesk 遠端）
- **標籤尺寸**：4×3cm（紙張用驅動內建 `40 mm x 30 mm`，**不要自訂**否則字轉90°＋溢頁）
- **內容（4 行）**：線種+色 / 磅數+店名英文 / 金額+店名中文 / 取件號
- **✅ 最終解法＝Seagull 驅動印中文**（腳本 `web/scripts/print-label.ps1`）：
  用 `System.Drawing.Printing.PrintDocument` 畫4行（Windows 中文字型「微軟正黑」渲染，所以繁體全覆蓋：太平永成店/長壽店都印得出），透過 Seagull 驅動送印。
- **換文字＝改腳本參數**（`店名`/`店名英文`/`線種`/`磅數`/`金額`/`取件號`）再跑一次 → 這就是你要的「editor」，不必 GUI
- **✅ 自動帶（接訂單資料，已做 2026-08-23）**：
  - `print-label.ps1` 支援 `-ConfigFile <json>`（欄位 `store/storeEn/line1..line4/printer`），供程式安全傳中文/`$`
  - `kiosk-poller.mjs` 輪詢 `/api/print-jobs?status=pending` → 用 `job.label`(model+color/tension/price/pickupCode) 自動組 4 行 → 寫暫存 JSON → `powershell print-label.ps1 -ConfigFile` → 開格 → 回報完成
  - 店名從環境變數 `STORE`/`STORE_EN` 帶入；`PRINT_MODE=file`＝只輸出 `label-取件碼.json` 預覽；`PRINTER` 指定印表機
  - 測試：`STORE="太平永成店" STORE_EN="Pai store" node scripts/kiosk-poller.mjs`
- ⚠️ **這台印表機的坑（實測）**：單字節 FONT 0~8、無內建中文字、**不吃 BITMAP**（最小方塊無反應）→ raw TSPL 印中文**不可行**（TEXT 亂碼、BITMAP 無反應）。**不要走「下載 `.BF2` 字型」**（找不到繁體檔＋印表機未必吃 DOWNLOAD）。
- ⚠️ **坑**：PowerShell 字串 `"NT$250"` 的 `$2` 會被當變數展開成空 → **用單引號 `'NT$250'`**
- ⚠️ **坑**：`StartDocPrinter` 的 P/Invoke 一定要 `CharSet=CharSet.Unicode`（否則 1804 datatype invalid）
- ⚠️ **300 店擴展**：用同一套 `print-label.ps1`（每店 kiosk 塞店名＋訂單資料），不需 per-store 灌字型（詳見知識庫 doc 16）。

### 2. 串接服務 Web App — 已部署 shop.dearfly.com.tw ✅
- 網域：`https://shop.dearfly.com.tw`（原 smartlocker-alpha 已改）
- 顏色功能：`strings.colors` / `orders.color`（`web/src/lib/stringing.ts`）
- 訂單頁：`web/src/app/order/page.tsx`；訂單 API：`web/src/app/api/orders/route.ts`
- kiosk poller：`web/scripts/kiosk-poller.mjs`
- Rich Menu 6 格：`tools/setup-richmenu.py`、`web/public/liff/rich-menu-stringing.svg/.png`
- **部署指令**（從 repo 根目錄）：`cd smartlocker && VERCEL_ORG_ID=… VERCEL_PROJECT_ID=… npx vercel --prod`
  ⚠️ 不要從 `web/` 內跑（Root Directory=web 會報錯）

### 3. DSH 圖片輸入（vision）修復 — 疑已完成 ✅
- **兇手**：第三方插件 `dsh-plugin-image-input`（🖼️ 圖片轉文字）攔截圖片，且誤判模型（讀全域預設 `deepseek-v4-pro` 純文字，而非 session 選的 vision 模型）
- **還繞去 OpenRouter** `moonshotai/kimi-k2.5`（非視覺模型）→ 失敗 →「送不出去」
- **修法**：在 `~/.dsh/profiles/web/cordis.patch.yml` 加：
  ```yaml
  - id: image-input
    disabled: true
  ```
  （只停這一個，別去碰官方 `attachment-local`，參考 #147 教訓）
- **需重啟 DSH 才生效**；使用者已成功傳送標籤照片，疑已生效
- 之後選 `deepseek-v4-flash-vision-exp`，圖片直接送 DeepSeek（用自己的 `DEEPSEEK_API_KEY`，不繞 OpenRouter）

### 4. 忘了帶/要留意的
- DSH 別從 session 內自己 kill（會斷對話）；重啟用 `npx @deepseek-ai/dsh web`
- DSH 的 `~/.dsh/settings.yaml` 目前 `agent-default-model` = deepseek-v4-pro；`llm-pi-ai.kimi-coding` 指向 OpenRouter（Kimi key 401 失效）

---

## 前次交接（2026-08-18）

**交接時間**：2026-08-18 凌晨 01:00  
**工作階段**：Vercel + Neon 遷移 + 5 店 MVP + Rich Menu 重建  
**前次交接**：commit `326f185` — LINE Bot + Ollama RAG 基礎

---

## 本期完成

### Vercel + Neon 遷移
- [x] Next.js App Router 專案建立於 `web/`
- [x] Vercel 專案 `smartlocker` 連結完成
- [x] 正式網域：`https://smartlocker-alpha.vercel.app`（固定，不再換）
- [x] LINE Webhook 穩定運作（取件碼查詢 + FAQ 回覆）
- [x] LIFF 頁面改用相對路徑，不再依賴 ngrok

### 資料庫
- [x] Neon PostgreSQL 開通（新加坡機房）
- [x] 5 家分店 `venues` 表格建立
- [x] 取件碼 `pickup_codes` 表格（綁定 venue_id）
- [x] 索引與 UNIQUE 約束

### 5 店多店舖 API
- [x] `GET /api/venues` — 分店列表
- [x] `GET /api/venue/:slug/codes.csv` — 各店 kiosk 取件碼 CSV
- [x] `POST /api/writeback` — kiosk 取件回寫（token 驗證）
- [x] `POST /api/code/generate` — 產生取件碼（綁定分店）
- [x] `GET /api/code/validate?code=XXX&venue=slug` — 驗證
- [x] `POST /api/code/use` — 標記已取件
- [x] `GET /api/orders?lineUserId=XXX` — 跨店訂單查詢
- [x] `POST /api/webhook` — LINE Webhook（5 秒 timeout + FAQ fallback）

### Rich Menu
- [x] 新設計：品牌綠色系，2×2 版面
- [x] 四按鈕：預約租拍、我的訂單、預訂場地、我的訂位
- [x] 透過 API 上線（迪飛羽球館 @647ntnvu）
- [x] PNG 圖檔在 `web/public/liff/rich-menu.png`

### 已知議題
- `LINE_CHANNEL_ACCESS_TOKEN` 在 Vercel 上，**不要按 Reissue**，否則 token 失效要手動更新
- Ollama RAG 在本機，Vercel 連不上時會回 FAQ fallback（不卡 30 秒）
- 羽拍有約 (@014uppgb) 的 Rich Menu 尚未設定（token 不同）

---

## LINE 環境變數（Vercel 上已設）

| 變數 | 值 |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL（已設） |
| `LINE_CHANNEL_ACCESS_TOKEN` | 目前有效 token（不要按 Reissue） |
| `LINE_CHANNEL_SECRET` | `3a167c3e7581e5ad74511d43888d4b3f` |
| `OLLAMA_URL` | `http://localhost:11434` |

## 固定網域

| 服務 | 網址 |
|---|---|
| Vercel | `https://smartlocker-alpha.vercel.app` |
| LIFF 預約租拍 | `https://liff.line.me/1660947211-EAehh2nJ` |
| LIFF 我的訂單 | `https://liff.line.me/1660947211-YQ0WHvW3` |
| LIFF 預訂場地 | `https://liff.line.me/1660947211-e5z12ax6` |
| 我的訂位 | `https://difly-booking.vercel.app/bookings` |

## 下一步

將 kiosk 端 `sheet.ini` 指向 Vercel（各店不同的 slug）

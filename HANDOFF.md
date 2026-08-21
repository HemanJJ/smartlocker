---

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

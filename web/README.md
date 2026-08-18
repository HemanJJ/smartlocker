# smartlocker web — 羽拍穿線服務（原地取代租拍）

Next.js 16 App Router 專案，部署在 Vercel + Neon PostgreSQL，LINE bot 為「迪飛羽球館 @647ntnvu」。
原「租拍／取件碼」業務已停止，本專案原地改為**穿線服務**（租拍的 `venues` / `pickup_codes` 表保留不動）。

完整規格見 `/Users/defi/Desktop/projects/code/stringing/HANDOFF.md`。

## 流程

```
kiosk 下單（選線種＋磅數） → 建立訂單 → 分派空格 → LINE 通知員工「新單」
        ↓
員工後台「取件」→ 穿線中（格子釋放）
        ↓
員工後台「送回」→ 待取件（分派新空格）
        ↓
員工後台「標付款」→ 客人收到 LINE 取件通知（取件碼）
        ↓
客人 LINE 傳取件碼（綁定）或員工後台「完成取件」→ 已完成（格子釋放）
```

## 資料表（首次請求自動建立＋種子，冪等）

| 表 | 內容 |
|---|---|
| `strings` | 11 條線種（型號、線徑、特性、磅數上限、價格） |
| `locker_slots` | 格口（格號、狀態、綁定訂單），預設 22，`LOCKER_SLOT_COUNT` 可調 |
| `orders` | 單號、線種、磅數、費用、取件碼、狀態、`paid`、客人 LINE、目前格號 |

## API 端點

| 端點 | 說明 |
|---|---|
| `GET /api/strings` | 線種列表 |
| `POST /api/orders` | kiosk 下單（stringId + tension） |
| `GET /api/orders` | 員工全列表（`?status=` 篩選）；`?lineUserId=` 查客人訂單 |
| `POST /api/orders/:id/action` | 狀態操作：`take` / `return` / `pay` / `complete` |
| `GET /api/slots` | 格口狀態 |
| `POST /api/webhook` | LINE webhook（取件碼綁定＋狀態查詢、「我的ID」） |

## 環境變數（Vercel）

| Key | 說明 |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL 連線字串 |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API token（不要按 Reissue） |
| `LINE_CHANNEL_SECRET` | LINE Channel secret |
| `STAFF_LINE_USER_ID` | 員工 LINE userId（逗號分隔多人），新單通知推播到這裡 |
| `LOCKER_SLOT_COUNT` | 格口數量（首次建表時種入），預設 22 |
| `NEXT_PUBLIC_LINE_BOT_ID` | kiosk 頁顯示的加好友 ID，預設 `@647ntnvu` |
| `OLLAMA_URL` / `OLLAMA_MODEL` | 選用，LINE 客服 fallback |

## 開發

```bash
npm install
vercel env pull .env.local --environment=production   # 拉 DATABASE_URL 等
npm run dev
```

## 程式驗證（不需 Neon，用 WASM Postgres）

```bash
npm i --no-save @electric-sql/pglite tsx
npx tsx scripts/verify-stringing.ts
```

會在本機直接執行**真實的** `src/lib/stringing.ts` 程式碼（建表、種子、下單、狀態流轉、綁定、錯誤路徑），透過 `__setDbOverride` 以 PGlite 取代 Neon 連線，驗證邏輯正確性。

## 端到端測試（對真實 Neon，需 server 在跑）

```bash
npm run build && PORT=3100 npm run start   # 另一視窗
BASE_URL=http://localhost:3100 node scripts/live-e2e.mjs
```

會下一單跑完整流程（下單→取件→送回→付款→完成）並自動清理測試訂單。

## 部署

```bash
npx vercel --prod
```

表會在第一個 request 到達時自動建立＋種子（`ensureStringingSchema()` 惰性執行），不需手動 migration。

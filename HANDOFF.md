# 交接 HANDFF — 羽拍有約 / SkbApi LINE Bot

## 已完成

### LINE 生態
- [x] LINE Login Channel 建立（ID: 1660947211）
- [x] Messaging API Channel 建立（ID: 2011126145）
  - Channel Secret: `3a167c3e7581e5ad74511d43888d4b3f`
  - Channel Access Token: 見 1Password 或環境變數
  - OA ID: `@014uppgb`
- [x] Webhook endpoint `POST /api/webhook` 打通
- [x] 簽章驗證 (HMAC-SHA256)
- [x] 重複事件去重（webhookEventId 去重）
- [x] LINE 推播回覆 (Utility.ReplyMessage)

### AI 串接
- [x] Ollama (qwen2.5:14b + bge-m3) 本機執行
- [x] RAG 搜尋 → 指向 `/Users/defi/Desktop/projects/code/羽球館CRM/venue_faq.txt`
- [x] System Prompt：小羽 / 迪飛羽球館客服

### 程式碼
- `src/SkbApi/Program.cs` — ASP.NET Core Web API
- `rag_search.py` — bge-m3 向量搜尋腳本
- `kb_racket/` — 羽球知識庫目錄（可擴充）

## 進行中 / 待開發

### 優先級 1：取件碼 + Google Sheet
- 取件碼產生邏輯（6 位數字，3 天過期）
- Google Sheets API 寫入（C#）
- 取件碼 LINE 推播通知
- 取件碼衝突檢查 + 過期釋放機制

### 優先級 2：LIFF 預約頁面
- LINE LIFF Starter Kit 客製
- LINE Login 串接
- 選館、選時段 UI
- LINE Pay 付款整合

### 優先級 3：管理後台
- 訂單管理（人工歸還）
- 遠端開門
- 使用統計

### 優先級 4：機櫃整合
- SkbBridge 取件碼驗證
- 485 開鎖指令

## 已知環境

| 項目 | 值 |
|---|---|
| 專案路徑 | `/Users/defi/Desktop/projects/code/smartlocker` |
| ASP.NET Port | 5057 |
| Ollama URL | http://localhost:11434 |
| RAG FAQ | `/Users/defi/Desktop/projects/code/羽球館CRM/venue_faq.txt` |

## 啟動方式

```bash
# 終端機 1：API
cd ~/Desktop/projects/code/smartlocker/src/SkbApi
export LINE_CHANNEL_ACCESS_TOKEN=...
export LINE_CHANNEL_SECRET=3a167c3e7581e5ad74511d43888d4b3f
dotnet run

# 終端機 2：ngrok
ngrok http 5057
```

**此交接由 Codex Grill 討論整理，2026-08-16**

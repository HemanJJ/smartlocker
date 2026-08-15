# smartlocker — Agent Rules

Racket Master 智慧拍櫃：RS-485 鎖控板 + Win7 Kiosk + Google Sheet 取件碼。

**這個專案不是 LINE CRM。** 頂層 `AGENTS.md` 的 CRM 架構規則（engine / client pack、
不得 import lineEB 等）不適用於此。此處只受本檔約束。

## First Reads

1. 本檔
2. `README.md`（現況與下一步）
3. `docs/skb-doc.txt`（鎖控板協議 V3.1，唯一權威來源）
4. 要改的檔案本身

## 架構分層

```
Google Sheet ──CSV──> SheetSync ──> 本機快取
                                       │
瀏覽器 kiosk ──HTTP──> SkbBridge ──> SkbClient ──485──> 鎖控板
```

| 層 | 檔案 | 動它要小心什麼 |
|---|---|---|
| `protocol` | `src/UpusSkb.cs` | 幀格式必須完全對齊 `docs/skb-doc.txt`，改前先查手冊 |
| `bridge` | `src/SkbBridge.cs` | HTTP 端點；新增端點要同步更新 kiosk 前端 |
| `sheet` | `src/SheetSync.cs` | 網路層；**任何失敗都不得阻斷開鎖流程** |
| `ui` | `kiosk/web/index.html` | 純前端，ES5，不得引入外部相依 |
| `deploy` | `kiosk/*.bat` | **必須維持純 ASCII**，中文在 cmd 會變亂碼 |

回報時請明說動到哪一層。

## 硬性規則

- **開鎖路徑不得依賴網路。** 取件碼一律查本機快取，Sheet 只負責更新快取。
  斷網、Google 掛掉都必須還能開格。
- **`docs/skb-doc.txt` 是協議的唯一真相。** 不要憑記憶寫幀格式。
- **`kiosk/*.bat` 只能用 ASCII。** 中文說明一律寫進 `README-kiosk.md`。
- **`index.html` 維持單檔零相依。** 不要拆 CSS/JS，不要引入 CDN。
  目標瀏覽器是 Chrome 109（Win7 最後支援版本），語法保持 ES5。
- 不要把客人姓名電話放進 Google Sheet — 發布的 CSV 網址是公開的。

## 目標環境

| 項目 | 版本 | 為什麼重要 |
|---|---|---|
| Windows | 7 SP1 | 現場既有機器 |
| .NET Framework | **4.5+** | 4.0 只談 TLS 1.0，Google 要 TLS 1.2，同步會失敗 |
| C# 語法 | 對應 .NET 4.0 | 不可用 async/await、字串插值、expression-bodied |
| Chrome | 109 | Win7 最後支援版本 |

## 驗證

C# 沒有 CI，改完請在 Win7 上跑 `src/build.bat`。

前端改動可用 Node 假 DOM 驗證流程（見 README「驗證」一節），
至少要涵蓋：正常取件、門未關逾時、橋接斷線、重複用碼。

**不要在正式櫃機上直接測開鎖。** 先用 `SkbBridge.exe sim` 模擬器跑通。

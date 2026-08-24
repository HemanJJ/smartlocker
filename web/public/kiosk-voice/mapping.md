# Kiosk 語音 MVP（Taiwan 繁中 · 美佳）

> 語音檔在 `web/public/kiosk-voice/*.wav`。kiosk 可用 PowerShell `SoundPlayer` 播放（`warn-*.wav` 最高優先、蓋過其他）。

## 對照表（觸發時機 + 優先級）

| 檔名 | 文案 | 層 | 觸發時機 | 優先 |
|---|---|---|---|---|
| `welcome-1.wav` | 歡迎光臨羽拍有約！我們提供專業的羽球拍穿線服務。 | ① 歡迎/行銷 | kiosk 閒置 N 分鐘 | 低 |
| `welcome-2.wav` | 您的球拍值得最好的線材，讓羽拍有約為您服務。 | ① | 閒置輪播 | 低 |
| `marketing-1.wav` | 全館穿線服務熱烈進行中，多種頂級線材任您選擇。 | ① | 閒置輪播 | 低 |
| `marketing-2.wav` | 現場立即下單，快速穿線，讓您馬上重返球場。 | ① | 閒置輪播 | 低 |
| `guide-step1.wav` | 請在螢幕上選擇您的線種。 | ② 引導 | 走到「選線種」步驟 | 中 |
| `guide-step2.wav` | 請選擇您想要的磅數。 | ② | 走到「選磅數」步驟 | 中 |
| `guide-step3.wav` | 請確認您的訂單資訊。 | ② | 走到「確認」步驟 | 中 |
| `guide-pickup.wav` | 請輸入您的取件號碼。 | ② | 走到「取件」步驟 | 中 |
| `anon-bind.wav` | 訂單已建立！請掃描 QR 加入好友，完成綁定後即可取件。 | ③ 報幕 | **網頁下單成功時**（還未綁定） | 中 |
| `anon-order.wav` | 請依櫃號，將球拍放入櫃中。 | ③ 報幕 | **網頁「綁定完成」時**（此時已配櫃號） | 中 |
| `anon-ready.wav` | 您的球拍已穿線完成，請前來取件。 | ③ | 穿線完成通知 | 中 |
| `warn-close.wav` | 請關好櫃門，謝謝！ | ④ 警告 | 門未關 / 逾時 | **最高** |
| `warn-notclosed.wav` | 櫃門沒有關好，請確認關上。 | ④ | 門沒關好 | **最高** |
| `warn-anomaly.wav` | 系統偵測到異常，請洽詢櫃檯人員。 | ④ | 格口異常 | **最高** |

## kiosk 播放（PowerShell）

```powershell
$p = New-Object System.Media.SoundPlayer "C:\path\to\kiosk-voice\warn-close.wav"
$p.Play()          # 非同步（不卡流程）；`-Once`/警示可視需求用 PlaySync()
```

## 建議（避免吵）

- ① 歡迎/行銷：**閒置才播**（客人離開 60 秒後輪播）
- ② 引導 / ③ 報幕：**步驟/事件驅動**，短、精確
- ④ 警告：**最高優先**，一有異常**立刻插播**、蓋過其他；可重複播到門關
- 真人語音更親切——之後可用你錄的 `.wav` 替換

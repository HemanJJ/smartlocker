/**
 * SkbBridge 取件回寫接收端 — Google Apps Script
 *
 * 這支只做一件事：把 kiosk 送來的「已取件」記錄寫回 Sheet。
 * 讀取那條路不經過這裡（走發布的 CSV 網址），所以就算這支掛了，
 * 取件流程完全不受影響，記錄會留在 kiosk 本機 pickups.queue 等重送。
 *
 * ── 安裝步驟 ──────────────────────────────────────────
 * 1. 開啟您的 Google Sheet → 擴充功能 → Apps Script
 * 2. 把本檔內容整個貼上，覆蓋預設的 myFunction
 * 3. 修改下面的 TOKEN 為您自訂的密語（要和 sheet.ini 裡的 token 一致）
 * 4. 部署 → 新增部署作業 → 類型選「網頁應用程式」
 *      執行身分：我
 *      具有存取權的使用者：任何人
 * 5. 複製產生的網址，填進 kiosk 的 sheet.ini 的 posturl=
 *
 * ── 安全性說明 ───────────────────────────────────────
 * 「任何人」是 Apps Script Web App 接受未登入請求的必要設定。
 * 保護靠的是下面的 TOKEN：沒有正確 token 的請求一律拒絕。
 * 請把 TOKEN 改成一組夠長的隨機字串，不要用預設值。
 * 這支只會寫入「狀態」與「取件時間」兩欄，不會刪除或讀出任何資料。
 */

var TOKEN = '請改成一組長一點的隨機字串';

var SHEET_NAME  = '取件碼';   // 工作表名稱
var COL_CODE    = '取件碼';   // 用來比對的欄位標題
var COL_STATUS  = '狀態';     // 要寫入的狀態欄
var COL_PICKED  = '取件時間'; // 要寫入的時間欄（沒有這欄會自動略過）
var PICKED_TEXT = '已取';

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ ok: false, error: 'no_body' });
    }

    var req = JSON.parse(e.postData.contents);
    if (req.token !== TOKEN) {
      return json({ ok: false, error: 'bad_token' });
    }
    if (!req.items || !req.items.length) {
      return json({ ok: true, updated: 0 });
    }

    var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
    if (!sh) return json({ ok: false, error: 'sheet_not_found: ' + SHEET_NAME });

    var values = sh.getDataRange().getValues();
    if (values.length < 2) return json({ ok: true, updated: 0 });

    var head = values[0].map(function (h) { return String(h).trim(); });
    var iCode   = head.indexOf(COL_CODE);
    var iStatus = head.indexOf(COL_STATUS);
    var iPicked = head.indexOf(COL_PICKED);
    if (iCode < 0 || iStatus < 0) {
      return json({ ok: false, error: 'missing_columns' });
    }

    // 取件碼 → 列號（1-based，含標題列）
    var rowOf = {};
    for (var r = 1; r < values.length; r++) {
      var c = String(values[r][iCode]).trim();
      if (c) rowOf[c] = r + 1;
    }

    var updated = 0;
    for (var i = 0; i < req.items.length; i++) {
      var it = req.items[i];
      var row = rowOf[String(it.code).trim()];
      if (!row) continue;
      sh.getRange(row, iStatus + 1).setValue(PICKED_TEXT);
      if (iPicked >= 0) sh.getRange(row, iPicked + 1).setValue(it.ts || '');
      updated++;
    }

    return json({ ok: true, updated: updated, received: req.items.length });

  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// 部署後可用瀏覽器打開網址確認服務活著
function doGet() {
  return json({ ok: true, service: 'SkbBridge writeback', time: new Date().toISOString() });
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

using Google.Apis.Auth.OAuth2;
using Google.Apis.Services;
using Google.Apis.Sheets.v4;
using Google.Apis.Sheets.v4.Data;

namespace SkbApi.Services;

/// <summary>
/// Google Sheets API v4 寫入服務 — 將新產生的取件碼寫入指定 Sheet。
///
/// 使用方法：
///   1. 到 Google Cloud Console 啟用 Google Sheets API
///   2. 建立服務帳戶（Service Account），下載 JSON 金鑰
///   3. 把該服務帳戶的 email 加到你的 Sheet 的共用成員中
///   4. 在 appsettings.json 或環境變數設定 GOOGLE_SHEET_KEY_PATH
/// </summary>
public sealed class GoogleSheetsService
{
    private readonly SheetsService? _service;
    private readonly string _spreadsheetId;
    private readonly string _sheetRange;
    private readonly string _sheetName;
    private bool _ready;

    public GoogleSheetsService(IConfiguration config)
    {
        var keyPath = config["GOOGLE_SHEET_KEY_PATH"]
                      ?? Environment.GetEnvironmentVariable("GOOGLE_SHEET_KEY_PATH");
        _spreadsheetId = config["GOOGLE_SPREADSHEET_ID"]
                         ?? Environment.GetEnvironmentVariable("GOOGLE_SPREADSHEET_ID") ?? "";
        _sheetName = config["GOOGLE_SHEET_NAME"] ?? "取件碼";
        _sheetRange = $"{_sheetName}!A:D";

        if (string.IsNullOrEmpty(keyPath) || string.IsNullOrEmpty(_spreadsheetId))
        {
            Console.WriteLine("[Google Sheets] 未設定（省略：需 GOOGLE_SHEET_KEY_PATH + GOOGLE_SPREADSHEET_ID）");
            return;
        }

        try
        {
            GoogleCredential credential;
            using (var stream = new FileStream(keyPath, FileMode.Open, FileAccess.Read))
            {
                credential = GoogleCredential.FromStream(stream)
                    .CreateScoped(SheetsService.Scope.Spreadsheets);
            }

            _service = new SheetsService(new BaseClientService.Initializer
            {
                HttpClientInitializer = credential,
                ApplicationName = "RacketMaster SkbApi"
            });

            _ready = true;
            Console.WriteLine("[Google Sheets] 初始化完成");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Google Sheets] 初始化失敗：{ex.Message}");
        }
    }

    public bool IsReady => _ready;

    /// <summary>
    /// 將一筆取件碼寫入 Sheet。若該格已有未取件碼則覆蓋。返回是否成功。</summary>
    public async Task<bool> WritePickupCode(string code, int cell, DateTime expiry)
    {
        if (!_ready) return false;

        try
        {
            // 1. 讀取現有資料檢查該格是否已有待取碼
            var rangeReq = _service!.Spreadsheets.Values.Get(_spreadsheetId, _sheetRange);
            var rangeResp = await rangeReq.ExecuteAsync();
            var values = rangeResp.Values ?? new List<IList<object>>();
            var header = values.Count > 0 ? values[0] : null;

            int colCode = -1, colCell = -1, colStatus = -1, colExpiry = -1;
            for (int i = 0; header != null && i < header.Count; i++)
            {
                var h = header[i]?.ToString()?.Trim() ?? "";
                if (h is "取件碼" or "code" or "Code") colCode = i;
                if (h is "格號" or "cell" or "Cell") colCell = i;
                if (h is "狀態" or "status" or "Status") colStatus = i;
                if (h is "到期時間" or "expiry" or "Expiry") colExpiry = i;
            }

            if (colCode < 0 || colCell < 0)
            {
                Console.WriteLine("[Google Sheets] 找不到必要欄位（取件碼/格號）");
                return false;
            }

            // 檢查該格已有未取碼 → 覆蓋
            int? overwriteRow = null;
            for (int r = 1; r < values.Count; r++)
            {
                var row = values[r];
                if (row.Count <= colCell) continue;
                var cellVal = row[colCell]?.ToString()?.Trim() ?? "";
                if (cellVal == cell.ToString())
                {
                    var status = colStatus >= 0 && row.Count > colStatus
                        ? (row[colStatus]?.ToString()?.Trim() ?? "") : "";
                    if (status.Length == 0 || status == "待取" || status == "pending" || status == "ready")
                    {
                        overwriteRow = r + 1; // 1-based
                        break;
                    }
                }
            }

            if (overwriteRow.HasValue)
            {
                // 覆蓋已有未取碼
                var updateRange = $"{_sheetName}!A{overwriteRow.Value}:D{overwriteRow.Value}";
                var updateBody = new ValueRange
                {
                    Values = new List<IList<object>>
                    {
                        new List<object> { code, cell.ToString(), "待取", expiry.ToString("yyyy-MM-ddTHH:mm:ssZ") }
                    }
                };
                var updateReq = _service.Spreadsheets.Values.Update(updateBody, _spreadsheetId, updateRange);
                updateReq.ValueInputOption = SpreadsheetsResource.ValuesResource.UpdateRequest.ValueInputOptionEnum.USERENTERED;
                await updateReq.ExecuteAsync();
                Console.WriteLine($"[Google Sheets] 覆蓋格{cell}: {code}");
            }
            else
            {
                // 新增一列
                var appendBody = new ValueRange
                {
                    Values = new List<IList<object>>
                    {
                        new List<object> { code, cell.ToString(), "待取", expiry.ToString("yyyy-MM-ddTHH:mm:ssZ") }
                    }
                };
                var appendReq = _service.Spreadsheets.Values.Append(appendBody, _spreadsheetId, _sheetRange);
                appendReq.ValueInputOption = SpreadsheetsResource.ValuesResource.AppendRequest.ValueInputOptionEnum.USERENTERED;
                await appendReq.ExecuteAsync();
                Console.WriteLine($"[Google Sheets] 新增格{cell}: {code}");
            }

            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Google Sheets] 寫入失敗：{ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// 從 Sheet 讀取所有取件碼（啟動時載入用）。</summary>
    public async Task<List<SheetCodeEntry>> ReadAllCodes()
    {
        var result = new List<SheetCodeEntry>();
        if (!_ready) return result;

        try
        {
            var rangeReq = _service!.Spreadsheets.Values.Get(_spreadsheetId, _sheetRange);
            var rangeResp = await rangeReq.ExecuteAsync();
            var values = rangeResp.Values ?? new List<IList<object>>();
            if (values.Count < 2) return result;

            var header = values[0];
            int colCode = -1, colCell = -1, colStatus = -1, colExpiry = -1;
            for (int i = 0; header != null && i < header.Count; i++)
            {
                var h = header[i]?.ToString()?.Trim() ?? "";
                if (h is "取件碼" or "code" or "Code") colCode = i;
                if (h is "格號" or "cell" or "Cell") colCell = i;
                if (h is "狀態" or "status" or "Status") colStatus = i;
                if (h is "到期時間" or "expiry" or "Expiry") colExpiry = i;
            }

            for (int r = 1; r < values.Count; r++)
            {
                var row = values[r];
                if (row.Count <= colCode) continue;

                var entry = new SheetCodeEntry
                {
                    Code = row[colCode]?.ToString()?.Trim() ?? "",
                    Cell = colCell >= 0 && row.Count > colCell && int.TryParse(row[colCell]?.ToString()?.Trim(), out var cell) ? cell : 0,
                    Status = colStatus >= 0 && row.Count > colStatus ? (row[colStatus]?.ToString()?.Trim() ?? "") : "",
                    Expiry = colExpiry >= 0 && row.Count > colExpiry ? (row[colExpiry]?.ToString()?.Trim() ?? "") : ""
                };

                if (!string.IsNullOrEmpty(entry.Code))
                    result.Add(entry);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Google Sheets] 讀取失敗：{ex.Message}");
        }

        return result;
    }
}

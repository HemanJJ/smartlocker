using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

/*
 * SheetSync.cs — Google Sheet ↔ 本機快取同步（.NET Framework 4.0+）
 *
 * 設計原則：**開鎖永遠查本機，網路只負責更新本機**。
 *   斷網、Google 掛掉、Sheet 被改壞，都不影響已經同步下來的取件碼。
 *
 * 讀取：Sheet →「檔案 → 共用 → 發布到網路 → CSV」得到的公開網址
 *       每 N 秒抓一次，成功就覆寫本機快取 codes.cache.csv
 *       程式啟動時先讀快取，所以開機沒網路也能立刻服務
 *
 * 回寫：取件完成寫進 pickups.queue（本機），背景執行緒定期 POST 到
 *       Apps Script Web App。沒設定 posturl 就只留在本機，隨時可匯出。
 *       ★ 回寫失敗絕不影響開鎖流程 ★
 *
 * Sheet 欄位（第一列為標題，中英皆可辨識）：
 *   取件碼 | 格號 | 狀態 | 備註
 *   code   | cell | status | note
 *   狀態：待取 / 已取 / 停用（空白視同「待取」）
 */
namespace RacketMaster.Skb
{
    public sealed class CodeEntry
    {
        public string Code;
        public int Cell;
        public string Status;
        public string Note;

        public bool Pickable
        {
            get
            {
                string s = (Status ?? "").Trim();
                if (s.Length == 0) return true;
                return s == "待取" || s == "待取件" ||
                       s.Equals("pending", StringComparison.OrdinalIgnoreCase) ||
                       s.Equals("ready", StringComparison.OrdinalIgnoreCase);
            }
        }
    }

    public sealed class SheetSync
    {
        /* ---- 設定 ---- */
        public string CsvUrl = "";
        public string PostUrl = "";
        public string Token = "";
        public int IntervalSec = 60;
        public string CacheFile = "codes.cache.csv";
        public string QueueFile = "pickups.queue";

        /* ---- 狀態 ---- */
        private readonly Dictionary<string, CodeEntry> _codes =
            new Dictionary<string, CodeEntry>(StringComparer.OrdinalIgnoreCase);
        private readonly List<string[]> _queue = new List<string[]>(); // {ts, code, cell}
        private readonly object _lock = new object();
        private volatile bool _running;

        public DateTime LastSync = DateTime.MinValue;
        public string LastError = "";
        public int CodeCount { get { lock (_lock) { return _codes.Count; } } }
        public int QueueCount { get { lock (_lock) { return _queue.Count; } } }

        /* ================= 啟動 ================= */

        public void Start()
        {
            EnableModernTls();
            LoadCacheFromDisk();
            LoadQueueFromDisk();

            _running = true;
            var t = new Thread(Loop);
            t.IsBackground = true;
            t.Start();
        }

        public void Stop() { _running = false; }

        private void Loop()
        {
            // 啟動後立刻同步一次，之後照間隔
            while (_running)
            {
                if (CsvUrl.Length > 0)
                {
                    string err;
                    if (SyncNow(out err))
                        Console.WriteLine("[同步] Sheet 已更新，取件碼 " + CodeCount + " 筆");
                    else
                        Console.WriteLine("[同步] 失敗（continue 使用本機快取）：" + err);
                }
                FlushQueue();

                for (int i = 0; i < IntervalSec && _running; i++) Thread.Sleep(1000);
            }
        }

        /// <summary>
        /// .NET 4.0 預設只談到 TLS 1.0，Google 端要求 TLS 1.2 會直接連不上。
        /// 這裡用數值強制指定（3072=TLS1.2, 768=TLS1.1, 192=TLS1.0）。
        /// 注意：機器上必須裝有 .NET Framework 4.5 以上，這個設定才會生效。
        /// </summary>
        private static void EnableModernTls()
        {
            int[] tries = { 3072 | 768 | 192, 3072 | 768, 3072 };
            foreach (int v in tries)
            {
                try
                {
                    ServicePointManager.SecurityProtocol = (SecurityProtocolType)v;
                    return;
                }
                catch (NotSupportedException) { }
                catch (ArgumentException) { }
            }
            Console.WriteLine("[警告] 無法啟用 TLS 1.2，連 Google 可能會失敗。");
            Console.WriteLine("       請確認這台機器已安裝 .NET Framework 4.5 以上。");
        }

        /* ================= 讀取：CSV → 本機 ================= */

        public bool SyncNow(out string error)
        {
            error = "";
            if (CsvUrl.Length == 0) { error = "未設定 csv 網址"; LastError = error; return false; }

            string text;
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(CsvUrl);
                req.Method = "GET";
                req.Timeout = 12000;
                req.ReadWriteTimeout = 12000;
                req.UserAgent = "SkbBridge/1.0";
                req.AllowAutoRedirect = true;   // 發布網址會 302
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    text = sr.ReadToEnd();
            }
            catch (Exception ex)
            {
                error = ex.Message;
                LastError = error;
                return false;
            }

            if (text.IndexOf("<html", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                error = "拿到的是 HTML 不是 CSV — 請確認 Sheet 已『發布到網路』且格式選 CSV";
                LastError = error;
                return false;
            }

            Dictionary<string, CodeEntry> parsed;
            try { parsed = ParseSheet(text); }
            catch (Exception ex) { error = "CSV 解析失敗：" + ex.Message; LastError = error; return false; }

            if (parsed.Count == 0)
            {
                error = "解析後 0 筆資料，保留舊快取不覆寫";
                LastError = error;
                return false;
            }

            lock (_lock)
            {
                _codes.Clear();
                foreach (var kv in parsed) _codes[kv.Key] = kv.Value;
                // 已在本機標記取件、但還沒回寫成功的，覆蓋回「已取」，避免重複開格
                foreach (string[] q in _queue)
                {
                    if (_codes.ContainsKey(q[1])) _codes[q[1]].Status = "已取";
                }
                LastSync = DateTime.Now;
                LastError = "";
            }

            try { File.WriteAllText(PathOf(CacheFile), text, new UTF8Encoding(false)); }
            catch { /* 快取寫不進去不算致命 */ }

            return true;
        }

        private void LoadCacheFromDisk()
        {
            string p = PathOf(CacheFile);
            if (!File.Exists(p)) return;
            try
            {
                var parsed = ParseSheet(File.ReadAllText(p, Encoding.UTF8));
                lock (_lock) { foreach (var kv in parsed) _codes[kv.Key] = kv.Value; }
                Console.WriteLine("[快取] 已載入本機取件碼 " + parsed.Count + " 筆（尚未連線 Google）");
            }
            catch (Exception ex) { Console.WriteLine("[快取] 載入失敗：" + ex.Message); }
        }

        /* ---- 欄位對應：中英標題都認，認不出就用前三欄 ---- */
        private static Dictionary<string, CodeEntry> ParseSheet(string csv)
        {
            var rows = ParseCsv(csv);
            var map = new Dictionary<string, CodeEntry>(StringComparer.OrdinalIgnoreCase);
            if (rows.Count == 0) return map;

            int cCode = -1, cCell = -1, cStatus = -1, cNote = -1;
            string[] head = rows[0];
            for (int i = 0; i < head.Length; i++)
            {
                string h = head[i].Trim().ToLower();
                if (h == "取件碼" || h == "取件码" || h == "code" || h == "pickup" || h == "pickupcode") cCode = i;
                else if (h == "格號" || h == "格号" || h == "cell" || h == "cellno" || h == "格位") cCell = i;
                else if (h == "狀態" || h == "状态" || h == "status") cStatus = i;
                else if (h == "備註" || h == "备注" || h == "note" || h == "remark") cNote = i;
            }

            int start = 1;
            if (cCode < 0 || cCell < 0)
            {
                // 沒有可辨識的標題列 → 當作沒有標題，用前三欄
                cCode = 0; cCell = 1; cStatus = 2; cNote = 3;
                start = 0;
            }

            for (int r = start; r < rows.Count; r++)
            {
                string[] row = rows[r];
                if (row.Length <= cCode || row.Length <= cCell) continue;

                string code = row[cCode].Trim();
                if (code.Length == 0) continue;

                int cell;
                if (!int.TryParse(row[cCell].Trim(), out cell)) continue;
                if (cell < 1) continue;

                var e = new CodeEntry();
                e.Code = code;
                e.Cell = cell;
                e.Status = (cStatus >= 0 && row.Length > cStatus) ? row[cStatus].Trim() : "";
                e.Note = (cNote >= 0 && row.Length > cNote) ? row[cNote].Trim() : "";
                map[code] = e;
            }
            return map;
        }

        /// <summary>標準 CSV 解析：處理雙引號包覆、欄內逗號、欄內換行、跳脫的 ""</summary>
        private static List<string[]> ParseCsv(string text)
        {
            var rows = new List<string[]>();
            var row = new List<string>();
            var f = new StringBuilder();
            bool inQ = false;

            if (text.Length > 0 && text[0] == '﻿') text = text.Substring(1); // 去 BOM

            for (int i = 0; i < text.Length; i++)
            {
                char c = text[i];
                if (inQ)
                {
                    if (c == '"')
                    {
                        if (i + 1 < text.Length && text[i + 1] == '"') { f.Append('"'); i++; }
                        else inQ = false;
                    }
                    else f.Append(c);
                }
                else
                {
                    if (c == '"') inQ = true;
                    else if (c == ',') { row.Add(f.ToString()); f.Length = 0; }
                    else if (c == '\r') { /* 跳過，交給 \n 處理 */ }
                    else if (c == '\n')
                    {
                        row.Add(f.ToString()); f.Length = 0;
                        rows.Add(row.ToArray()); row.Clear();
                    }
                    else f.Append(c);
                }
            }
            if (f.Length > 0 || row.Count > 0) { row.Add(f.ToString()); rows.Add(row.ToArray()); }
            return rows;
        }

        /* ================= 查詢 ================= */

        public CodeEntry Lookup(string code)
        {
            if (code == null) return null;
            code = code.Trim();
            lock (_lock)
            {
                CodeEntry e;
                return _codes.TryGetValue(code, out e) ? e : null;
            }
        }

        /* ================= 回寫：本機佇列 → Apps Script ================= */

        /// <summary>標記取件完成：立刻改本機狀態（防重複開格），並排入回寫佇列</summary>
        public void MarkPicked(string code, int cell)
        {
            lock (_lock)
            {
                CodeEntry e;
                if (_codes.TryGetValue(code, out e)) e.Status = "已取";
                _queue.Add(new string[] { DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"), code, cell.ToString() });
            }
            SaveQueueToDisk();
        }

        private void LoadQueueFromDisk()
        {
            string p = PathOf(QueueFile);
            if (!File.Exists(p)) return;
            try
            {
                foreach (string line in File.ReadAllLines(p, Encoding.UTF8))
                {
                    string[] parts = line.Split(',');
                    if (parts.Length >= 3) _queue.Add(new string[] { parts[0], parts[1], parts[2] });
                }
                if (_queue.Count > 0)
                    Console.WriteLine("[佇列] 有 " + _queue.Count + " 筆取件記錄尚未回寫");
            }
            catch { }
        }

        private void SaveQueueToDisk()
        {
            try
            {
                var sb = new StringBuilder();
                lock (_lock)
                    foreach (string[] q in _queue) sb.Append(q[0]).Append(',').Append(q[1]).Append(',').Append(q[2]).Append("\r\n");
                File.WriteAllText(PathOf(QueueFile), sb.ToString(), new UTF8Encoding(false));
            }
            catch { }
        }

        /// <summary>嘗試把佇列 POST 出去。失敗就原封不動留著，下輪再試。</summary>
        public void FlushQueue()
        {
            if (PostUrl.Length == 0) return;

            string[][] batch;
            lock (_lock)
            {
                if (_queue.Count == 0) return;
                batch = _queue.ToArray();
            }

            var sb = new StringBuilder();
            sb.Append("{\"token\":\"").Append(JsonEsc(Token)).Append("\",\"items\":[");
            for (int i = 0; i < batch.Length; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append("{\"ts\":\"").Append(JsonEsc(batch[i][0]))
                  .Append("\",\"code\":\"").Append(JsonEsc(batch[i][1]))
                  .Append("\",\"cell\":").Append(batch[i][2]).Append('}');
            }
            sb.Append("]}");

            try
            {
                byte[] body = Encoding.UTF8.GetBytes(sb.ToString());
                var req = (HttpWebRequest)WebRequest.Create(PostUrl);
                req.Method = "POST";
                req.ContentType = "application/json; charset=utf-8";
                req.ContentLength = body.Length;
                req.Timeout = 12000;
                req.ReadWriteTimeout = 12000;
                req.AllowAutoRedirect = true;   // Apps Script 會 302 到 script.googleusercontent.com
                using (Stream s = req.GetRequestStream()) s.Write(body, 0, body.Length);
                using (var resp = (HttpWebResponse)req.GetResponse())
                {
                    if (resp.StatusCode == HttpStatusCode.OK)
                    {
                        lock (_lock) _queue.RemoveRange(0, Math.Min(batch.Length, _queue.Count));
                        SaveQueueToDisk();
                        Console.WriteLine("[回寫] 已送出 " + batch.Length + " 筆取件記錄");
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("[回寫] 失敗，保留於本機佇列：" + ex.Message);
            }
        }

        /* ---- 工具 ---- */

        private static string PathOf(string file)
        {
            if (Path.IsPathRooted(file)) return file;
            return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, file);
        }

        private static string JsonEsc(string s)
        {
            if (s == null) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");
        }
    }
}

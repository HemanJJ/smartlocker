using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using RacketMaster.Skb;

/*
 * SkbBridge — 本機 HTTP ↔ RS-485 橋接服務（Win7 + .NET Framework 4.x）
 *
 * 目的：瀏覽器（kiosk index.html）碰不到 COM 埠，由本程式代為送 485 指令。
 *
 *   瀏覽器 --XHR--> http://localhost:8080/unlock?cell=7 --> SkbClient --485--> 鎖控板
 *
 * 用法：
 *   SkbBridge.exe                       預設 COM3 / 9600 / HTTP 8080 / 22 格
 *   SkbBridge.exe port=COM5 baud=19200  指定串口與波特率
 *   SkbBridge.exe sim                   模擬器模式（免硬體，前端可完整開發）
 *   SkbBridge.exe http=9000 cells=22    改 HTTP 埠與總格數
 *   SkbBridge.exe chpb=25 addr=1        每板通道數 / 首板位址（格號自動換算）
 *
 * Google Sheet（選用，見 SheetSync.cs）：
 *   SkbBridge.exe csv=<發布到網路的CSV網址> [sync=60] [posturl=<AppsScript網址>] [token=xxx]
 *   或把上面幾行寫進同目錄的 sheet.ini（每行 key=value），免得命令列太長。
 *
 * 端點（全部回 JSON，皆已加 CORS 標頭）：
 *   GET /health              服務與連線狀態（含 Sheet 同步狀態）
 *   GET /scan                DF 廣播尋址（診斷用）
 *   GET /unlock?cell=7       E2 開第 7 格
 *   GET /doors               D2 讀全部格位門磁（open=true 表門開）
 *   GET /events              取出並清空 A0 自動上傳事件佇列
 *   GET /code?value=1234     查取件碼 → 格號（查本機快取，不連網）
 *   GET /picked?value=1234   標記取件完成（本機立即生效，回寫排入背景佇列）
 *   GET /sync                立刻強制同步一次 Google Sheet
 *
 * 格號映射：預設用公式（第 1~25 格→板1 通道1~25，第 26 格→板2 通道1…）。
 *           若同目錄有 cells.csv（每行 `格號,板位址,通道`）則以該表優先。
 */
namespace RacketMaster.SkbBridge
{
    /* ================= 格號 → (板位址, 通道) 映射 ================= */

    internal sealed class CellMap
    {
        private readonly Dictionary<int, int[]> _explicitMap = new Dictionary<int, int[]>();

        public int ChannelsPerBoard = 25;
        public int FirstBoardAddr = 1;

        public int ExplicitCount { get { return _explicitMap.Count; } }

        /// <summary>讀 cells.csv：每行 `格號,板位址,通道`，# 開頭為註解</summary>
        public void Load(string path)
        {
            if (!File.Exists(path)) return;
            foreach (string raw in File.ReadAllLines(path))
            {
                string line = raw.Trim();
                if (line.Length == 0 || line[0] == '#') continue;
                string[] p = line.Split(',');
                if (p.Length < 3) continue;
                int cell, board, ch;
                if (!int.TryParse(p[0].Trim(), out cell)) continue;
                if (!int.TryParse(p[1].Trim(), out board)) continue;
                if (!int.TryParse(p[2].Trim(), out ch)) continue;
                _explicitMap[cell] = new int[] { board, ch };
            }
        }

        public bool TryGet(int cell, out byte board, out byte ch)
        {
            board = 0; ch = 0;
            if (cell < 1) return false;

            if (_explicitMap.ContainsKey(cell))
            {
                int[] v = _explicitMap[cell];
                board = (byte)v[0]; ch = (byte)v[1];
                return true;
            }

            int idx = cell - 1;
            board = (byte)(FirstBoardAddr + idx / ChannelsPerBoard);
            ch = (byte)(idx % ChannelsPerBoard + 1);
            return true;
        }
    }

    /* ================= 主程式 ================= */

    internal static class BridgeMain
    {
        private static readonly object _gate = new object();
        private static SkbClient _client;
        private static CellMap _map = new CellMap();

        private static readonly List<string> _events = new List<string>();
        private static readonly object _evLock = new object();

        private static bool _sim;
        private static string _portName = "COM3";
        private static int _baud = 9600;
        private static int _httpPort = 8080;
        private static int _totalCells = 22;
        private static string _lastError = "";
        private static SheetSync _sheet = new SheetSync();

        private static int Main(string[] args)
        {
            // sheet.ini 先讀，命令列參數可覆蓋
            ApplySettings(ReadIni(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "sheet.ini")));
            ApplySettings(args);

            string csv = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "cells.csv");
            _map.Load(csv);

            Console.WriteLine("===== SkbBridge — 智慧拍櫃 HTTP↔RS-485 橋接 =====");
            Console.WriteLine("  模式      ： " + (_sim ? "模擬器（無硬體）" : "串口 " + _portName + " @ " + _baud));
            Console.WriteLine("  HTTP      ： http://localhost:" + _httpPort + "/");
            Console.WriteLine("  總格數    ： " + _totalCells);
            Console.WriteLine("  格號映射  ： " + (_map.ExplicitCount > 0
                ? "cells.csv（" + _map.ExplicitCount + " 筆）"
                : "公式（每板 " + _map.ChannelsPerBoard + " 路，首板位址 " + _map.FirstBoardAddr + "）"));
            Console.WriteLine("  取件碼來源： " + (_sheet.CsvUrl.Length > 0
                ? "Google Sheet CSV（每 " + _sheet.IntervalSec + " 秒同步）"
                : "未設定 — 前端會退回內建 DEMO 測試碼"));
            Console.WriteLine("  取件回寫  ： " + (_sheet.PostUrl.Length > 0
                ? "Apps Script（背景佇列，失敗不影響開鎖）"
                : "未設定 — 僅記錄於本機 pickups.queue"));
            Console.WriteLine();

            _sheet.Start();

            var listener = new HttpListener();
            listener.Prefixes.Add("http://localhost:" + _httpPort + "/");
            listener.Prefixes.Add("http://127.0.0.1:" + _httpPort + "/");
            try
            {
                listener.Start();
            }
            catch (HttpListenerException ex)
            {
                Console.WriteLine("[!!] HTTP 埠啟動失敗：" + ex.Message);
                Console.WriteLine();
                Console.WriteLine("多半是權限問題。二選一：");
                Console.WriteLine("  (A) 以「系統管理員身分」執行本程式");
                Console.WriteLine("  (B) 用管理員命令列跑一次授權（只需一次）：");
                Console.WriteLine("      netsh http add urlacl url=http://localhost:" + _httpPort + "/ user=Everyone");
                Console.WriteLine("      netsh http add urlacl url=http://127.0.0.1:" + _httpPort + "/ user=Everyone");
                Console.WriteLine();
                Console.WriteLine("按任意鍵結束…");
                Console.ReadKey(true);
                return 3;
            }

            Console.WriteLine("[OK] 服務已啟動，等待前端呼叫。按 Ctrl+C 結束。");
            string web = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "web");
            if (File.Exists(Path.Combine(web, "index.html")))
                Console.WriteLine("     Kiosk 網頁：http://localhost:" + _httpPort + "/");
            else
                Console.WriteLine("     （web\\index.html 不存在，僅提供 API；kiosk 網頁請自行開啟）");
            Console.WriteLine("     健康檢查：http://localhost:" + _httpPort + "/health");
            Console.WriteLine();

            while (true)
            {
                HttpListenerContext ctx;
                try { ctx = listener.GetContext(); }
                catch (Exception) { break; }
                Handle(ctx);
            }
            return 0;
        }

        /* ---- 485 連線（惰性建立、失敗自動重連）---- */

        private static void Ensure()
        {
            if (_client != null) return;
            ISkbTransport t = _sim
                ? (ISkbTransport)new SimBoardTransport((byte)_map.FirstBoardAddr, _map.ChannelsPerBoard)
                : new SerialTransport(_portName, _baud);
            var c = new SkbClient(t);
            c.AutoUpload += OnAutoUpload;
            c.Open();
            _client = c;
            _lastError = "";
            Console.WriteLine("[連線] " + (_sim ? "模擬器已就緒" : _portName + " 已開啟"));
        }

        private static void Drop(string why)
        {
            _lastError = why;
            if (_client != null)
            {
                try { _client.Close(); } catch { }
                _client = null;
            }
            Console.WriteLine("[斷線] " + why + "（下次請求會自動重連）");
        }

        private static void OnAutoUpload(byte board, byte ch, byte sig)
        {
            // 反查格號：找出映射到這個 (board, ch) 的格子
            int cell = -1;
            for (int i = 1; i <= _totalCells; i++)
            {
                byte b, c;
                if (_map.TryGet(i, out b, out c) && b == board && c == ch) { cell = i; break; }
            }
            string json = "{\"board\":" + board + ",\"ch\":" + ch
                        + ",\"cell\":" + cell
                        + ",\"open\":" + (sig != 0 ? "true" : "false")
                        + ",\"ts\":" + Now() + "}";
            lock (_evLock)
            {
                _events.Add(json);
                if (_events.Count > 200) _events.RemoveRange(0, _events.Count - 200);
            }
            Console.WriteLine("  [A0] 板" + board + " 通道" + ch + " → 格" + cell
                            + " " + (sig != 0 ? "門開" : "門關"));
        }

        /* ---- 路由 ---- */

        private static void Handle(HttpListenerContext ctx)
        {
            string path = ctx.Request.Url.AbsolutePath.ToLower();

            if (ctx.Request.HttpMethod == "OPTIONS") { Send(ctx, 204, ""); return; }

            try
            {
                lock (_gate)
                {
                    switch (path)
                    {
                        case "/health": DoHealth(ctx); return;
                        case "/scan": DoScan(ctx); return;
                        case "/unlock": DoUnlock(ctx); return;
                        case "/doors": DoDoors(ctx); return;
                        case "/events": DoEvents(ctx); return;
                        case "/code": DoCode(ctx); return;
                        case "/picked": DoPicked(ctx); return;
                        case "/sync": DoSync(ctx); return;
                        default:
                            if (ServeStatic(ctx, path)) return;
                            Send(ctx, 404, "{\"ok\":false,\"error\":\"unknown_endpoint\",\"path\":\"" + Esc(path) + "\"}");
                            return;
                    }
                }
            }
            catch (TimeoutException ex)
            {
                Drop("逾時：" + ex.Message);
                Send(ctx, 504, "{\"ok\":false,\"error\":\"timeout\",\"message\":\"" + Esc(ex.Message) + "\"}");
            }
            catch (Exception ex)
            {
                Drop(ex.Message);
                Send(ctx, 500, "{\"ok\":false,\"error\":\"exception\",\"message\":\"" + Esc(ex.Message) + "\"}");
            }
        }

        private static void DoHealth(HttpListenerContext ctx)
        {
            bool up = true;
            string err = "";
            try { Ensure(); }
            catch (Exception ex) { up = false; err = ex.Message; }

            var sb = new StringBuilder();
            sb.Append("{\"ok\":").Append(up ? "true" : "false");
            sb.Append(",\"mode\":\"").Append(_sim ? "sim" : "serial").Append("\"");
            sb.Append(",\"port\":\"").Append(Esc(_portName)).Append("\"");
            sb.Append(",\"baud\":").Append(_baud);
            sb.Append(",\"cells\":").Append(_totalCells);
            sb.Append(",\"channelsPerBoard\":").Append(_map.ChannelsPerBoard);
            sb.Append(",\"sheet\":").Append(_sheet.CsvUrl.Length > 0 ? "true" : "false");
            sb.Append(",\"codes\":").Append(_sheet.CodeCount);
            sb.Append(",\"pendingWrites\":").Append(_sheet.QueueCount);
            sb.Append(",\"lastSync\":\"").Append(_sheet.LastSync == DateTime.MinValue
                ? "" : _sheet.LastSync.ToString("HH:mm:ss")).Append("\"");
            sb.Append(",\"sheetError\":\"").Append(Esc(_sheet.LastError)).Append("\"");
            sb.Append(",\"lastError\":\"").Append(Esc(up ? _lastError : err)).Append("\"}");
            Send(ctx, up ? 200 : 503, sb.ToString());
        }

        private static void DoScan(HttpListenerContext ctx)
        {
            Ensure();
            byte addr = _client.ScanAddress();
            Send(ctx, 200, "{\"ok\":true,\"address\":" + addr + "}");
        }

        private static void DoUnlock(HttpListenerContext ctx)
        {
            int cell = QInt(ctx, "cell", -1);
            byte board, ch;
            if (!_map.TryGet(cell, out board, out ch) || cell > _totalCells)
            {
                Send(ctx, 400, "{\"ok\":false,\"error\":\"bad_cell\",\"cell\":" + cell + "}");
                return;
            }

            Ensure();
            Console.WriteLine("[開鎖] 格" + cell + " → 板" + board + " 通道" + ch);
            byte sig = _client.Unlock(board, ch);
            Send(ctx, 200, "{\"ok\":true,\"cell\":" + cell + ",\"board\":" + board
                         + ",\"ch\":" + ch + ",\"open\":" + (sig != 0 ? "true" : "false") + "}");
        }

        private static void DoDoors(HttpListenerContext ctx)
        {
            Ensure();

            // 每塊板只讀一次 D2，再分配回各格
            var perBoard = new Dictionary<byte, bool[]>();
            for (int cell = 1; cell <= _totalCells; cell++)
            {
                byte b, c;
                if (!_map.TryGet(cell, out b, out c)) continue;
                if (!perBoard.ContainsKey(b))
                    perBoard[b] = _client.ReadSignals(b, _map.ChannelsPerBoard);
            }

            var sb = new StringBuilder();
            sb.Append("{\"ok\":true,\"cells\":[");
            for (int cell = 1; cell <= _totalCells; cell++)
            {
                byte b, c;
                if (!_map.TryGet(cell, out b, out c)) continue;
                bool open = perBoard[b][c - 1];   // D2: true = 斷開/低 = 門開
                if (cell > 1) sb.Append(",");
                sb.Append("{\"cell\":").Append(cell)
                  .Append(",\"board\":").Append(b)
                  .Append(",\"ch\":").Append(c)
                  .Append(",\"open\":").Append(open ? "true" : "false")
                  .Append("}");
            }
            sb.Append("]}");
            Send(ctx, 200, sb.ToString());
        }

        private static void DoEvents(HttpListenerContext ctx)
        {
            string[] batch;
            lock (_evLock)
            {
                batch = _events.ToArray();
                _events.Clear();
            }
            Send(ctx, 200, "{\"ok\":true,\"events\":[" + string.Join(",", batch) + "]}");
        }

        /* ---- 靜態網頁：讓 kiosk 直接開 http://localhost:8080/ ----
         * 同源載入，省掉 file:// 連 localhost 被瀏覽器擋的問題。
         * 網頁檔放在 SkbBridge.exe 旁邊的 web\ 資料夾。 */

        private static bool ServeStatic(HttpListenerContext ctx, string path)
        {
            string root = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "web");
            if (!Directory.Exists(root)) return false;

            string rel = (path == "/" || path.Length == 0) ? "index.html" : path.TrimStart('/');
            rel = rel.Replace('/', Path.DirectorySeparatorChar);

            string full = Path.GetFullPath(Path.Combine(root, rel));
            // 防目錄穿越：解析後的路徑必須仍在 web\ 之下
            if (!full.StartsWith(Path.GetFullPath(root), StringComparison.OrdinalIgnoreCase)) return false;
            if (!File.Exists(full)) return false;

            string ext = Path.GetExtension(full).ToLower();
            string mime = "application/octet-stream";
            if (ext == ".html" || ext == ".htm") mime = "text/html; charset=utf-8";
            else if (ext == ".js") mime = "application/javascript; charset=utf-8";
            else if (ext == ".css") mime = "text/css; charset=utf-8";
            else if (ext == ".json") mime = "application/json; charset=utf-8";
            else if (ext == ".png") mime = "image/png";
            else if (ext == ".jpg" || ext == ".jpeg") mime = "image/jpeg";
            else if (ext == ".svg") mime = "image/svg+xml";
            else if (ext == ".ico") mime = "image/x-icon";

            try
            {
                byte[] buf = File.ReadAllBytes(full);
                ctx.Response.StatusCode = 200;
                ctx.Response.ContentType = mime;
                ctx.Response.AddHeader("Cache-Control", "no-store");
                ctx.Response.ContentLength64 = buf.Length;
                ctx.Response.OutputStream.Write(buf, 0, buf.Length);
                ctx.Response.OutputStream.Close();
            }
            catch { return false; }
            return true;
        }

        /* ---- 取件碼（查本機快取，完全不連網）---- */

        private static void DoCode(HttpListenerContext ctx)
        {
            string val = ctx.Request.QueryString["value"];
            if (string.IsNullOrEmpty(val))
            {
                Send(ctx, 400, "{\"ok\":false,\"error\":\"missing_value\"}");
                return;
            }

            CodeEntry e = _sheet.Lookup(val);
            if (e == null)
            {
                Send(ctx, 200, "{\"ok\":false,\"error\":\"not_found\"}");
                return;
            }
            if (!e.Pickable)
            {
                Send(ctx, 200, "{\"ok\":false,\"error\":\"not_pickable\",\"status\":\""
                             + Esc(e.Status) + "\",\"cell\":" + e.Cell + "}");
                return;
            }
            if (e.Cell > _totalCells)
            {
                Send(ctx, 200, "{\"ok\":false,\"error\":\"cell_out_of_range\",\"cell\":" + e.Cell + "}");
                return;
            }

            Send(ctx, 200, "{\"ok\":true,\"cell\":" + e.Cell
                         + ",\"status\":\"" + Esc(e.Status) + "\""
                         + ",\"note\":\"" + Esc(e.Note) + "\"}");
        }

        /* ---- 標記取件完成（本機立即生效，回寫走背景佇列）---- */

        private static void DoPicked(HttpListenerContext ctx)
        {
            string val = ctx.Request.QueryString["value"];
            int cell = QInt(ctx, "cell", -1);
            if (string.IsNullOrEmpty(val))
            {
                Send(ctx, 400, "{\"ok\":false,\"error\":\"missing_value\"}");
                return;
            }
            _sheet.MarkPicked(val, cell);
            Console.WriteLine("[取件] 碼 " + val + " → 格" + cell + "（待回寫 " + _sheet.QueueCount + " 筆）");
            Send(ctx, 200, "{\"ok\":true,\"queued\":" + _sheet.QueueCount + "}");
        }

        private static void DoSync(HttpListenerContext ctx)
        {
            string err;
            bool ok = _sheet.SyncNow(out err);
            Send(ctx, 200, "{\"ok\":" + (ok ? "true" : "false")
                         + ",\"codes\":" + _sheet.CodeCount
                         + ",\"error\":\"" + Esc(err) + "\"}");
        }

        /* ---- 設定解析 ---- */

        private static string[] ReadIni(string path)
        {
            if (!File.Exists(path)) return new string[0];
            var list = new List<string>();
            foreach (string raw in File.ReadAllLines(path))
            {
                string line = raw.Trim();
                if (line.Length == 0 || line[0] == '#' || line[0] == ';') continue;
                list.Add(line);
            }
            return list.ToArray();
        }

        private static void ApplySettings(string[] items)
        {
            foreach (string a in items)
            {
                string s = a.Trim();
                if (s.Equals("sim", StringComparison.OrdinalIgnoreCase)) _sim = true;
                else if (s.StartsWith("port=", StringComparison.OrdinalIgnoreCase)) _portName = s.Substring(5).Trim();
                else if (s.StartsWith("baud=", StringComparison.OrdinalIgnoreCase)) _baud = int.Parse(s.Substring(5).Trim());
                else if (s.StartsWith("http=", StringComparison.OrdinalIgnoreCase)) _httpPort = int.Parse(s.Substring(5).Trim());
                else if (s.StartsWith("cells=", StringComparison.OrdinalIgnoreCase)) _totalCells = int.Parse(s.Substring(6).Trim());
                else if (s.StartsWith("chpb=", StringComparison.OrdinalIgnoreCase)) _map.ChannelsPerBoard = int.Parse(s.Substring(5).Trim());
                else if (s.StartsWith("addr=", StringComparison.OrdinalIgnoreCase)) _map.FirstBoardAddr = int.Parse(s.Substring(5).Trim());
                else if (s.StartsWith("csv=", StringComparison.OrdinalIgnoreCase)) _sheet.CsvUrl = s.Substring(4).Trim();
                else if (s.StartsWith("posturl=", StringComparison.OrdinalIgnoreCase)) _sheet.PostUrl = s.Substring(8).Trim();
                else if (s.StartsWith("token=", StringComparison.OrdinalIgnoreCase)) _sheet.Token = s.Substring(6).Trim();
                else if (s.StartsWith("sync=", StringComparison.OrdinalIgnoreCase)) _sheet.IntervalSec = int.Parse(s.Substring(5).Trim());
            }
        }

        /* ---- 工具 ---- */

        private static int QInt(HttpListenerContext ctx, string key, int def)
        {
            string v = ctx.Request.QueryString[key];
            int n;
            if (v != null && int.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out n)) return n;
            return def;
        }

        private static long Now()
        {
            return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds;
        }

        private static string Esc(string s)
        {
            if (s == null) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");
        }

        private static void Send(HttpListenerContext ctx, int status, string body)
        {
            try
            {
                byte[] buf = Encoding.UTF8.GetBytes(body);
                ctx.Response.StatusCode = status;
                ctx.Response.ContentType = "application/json; charset=utf-8";
                // 允許 file:// 開啟的頁面呼叫（origin 為 null）
                ctx.Response.AddHeader("Access-Control-Allow-Origin", "*");
                ctx.Response.AddHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
                ctx.Response.AddHeader("Access-Control-Allow-Headers", "Content-Type");
                ctx.Response.AddHeader("Cache-Control", "no-store");
                ctx.Response.ContentLength64 = buf.Length;
                ctx.Response.OutputStream.Write(buf, 0, buf.Length);
                ctx.Response.OutputStream.Close();
            }
            catch { }
        }
    }
}

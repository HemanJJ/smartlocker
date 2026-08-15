using System;
using System.Collections.Generic;
using System.Threading;
using RacketMaster.Skb;

/*
 * SkbProbe — UPUS-SKB 鎖控板 驗板/測試工具（Win7 + .NET Framework 4.x）
 *
 * 用法：
 *   SkbProbe.exe sim demo                 內建模擬器，無硬體跑完整取件流程
 *   SkbProbe.exe COM3 probe               一鍵驗板（尋址+ID+配置+信號）
 *   SkbProbe.exe COM3 sweep               【除錯】自動掃 5 種波特率，找出哪個通
 *   SkbProbe.exe COM3 raw                 【除錯】送 DF 幀並原樣 dump 收到的位元組
 *   SkbProbe.exe COM3 scan                DF 廣播尋址
 *   SkbProbe.exe COM3 id 1                DD 讀 MCU ID
 *   SkbProbe.exe COM3 config 1            D0 讀系統配置
 *   SkbProbe.exe COM3 doors 1             D2 讀全部通道信號
 *   SkbProbe.exe COM3 unlock 1 7          E2 開第 7 格
 *   SkbProbe.exe COM3 watch 1             監聽 A0 自動上傳＋每 2 秒掃信號
 *   附加參數 baud=115200 可改波特率（預設 9600）
 */
namespace RacketMaster.SkbProbe
{
    internal static class Program
    {
        private static int Main(string[] args)
        {
            // 位置參數與 baud= 分開解析（避免 baud= 被當成位址）
            int baud = 9600;
            var pos = new List<string>();
            foreach (string a in args)
            {
                if (a.StartsWith("baud=")) baud = int.Parse(a.Substring(5));
                else pos.Add(a);
            }
            if (pos.Count == 0) { Usage(); return 1; }

            try
            {
                if (pos[0].ToLower() == "sim") return RunSimDemo();

                string port = pos[0];
                string cmd = pos.Count > 1 ? pos[1].ToLower() : "probe";
                byte addr = pos.Count > 2 ? byte.Parse(pos[2]) : (byte)1;

                // 除錯指令：自行管理串口，不走 SkbClient
                if (cmd == "sweep") return CmdSweep(port);
                if (cmd == "raw") return CmdRaw(port, baud);
                if (cmd == "listen") return CmdListen(port, baud, pos.Count > 2 ? int.Parse(pos[2]) : 15);
                if (cmd == "hunt") return CmdHunt(port, baud);

                using (var client = new SkbClient(new SerialTransport(port, baud)))
                {
                    client.AutoUpload += OnAutoUpload;
                    client.Open();

                    switch (cmd)
                    {
                        case "probe":  CmdProbe(client, addr); break;
                        case "scan":
                            Console.WriteLine("DF 廣播尋址 …（注意：總線上只能接一台）");
                            Console.WriteLine("[OK] 板子位址 = " + client.ScanAddress());
                            break;
                        case "id":
                            Console.WriteLine("[OK] MCU ID = " + Hex(client.ReadMcuId(addr)));
                            break;
                        case "config":
                            Console.WriteLine("[OK] " + client.ReadConfig(addr));
                            break;
                        case "doors":  PrintSignals(client, addr); break;
                        case "unlock":
                            byte ch = pos.Count > 3 ? byte.Parse(pos[3]) : (byte)1;
                            Console.WriteLine("E2 開鎖：板{0} 第{1}格 …", addr, ch);
                            byte sig = client.Unlock(addr, ch);
                            Console.WriteLine("[OK] 已送出，回傳信號 = {0}（0=接通 1=斷開）", sig);
                            break;
                        case "watch":  CmdWatch(client, addr); break;
                        default: Usage(); return 1;
                    }
                }
                return 0;
            }
            catch (TimeoutException ex)
            {
                Console.WriteLine("[!!] 逾時：" + ex.Message);
                return 2;
            }
            catch (Exception ex)
            {
                Console.WriteLine("[!!] 錯誤：" + ex.Message);
                return 3;
            }
        }

        /* ---- 一鍵驗板 ---- */
        private static void CmdProbe(SkbClient client, byte addr)
        {
            Console.WriteLine("===== 驗板開始 =====");
            Console.Write("[1/4] DF 廣播尋址 … ");
            byte found = client.ScanAddress();
            Console.WriteLine("位址 = " + found);

            Console.Write("[2/4] DD 讀 MCU ID … ");
            Console.WriteLine(Hex(client.ReadMcuId(found)));

            Console.Write("[3/4] D0 讀系統配置 … ");
            Console.WriteLine(client.ReadConfig(found).ToString());

            Console.WriteLine("[4/4] D2 讀全部通道信號 …");
            PrintSignals(client, found);

            Console.WriteLine("===== 驗板完成：協議相符 =====");
            Console.WriteLine("（位址與 DIP 撥碼不一致時，用 " + found + " 當 addr 參數）");
        }

        /* ---- 除錯：波特率掃描 ---- */
        /// <summary>
        /// 依序用 5 種常見波特率送 DF 廣播尋址，找出板子實際使用的速率。
        /// 用途：板子若被 E0 改過波特率，用預設 9600 會永遠連不上。
        /// </summary>
        private static int CmdSweep(string port)
        {
            int[] bauds = { 9600, 19200, 38400, 57600, 115200 };
            Console.WriteLine("===== 波特率掃描：{0} =====", port);
            Console.WriteLine("（每個速率送一次 DF 廣播尋址，等 1 秒）");
            Console.WriteLine();

            int hit = 0;
            foreach (int b in bauds)
            {
                Console.Write("  {0,6} bps … ", b);
                try
                {
                    using (var c = new SkbClient(new SerialTransport(port, b)))
                    {
                        c.Open();
                        byte found = c.ScanAddress();
                        Console.WriteLine("[OK] 有回應！板子位址 = {0}", found);
                        hit = b;
                    }
                }
                catch (TimeoutException) { Console.WriteLine("無回應"); }
                catch (Exception ex) { Console.WriteLine("開埠失敗：" + ex.Message); return 3; }

                if (hit != 0) break;
                Thread.Sleep(300); // 讓串口完全釋放再開下一個
            }

            Console.WriteLine();
            if (hit != 0)
            {
                Console.WriteLine("===== 找到了：{0} bps =====", hit);
                Console.WriteLine("接線正確。後續指令請加上 baud={0}，例如：", hit);
                Console.WriteLine("    SkbProbe.exe {0} probe baud={1}", port, hit);
                return 0;
            }

            Console.WriteLine("===== 五種波特率全部無回應 =====");
            Console.WriteLine("波特率已排除，問題在物理層。請依序檢查：");
            Console.WriteLine("  1. A/B 兩條資料線對調後再掃一次（最常見原因）");
            Console.WriteLine("  2. 485 GND 是否確實接上轉換器的 GND2");
            Console.WriteLine("  3. 板子是否有獨立供電 DC 7~24V（USB 轉接頭不供電）");
            Console.WriteLine("  4. 用 raw 指令看是否有收到任何位元組");
            return 2;
        }

        /* ---- 除錯：原始位元組監看 ---- */
        /// <summary>
        /// 送 DF 廣播尋址，然後把 3 秒內收到的所有位元組原樣印出（不做組幀、不做校驗）。
        /// 判讀：
        ///   完全沒有位元組 → A/B 接反、斷線、或板子沒電
        ///   收到亂碼       → 接線正確，只是波特率錯（改用 sweep 找）
        ///   收到 55 A1 ... → 通訊完全正常
        /// </summary>
        private static int CmdRaw(string port, int baud)
        {
            Console.WriteLine("===== 原始位元組監看：{0} @ {1} bps =====", port, baud);
            var t = new SerialTransport(port, baud);
            t.Open();
            try
            {
                var got = new List<byte>();
                for (int round = 1; round <= 3; round++)
                {
                    byte[] frame = SkbFrame.Build(0xFF, SkbFrame.F_SCAN, null);
                    Console.WriteLine("[送出 {0}/3] {1}", round, Hex(frame));
                    t.Write(frame);

                    DateTime end = DateTime.Now.AddSeconds(1);
                    while (DateTime.Now < end)
                    {
                        int b = t.ReadByte(100);
                        if (b >= 0) got.Add((byte)b);
                    }
                }

                Console.WriteLine();
                if (got.Count == 0)
                {
                    Console.WriteLine("[收到] 0 個位元組 — 完全沒有任何訊號回來。");
                    Console.WriteLine();
                    Console.WriteLine("這代表問題在物理層，不是波特率。請檢查：");
                    Console.WriteLine("  1. A/B 兩條資料線接反（最常見）→ 對調後再跑一次");
                    Console.WriteLine("  2. 485 GND 沒接上轉換器的 GND2");
                    Console.WriteLine("  3. 板子沒有獨立供電（DC 7~24V）");
                    Console.WriteLine("  4. 端子螺絲沒鎖緊 / 線芯沒咬到銅");
                    return 2;
                }

                Console.WriteLine("[收到] {0} 個位元組：", got.Count);
                Console.WriteLine("  " + Hex(got.ToArray()));
                Console.WriteLine();

                if (got.Count >= 2 && got.Contains(SkbFrame.HEADER))
                {
                    Console.WriteLine("看到幀頭 0x55 — 通訊正常，波特率 {0} 正確。", baud);
                    Console.WriteLine("可以直接跑：SkbProbe.exe {0} probe baud={1}", port, baud);
                    return 0;
                }

                Console.WriteLine("收到資料但看不到幀頭 0x55 — 這是好消息：");
                Console.WriteLine("A/B 接線是對的（電氣有通），只是波特率不符才解出亂碼。");
                Console.WriteLine("請跑：SkbProbe.exe {0} sweep", port);
                return 2;
            }
            finally { t.Close(); }
        }

        /* ---- 桌邊找線模式 ---- */
        /// <summary>
        /// 每 1.5 秒送一次 DF 尋址，每次只印一行結果，**收到任何位元組就嗶一聲**。
        ///
        /// 這是給「板子就在你面前」用的：
        ///   跑起來之後，眼睛看著硬體、手直接換線，
        ///   不用看螢幕、不用按鍵、不用重跑指令。
        ///   聽到嗶聲就是接對了。
        ///
        /// 四條線找出資料對只有 6 種組合，一組 10 秒，兩分鐘可以跑完全部。
        /// </summary>
        private static int CmdHunt(string port, int baud)
        {
            Console.WriteLine("==================================================");
            Console.WriteLine("  找線模式  {0} @ {1} bps", port, baud);
            Console.WriteLine("==================================================");
            Console.WriteLine();
            Console.WriteLine("  現在開始每 1.5 秒送一次訊號。");
            Console.WriteLine("  ★ 收到任何回應會「嗶」一聲，不用一直盯著螢幕。★");
            Console.WriteLine();
            Console.WriteLine("  請依序試這 6 組（每組停 10 秒就好）：");
            Console.WriteLine("      A=綠 B=黃   |   A=黃 B=綠");
            Console.WriteLine("      A=綠 B=紅   |   A=紅 B=綠");
            Console.WriteLine("      A=綠 B=黑   |   A=黑 B=綠");
            Console.WriteLine("      A=黃 B=紅   |   A=紅 B=黃");
            Console.WriteLine("      A=黃 B=黑   |   A=黑 B=黃");
            Console.WriteLine("      A=紅 B=黑   |   A=黑 B=紅");
            Console.WriteLine();
            Console.WriteLine("  第三條線接 GND2；換線時不用停程式。");
            Console.WriteLine("  按 Ctrl+C 結束。");
            Console.WriteLine();
            Console.WriteLine("--------------------------------------------------");

            byte[] frame = SkbFrame.Build(0xFF, SkbFrame.F_SCAN, null);
            int round = 0;

            while (true)
            {
                round++;
                var got = new List<byte>();
                try
                {
                    var t = new SerialTransport(port, baud);
                    t.Open();
                    try
                    {
                        t.Write(frame);
                        DateTime end = DateTime.Now.AddMilliseconds(700);
                        while (DateTime.Now < end)
                        {
                            int b = t.ReadByte(100);
                            if (b >= 0) got.Add((byte)b);
                        }
                    }
                    finally { t.Close(); }
                }
                catch (Exception ex)
                {
                    Console.WriteLine("  #{0,-4} 開埠失敗：{1}", round, ex.Message);
                    Thread.Sleep(2000);
                    continue;
                }

                if (got.Count == 0)
                {
                    Console.WriteLine("  #{0,-4} {1}   .....  0 bytes", round, DateTime.Now.ToString("HH:mm:ss"));
                }
                else
                {
                    // 嗶三聲，讓人不用看螢幕
                    for (int i = 0; i < 3; i++) { try { Console.Beep(1200, 150); } catch { } Thread.Sleep(60); }
                    Console.WriteLine();
                    Console.WriteLine("  ############################################");
                    Console.WriteLine("  ##  有回應了！{0} 個位元組", got.Count);
                    Console.WriteLine("  ##  {0}", Hex(got.ToArray()));
                    if (got.Contains(SkbFrame.HEADER))
                        Console.WriteLine("  ##  看到幀頭 55 — 這組接法就是對的！");
                    else
                        Console.WriteLine("  ##  是亂碼 — 線接對了，但波特率要用 sweep 找");
                    Console.WriteLine("  ##  ★ 記下現在的接線方式，然後 Ctrl+C 停止 ★");
                    Console.WriteLine("  ############################################");
                    Console.WriteLine();
                }
                Thread.Sleep(800);
            }
        }

        /* ---- 除錯：純接收監聽（完全不送任何東西）---- */
        /// <summary>
        /// 只聽不說，把 N 秒內收到的任何位元組原樣印出。
        ///
        /// 為什麼需要這個：raw / sweep / probe 都是「先送再等」，
        /// 若送出去的那條路（TX）有問題，就永遠看不到回應，
        /// 也就無法分辨到底是 TX 壞還是 RX 壞。
        ///
        /// 用法：跑這個指令的同時，去按板子上的 reset 或開關按鈕。
        ///   收到位元組 → RX 路徑（板→PC）是通的，問題在 TX 或板子不理會指令
        ///   收不到     → RX 路徑也不通，兩條線都有問題（或根本沒接對）
        /// </summary>
        private static int CmdListen(string port, int baud, int seconds)
        {
            Console.WriteLine("===== 純接收監聽：{0} @ {1} bps，{2} 秒 =====", port, baud, seconds);
            Console.WriteLine("本指令「完全不送任何資料」，只聽板子有沒有主動說話。");
            Console.WriteLine();
            Console.WriteLine(">>> 現在請去按板子上的 RESET 按鈕，或長按『一鍵全開』按鈕 <<<");
            Console.WriteLine("    （若板子有開啟 A0 自動上傳，門磁變化會送資料過來）");
            Console.WriteLine();

            var t = new SerialTransport(port, baud);
            t.Open();
            try
            {
                var got = new List<byte>();
                DateTime end = DateTime.Now.AddSeconds(seconds);
                int lastShown = 0;
                while (DateTime.Now < end)
                {
                    int b = t.ReadByte(200);
                    if (b >= 0) got.Add((byte)b);

                    int remain = (int)(end - DateTime.Now).TotalSeconds;
                    if (remain != lastShown)
                    {
                        lastShown = remain;
                        Console.Write("\r  剩餘 {0,2} 秒，已收到 {1} 個位元組   ", remain, got.Count);
                    }
                }
                Console.WriteLine();
                Console.WriteLine();

                if (got.Count == 0)
                {
                    Console.WriteLine("[收到] 0 個位元組。");
                    Console.WriteLine();
                    Console.WriteLine("RX 路徑（板→PC）也不通。加上 raw 的結果，代表：");
                    Console.WriteLine("  兩條資料線都沒有正確接到板子的 A/B，");
                    Console.WriteLine("  或板子的 485 收發晶片沒有在工作。");
                    Console.WriteLine("→ 下一步必須用三用電表量，不能再靠猜。");
                    return 2;
                }

                Console.WriteLine("[收到] {0} 個位元組：", got.Count);
                Console.WriteLine("  " + Hex(got.ToArray()));
                Console.WriteLine();
                Console.WriteLine("★ RX 路徑是通的！這是很重要的線索。");
                if (got.Contains(SkbFrame.HEADER))
                    Console.WriteLine("  而且看到幀頭 0x55 — 波特率也對，問題只在送出去那一側。");
                else
                    Console.WriteLine("  但看不到幀頭 0x55 — 波特率可能不對，請跑 sweep。");
                return 0;
            }
            finally { t.Close(); }
        }

        /* ---- 監聽模式 ---- */
        private static void CmdWatch(SkbClient client, byte addr)
        {
            Console.WriteLine("監聽中：A0 自動上傳即時顯示，並每 2 秒輪詢信號。按任意鍵結束。");
            bool[] last = client.ReadSignals(addr, 25);
            PrintSignalLine(last);
            while (!Console.KeyAvailable)
            {
                Thread.Sleep(2000);
                bool[] now = client.ReadSignals(addr, 25);
                bool changed = false;
                for (int i = 0; i < now.Length; i++)
                    if (now[i] != last[i]) { changed = true; break; }
                if (changed) { PrintSignalLine(now); last = now; }
            }
            Console.ReadKey(true);
        }

        private static void OnAutoUpload(byte addr, byte ch, byte sig)
        {
            Console.WriteLine("  [A0 自動上傳] 板{0} 第{1}格 信號={2}（{3}）",
                addr, ch, sig, sig == 0 ? "接通/高電平" : "斷開/低電平");
        }

        /* ---- 模擬器 demo：完整取件流程 ---- */
        private static int RunSimDemo()
        {
            Console.WriteLine("===== 模擬器：虛擬 25 路鎖控板（位址 1，無需硬體）=====");
            var sim = new SimBoardTransport(1, 25);
            using (var client = new SkbClient(sim))
            {
                client.AutoUpload += OnAutoUpload;
                client.Open();

                Console.WriteLine("[1] DF 廣播尋址 …");
                Console.WriteLine("    板子位址 = " + client.ScanAddress());

                Console.WriteLine("[2] DD 讀 MCU ID …");
                Console.WriteLine("    MCU ID = " + Hex(client.ReadMcuId(1)));

                Console.WriteLine("[3] E0 寫配置：開鎖 200ms、斷開時自動上傳 …");
                client.WriteConfig(1, 9600, 20, 0x01);
                Console.WriteLine("    " + client.ReadConfig(1));

                Console.WriteLine("[4] D2 讀全部通道信號（應全部接通=門關）：");
                PrintSignals(client, 1);

                Console.WriteLine("[5] E2 開第 7 格（模擬客人取件）…");
                byte sig = client.Unlock(1, 7);
                Console.WriteLine("    回傳信號 = " + sig);
                Console.WriteLine("    （等待模擬 門開 → 門關，約 3 秒 …）");
                Thread.Sleep(3500);

                Console.WriteLine("[6] D2 再讀一次（第 7 格應已回接通=門已關）：");
                PrintSignals(client, 1);
            }
            Console.WriteLine("===== 取件流程模擬完成 =====");
            return 0;
        }

        /* ---- 顯示工具 ---- */
        private static void PrintSignals(SkbClient client, byte addr)
        {
            PrintSignalLine(client.ReadSignals(addr, 25));
        }

        private static void PrintSignalLine(bool[] sig)
        {
            for (int i = 0; i < sig.Length; i++)
            {
                Console.Write("{0,3}:{1}  ", i + 1, sig[i] ? "斷開" : "接通");
                if ((i + 1) % 5 == 0) Console.WriteLine();
            }
            Console.WriteLine();
        }

        private static string Hex(byte[] data)
        {
            return BitConverter.ToString(data).Replace("-", " ");
        }

        private static void Usage()
        {
            Console.WriteLine("SkbProbe — UPUS-SKB 鎖控板驗板工具");
            Console.WriteLine("  SkbProbe.exe sim demo            模擬器 demo（免硬體）");
            Console.WriteLine("  SkbProbe.exe COM3 probe          一鍵驗板");
            Console.WriteLine("  SkbProbe.exe COM3 sweep          【除錯】掃 5 種波特率找出哪個通");
            Console.WriteLine("  SkbProbe.exe COM3 raw            【除錯】原樣 dump 收到的位元組");
            Console.WriteLine("  SkbProbe.exe COM3 listen [秒]    【除錯】只聽不送，測 RX 路徑");
            Console.WriteLine("  SkbProbe.exe COM3 hunt           【桌邊】持續偵測，接對會嗶聲");
            Console.WriteLine("  SkbProbe.exe COM3 scan|id|config|doors|watch [addr]");
            Console.WriteLine("  SkbProbe.exe COM3 unlock <addr> <ch>");
            Console.WriteLine("  附加 baud=xxxxx 改波特率（預設 9600）");
        }
    }
}

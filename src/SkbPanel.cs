using System;
using System.Drawing;
using System.IO.Ports;
using System.Threading;
using System.Windows.Forms;
using RacketMaster.Skb;

/*
 * SkbPanel — UPUS-SKB 鎖控板 視覺化驗板面板（Win7 + .NET 4.x + WinForms）
 *
 * 與命令列 SkbProbe 共存：這支是給「不想碰黑視窗」的人用的。
 *   ．COM 埠下拉自動列出（免開裝置管理員）
 *   ．25 格紅綠燈牆：綠=接通(門關) 紅=斷開(門開) 灰=未知
 *   ．點格子 = 開那格鎖；A0 自動上傳即時跳燈
 *   ．[驗板] 一鍵：尋址 → MCU ID → 配置 → 全通道信號
 *
 * 編譯：build.bat 會一起產生 SkbPanel.exe（/target:winexe）
 */
namespace RacketMaster.SkbPanel
{
    internal static class PanelMain
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new PanelForm());
        }
    }

    internal sealed class PanelForm : Form
    {
        private const int ChannelCount = 25;

        private ComboBox _cboPorts;
        private TextBox _txtBaud;
        private NumericUpDown _numAddr;
        private Button _btnConnect;
        private Button _btnRefresh;
        private Button _btnScan;
        private Button _btnProbe;
        private Button _btnRead;
        private Button _btnConfig;
        private CheckBox _chkWatch;
        private Label _lblStatus;
        private TextBox _log;
        private Button[] _cells;
        private System.Windows.Forms.Timer _watchTimer;

        private SkbClient _client;
        private bool _busy;

        public PanelForm()
        {
            BuildUi();
            RefreshPorts();
        }

        /* ---------------- UI 建構 ---------------- */

        private void BuildUi()
        {
            Text = "SkbPanel — 鎖控板驗板面板";
            ClientSize = new Size(640, 720);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;

            int y = 10;
            _cboPorts = Mk(new ComboBox(), 10, y, 100);
            _cboPorts.DropDownStyle = ComboBoxStyle.DropDownList;
            _btnRefresh = MkButton("重新整理", 116, y, 80);
            _btnRefresh.Click += delegate { RefreshPorts(); };
            _txtBaud = Mk(new TextBox(), 202, y + 2, 60);
            _txtBaud.Text = "9600";
            _btnConnect = MkButton("連接", 268, y, 70);
            _btnConnect.Click += delegate { ToggleConnect(); };
            _lblStatus = Mk(new Label(), 344, y + 4, 280);
            _lblStatus.Text = "狀態：未連接";
            _lblStatus.ForeColor = Color.Gray;

            y += 36;
            _btnScan = MkButton("掃描位址", 10, y, 90);
            _btnScan.Click += delegate { BeginWork(DoScan); };
            Label lblAddr = Mk(new Label(), 104, y + 4, 40);
            lblAddr.Text = "位址";
            _numAddr = Mk(new NumericUpDown(), 144, y + 1, 56);
            _numAddr.Minimum = 1; _numAddr.Maximum = 255; _numAddr.Value = 1;
            _btnProbe = MkButton("一鍵驗板", 206, y, 90);
            _btnProbe.Click += delegate { BeginWork(DoProbe); };
            _btnRead = MkButton("讀信號 D2", 302, y, 90);
            _btnRead.Click += delegate { BeginWork(DoReadSignals); };
            _btnConfig = MkButton("寫入建議配置", 398, y, 110);
            _btnConfig.Click += delegate { BeginWork(DoWriteConfig); };
            _chkWatch = Mk(new CheckBox(), 516, y + 3, 110);
            _chkWatch.Text = "監聽(2秒)";
            _chkWatch.CheckedChanged += delegate { ToggleWatch(); };

            // 25 格燈牆（點格子 = 開鎖）
            _cells = new Button[ChannelCount];
            int gx = 10, gy = y + 36, cw = 118, ch = 56, gap = 6;
            for (int i = 0; i < ChannelCount; i++)
            {
                var b = new Button();
                b.Left = gx + (i % 5) * (cw + gap);
                b.Top = gy + (i / 5) * (ch + gap);
                b.Width = cw; b.Height = ch;
                b.Text = (i + 1).ToString();
                b.BackColor = Color.Silver;
                b.Font = new Font(Font.FontFamily, 14f, FontStyle.Bold);
                b.Tag = i + 1;
                b.Click += delegate(object s, EventArgs e)
                {
                    var btn = (Button)s;
                    int chNum = (int)btn.Tag;
                    BeginWork(delegate { DoUnlock(chNum); });
                };
                Controls.Add(b);
                _cells[i] = b;
            }

            _log = new TextBox();
            _log.Left = 10; _log.Top = gy + 5 * (ch + gap) + 4;
            _log.Width = 620; _log.Height = 330;
            _log.Multiline = true; _log.ReadOnly = true;
            _log.ScrollBars = ScrollBars.Vertical;
            _log.Font = new Font("Consolas", 9f);
            Controls.Add(_log);

            _watchTimer = new System.Windows.Forms.Timer();
            _watchTimer.Interval = 2000;
            _watchTimer.Tick += delegate { TickWatch(); };
        }

        private T Mk<T>(T c, int x, int y, int w) where T : Control
        {
            c.Left = x; c.Top = y; c.Width = w;
            Controls.Add(c);
            return c;
        }

        private Button MkButton(string text, int x, int y, int w)
        {
            var b = new Button();
            b.Text = text;
            Controls.Add(b);
            b.Left = x; b.Top = y; b.Width = w;
            return b;
        }

        private void RefreshPorts()
        {
            string[] ports = SerialPort.GetPortNames();
            _cboPorts.Items.Clear();
            Array.Sort(ports);
            foreach (string p in ports) _cboPorts.Items.Add(p);
            if (_cboPorts.Items.Count > 0) _cboPorts.SelectedIndex = 0;
            Log("COM 埠清單：" + (ports.Length == 0 ? "（找不到任何 COM 埠，轉接頭插了嗎？）" : string.Join(", ", ports)));
        }

        /* ---------------- 連接管理 ---------------- */

        private void ToggleConnect()
        {
            if (_client != null) { Disconnect(); return; }
            if (_cboPorts.SelectedItem == null) { Log("[錯誤] 沒有選 COM 埠"); return; }
            string port = (string)_cboPorts.SelectedItem;
            int baud;
            if (!int.TryParse(_txtBaud.Text, out baud)) baud = 9600;

            BeginWork(delegate
            {
                var c = new SkbClient(new SerialTransport(port, baud));
                c.AutoUpload += OnAutoUpload;
                c.Open();
                _client = c;
                Ui(delegate
                {
                    _btnConnect.Text = "中斷";
                    _lblStatus.Text = "狀態：已連接 " + port + " @ " + baud;
                    _lblStatus.ForeColor = Color.Green;
                });
                Log("[OK] 已開啟 " + port + " @ " + baud);
            });
        }

        private void Disconnect()
        {
            _watchTimer.Stop();
            _chkWatch.Checked = false;
            var c = _client;
            _client = null;
            if (c != null)
            {
                try { c.AutoUpload -= OnAutoUpload; c.Dispose(); }
                catch { }
            }
            _btnConnect.Text = "連接";
            _lblStatus.Text = "狀態：未連接";
            _lblStatus.ForeColor = Color.Gray;
            Log("已中斷連接");
        }

        /* ---------------- 背景工作與執行緒封送 ---------------- */

        private void BeginWork(ThreadStart work)
        {
            if (_busy) { Log("（上一個動作還在跑，稍等一下）"); return; }
            _busy = true;
            ThreadPool.QueueUserWorkItem(delegate(object state)
            {
                try { work(); }
                catch (Exception ex) { Log("[錯誤] " + ex.Message); }
                finally { _busy = false; }
            });
        }

        private void Ui(MethodInvoker a)
        {
            if (IsDisposed) return;
            if (InvokeRequired) { try { BeginInvoke(a); } catch { } }
            else a();
        }

        private void Log(string msg)
        {
            Ui(delegate
            {
                _log.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + msg + Environment.NewLine);
            });
        }

        private bool RequireClient()
        {
            if (_client == null) { Log("[錯誤] 請先按 [連接]"); return false; }
            return true;
        }

        private byte Addr { get { return (byte)_numAddr.Value; } }

        /* ---------------- 板子指令 ---------------- */

        private void DoScan()
        {
            if (!RequireClient()) return;
            Log("DF 廣播尋址 …（總線上只能接一台）");
            byte addr = _client.ScanAddress();
            Ui(delegate { _numAddr.Value = addr; });
            Log("[OK] 板子位址 = " + addr + "（已幫你填到上面的位址欄）");
        }

        private void DoProbe()
        {
            if (!RequireClient()) return;
            byte addr = Addr;
            Log("── 一鍵驗板開始（位址 " + addr + "）──");

            byte[] id = _client.ReadMcuId(addr);
            Log("[OK] MCU ID = " + BitConverter.ToString(id));

            SkbConfig cfg = _client.ReadConfig(addr);
            Log("[OK] 配置：" + cfg);

            DoReadSignals();
            Log("── 驗板完成 ──");
        }

        private void DoReadSignals()
        {
            if (!RequireClient()) return;
            bool[] sig = _client.ReadSignals(Addr, ChannelCount);
            Ui(delegate { PaintCells(sig); });
            int open = 0;
            foreach (bool b in sig) if (b) open++;
            Log("[OK] D2 信號：開門 " + open + " 格 / 關門 " + (ChannelCount - open) + " 格");
        }

        private void DoWriteConfig()
        {
            if (!RequireClient()) return;
            _client.WriteConfig(Addr, 9600, 20, 0x01);
            Log("[OK] 已寫入建議配置：9600、開鎖 200ms、應答模式、斷開時自動上傳");
        }

        private void DoUnlock(int chNum)
        {
            if (!RequireClient()) return;
            Log("E2 開第 " + chNum + " 格 …");
            byte sig = _client.Unlock(Addr, (byte)chNum);
            Log("[OK] 第 " + chNum + " 格已送開鎖脈衝（回傳信號=" + sig + "）");
        }

        /* ---------------- 信號顯示與自動上傳 ---------------- */

        private void PaintCells(bool[] sig)
        {
            for (int i = 0; i < ChannelCount && i < sig.Length; i++)
                PaintCell(i + 1, sig[i]);
        }

        private void PaintCell(int chNum, bool disconnected)
        {
            Button b = _cells[chNum - 1];
            b.BackColor = disconnected ? Color.Tomato : Color.MediumSeaGreen;
            b.ForeColor = Color.White;
            b.Text = chNum + (disconnected ? "\n開" : "\n關");
        }

        private void OnAutoUpload(byte addr, byte chNum, byte sig)
        {
            Ui(delegate
            {
                bool disc = sig != 0;
                if (chNum >= 1 && chNum <= ChannelCount) PaintCell(chNum, disc);
                Log("★ A0 自動上傳：板" + addr + " 第" + chNum + "格 → " + (disc ? "門開（斷開）" : "門關（接通）"));
            });
        }

        /* ---------------- 監聽 ---------------- */

        private void ToggleWatch()
        {
            if (_chkWatch.Checked && _client == null)
            {
                Log("[錯誤] 請先按 [連接]");
                _chkWatch.Checked = false;
                return;
            }
            if (_chkWatch.Checked) { _watchTimer.Start(); Log("監聽中：每 2 秒讀一次信號，A0 自動上傳也會即時跳燈"); }
            else { _watchTimer.Stop(); Log("停止監聽"); }
        }

        private void TickWatch()
        {
            if (_busy || _client == null) return;
            BeginWork(DoReadSignalsQuiet);
        }

        private void DoReadSignalsQuiet()
        {
            try
            {
                bool[] sig = _client.ReadSignals(Addr, ChannelCount);
                Ui(delegate { PaintCells(sig); });
            }
            catch (Exception ex) { Log("[監聽錯誤] " + ex.Message); }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            _watchTimer.Stop();
            var c = _client;
            _client = null;
            if (c != null) { try { c.Dispose(); } catch { } }
            base.OnFormClosing(e);
        }
    }
}

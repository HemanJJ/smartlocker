using System;
using System.Collections.Generic;
using System.IO.Ports;
using System.Threading;

/*
 * UpusSkb.cs — UPUS-SKB 系列鎖控板協議庫（RS-485）
 * 依據：锁控板技术文档 V3.1（亚普达科技）
 * 協定：55 A1 <位址> <功能碼> <長度> <資料...> <XOR 校驗>
 * 相容：.NET Framework 4.0+（Win7 內建 csc.exe 可編譯）
 */
namespace RacketMaster.Skb
{
    /* ================= 傳輸層 ================= */

    /// <summary>傳輸抽象：串口或模擬器都實作此介面（業務層不感知差異）</summary>
    public interface ISkbTransport
    {
        void Open();
        void Close();
        void Write(byte[] data);
        /// <summary>讀一個 byte；timeoutMs 內無資料回傳 -1</summary>
        int ReadByte(int timeoutMs);
    }

    /// <summary>USB-RS485／串口傳輸（預設 9600, N, 8, 1）</summary>
    public class SerialTransport : ISkbTransport
    {
        private readonly string _portName;
        private readonly int _baud;
        private SerialPort _port;

        public SerialTransport(string portName, int baud)
        {
            _portName = portName;
            _baud = baud;
        }

        public void Open()
        {
            _port = new SerialPort(_portName, _baud, Parity.None, 8, StopBits.One);
            _port.ReadTimeout = 500;
            _port.WriteTimeout = 500;
            _port.Open();
            _port.DiscardInBuffer();
            _port.DiscardOutBuffer();
        }

        public void Close()
        {
            if (_port != null && _port.IsOpen) _port.Close();
        }

        public void Write(byte[] data)
        {
            _port.Write(data, 0, data.Length);
        }

        public int ReadByte(int timeoutMs)
        {
            try
            {
                _port.ReadTimeout = timeoutMs;
                return _port.ReadByte();
            }
            catch (TimeoutException) { return -1; }
        }
    }

    /* ================= 協議幀 ================= */

    public static class SkbFrame
    {
        public const byte HEADER = 0x55;
        public const byte TYPE = 0xA1;

        // 功能碼
        public const byte F_SCAN = 0xDF;   // 廣播尋址
        public const byte F_MCUID = 0xDD;  // 讀 MCU ID
        public const byte F_TASK = 0xD9;   // 讀任務狀態
        public const byte F_RCFG = 0xD0;   // 讀系統配置
        public const byte F_WCFG = 0xE0;   // 寫系統配置
        public const byte F_RCH = 0xD1;    // 讀通道狀態（通電）
        public const byte F_WCH = 0xE1;    // 寫通道狀態
        public const byte F_RSIG = 0xD2;   // 讀通道信號
        public const byte F_UNLOCK = 0xE2; // 開鎖
        public const byte F_MOTOR_TO = 0xE4; // 電機：信號變為指定狀態停
        public const byte F_MOTOR_CNT = 0xE5; // 電機：信號變更 N 次停
        public const byte F_MOTOR_IS = 0xE6; // 電機：信號為指定狀態停
        public const byte F_AUTO = 0xA0;   // 自動上傳（板→主控）

        /// <summary>組幀：55 A1 addr func len data... xor</summary>
        public static byte[] Build(byte addr, byte func, byte[] data)
        {
            int len = data == null ? 0 : data.Length;
            byte[] f = new byte[6 + len];
            f[0] = HEADER; f[1] = TYPE; f[2] = addr; f[3] = func; f[4] = (byte)len;
            if (len > 0) Array.Copy(data, 0, f, 5, len);
            byte x = 0;
            for (int i = 0; i < f.Length - 1; i++) x ^= f[i];
            f[f.Length - 1] = x;
            return f;
        }

        /// <summary>校驗：全部位元 XOR（含幀頭到資料）應等於最後一位</summary>
        public static bool ChecksumOk(byte[] f)
        {
            byte x = 0;
            for (int i = 0; i < f.Length - 1; i++) x ^= f[i];
            return x == f[f.Length - 1];
        }

        /// <summary>位元組解析：MSB 優先（doc：由左至右每位一路）</summary>
        public static bool[] ParseBits(byte[] data, int offset, int count)
        {
            bool[] r = new bool[count];
            for (int i = 0; i < count; i++)
            {
                int idx = offset + i / 8;
                if (idx >= data.Length) break;
                r[i] = (data[idx] & (0x80 >> (i % 8))) != 0;
            }
            return r;
        }

        public static byte[] BitsToBytes(bool[] bits)
        {
            byte[] r = new byte[(bits.Length + 7) / 8];
            for (int i = 0; i < bits.Length; i++)
                if (bits[i]) r[i / 8] |= (byte)(0x80 >> (i % 8));
            return r;
        }
    }

    /* ================= 系統配置 ================= */

    public class SkbConfig
    {
        public byte SoftAddr;
        public int Baud;
        public byte UnlockTime10ms;
        public byte ModeUpload;

        public override string ToString()
        {
            int task = (ModeUpload >> 4) & 0x0F;
            int up = ModeUpload & 0x0F;
            string upTxt = up == 0 ? "關" : (up == 1 ? "斷開(低電平)時" : "接通(高電平)時");
            return string.Format("波特率={0}, 開鎖時長={1}ms, 模式={2}, 自動上傳={3}",
                Baud, UnlockTime10ms * 10, task == 0 ? "應答" : "任務", upTxt);
        }
    }

    /* ================= 主控用戶端 ================= */

    /// <summary>
    /// 鎖控板主控。用法：
    ///   var c = new SkbClient(new SerialTransport("COM3", 9600));
    ///   c.Open(); c.Unlock(1, 7); c.Close();
    /// </summary>
    public class SkbClient : IDisposable
    {
        private readonly ISkbTransport _t;
        private readonly object _ioLock = new object();
        private readonly ManualResetEvent _resp = new ManualResetEvent(false);
        private volatile bool _running;
        private Thread _reader;
        private byte[] _lastResp;

        /// <summary>A0 自動上傳事件：參數 = 板位址, 通道號, 信號(0=接通/高, 1=斷開/低)</summary>
        public event Action<byte, byte, byte> AutoUpload;

        public SkbClient(ISkbTransport transport) { _t = transport; }

        public void Open()
        {
            _t.Open();
            _running = true;
            _reader = new Thread(ReadLoop);
            _reader.IsBackground = true;
            _reader.Start();
        }

        public void Close()
        {
            _running = false;
            try { _t.Close(); } catch { }
            if (_reader != null) _reader.Join(300);
        }

        public void Dispose() { Close(); }

        /* ---- 接收執行緒：組幀、分流（回應 vs A0 事件）---- */
        private void ReadLoop()
        {
            var buf = new List<byte>();
            while (_running)
            {
                int b;
                try { b = _t.ReadByte(200); }
                catch { break; }
                if (b < 0) continue;

                buf.Add((byte)b);
                while (buf.Count >= 2 && !(buf[0] == SkbFrame.HEADER && buf[1] == SkbFrame.TYPE))
                    buf.RemoveAt(0);
                if (buf.Count > 300) buf.Clear();
                if (buf.Count < 5) continue;

                int len = buf[4];
                if (buf.Count < 6 + len) continue;

                byte[] frame = buf.GetRange(0, 6 + len).ToArray();
                buf.RemoveRange(0, 6 + len);
                if (!SkbFrame.ChecksumOk(frame)) continue;

                if (frame[3] == SkbFrame.F_AUTO)
                {
                    var h = AutoUpload;
                    if (h != null && len >= 2) h(frame[2], frame[5], frame[6]);
                }
                else
                {
                    _lastResp = frame;
                    _resp.Set();
                }
            }
        }

        /// <summary>送指令並等回應（單主控一問一答；逾時丟 TimeoutException）</summary>
        public byte[] SendCommand(byte addr, byte func, byte[] data, int timeoutMs)
        {
            lock (_ioLock)
            {
                _lastResp = null;
                _resp.Reset();
                _t.Write(SkbFrame.Build(addr, func, data));
                if (!_resp.WaitOne(timeoutMs))
                    throw new TimeoutException("板子無回應（請檢查：A/B 線是否接反、位址、波特率、板子電源）");
                byte[] f = _lastResp;
                byte[] d = new byte[f[4]];
                Array.Copy(f, 5, d, 0, d.Length);
                return d;
            }
        }

        /* ---- 高階 API ---- */

        /// <summary>DF 廣播尋址（總線上只能接一台時使用），回傳板子位址</summary>
        public byte ScanAddress()
        {
            return SendCommand(0xFF, SkbFrame.F_SCAN, null, 1000)[0];
        }

        /// <summary>DD 讀 MCU ID（7 bytes）</summary>
        public byte[] ReadMcuId(byte addr)
        {
            return SendCommand(addr, SkbFrame.F_MCUID, null, 1000);
        }

        /// <summary>D0 讀系統配置</summary>
        public SkbConfig ReadConfig(byte addr)
        {
            byte[] d = SendCommand(addr, SkbFrame.F_RCFG, null, 1000);
            var c = new SkbConfig();
            c.SoftAddr = d[2];
            c.Baud = (d[3] << 24) | (d[4] << 16) | (d[5] << 8) | d[6];
            c.UnlockTime10ms = d[7];
            c.ModeUpload = d[8];
            return c;
        }

        /// <summary>E0 寫系統配置（baud 如 9600；unlockTime10ms 單位 10ms；modeUpload 高4bit模式/低4bit上傳）</summary>
        public void WriteConfig(byte addr, int baud, byte unlockTime10ms, byte modeUpload)
        {
            byte[] d = new byte[9];
            d[0] = SkbFrame.HEADER; d[1] = SkbFrame.TYPE; d[2] = 0x01;
            d[3] = (byte)((baud >> 24) & 0xFF);
            d[4] = (byte)((baud >> 16) & 0xFF);
            d[5] = (byte)((baud >> 8) & 0xFF);
            d[6] = (byte)(baud & 0xFF);
            d[7] = unlockTime10ms;
            d[8] = modeUpload;
            SendCommand(addr, SkbFrame.F_WCFG, d, 1000);
        }

        /// <summary>D1 讀全部通道通電狀態（true=通電）</summary>
        public bool[] ReadChannels(byte addr, int channelCount)
        {
            byte[] d = SendCommand(addr, SkbFrame.F_RCH, new byte[] { 0 }, 1000);
            return SkbFrame.ParseBits(d, 1, channelCount);
        }

        /// <summary>E1 寫通道通電（回傳 false 表通道號錯誤）</summary>
        public bool WriteChannel(byte addr, byte ch, bool on)
        {
            byte[] d = SendCommand(addr, SkbFrame.F_WCH, new byte[] { ch, (byte)(on ? 1 : 0) }, 1000);
            return d.Length >= 2 && d[1] != 0xE5;
        }

        /// <summary>D2 讀全部通道信號（true=斷開/低電平；false=接通/高電平）</summary>
        public bool[] ReadSignals(byte addr, int channelCount)
        {
            byte[] d = SendCommand(addr, SkbFrame.F_RSIG, new byte[] { 0 }, 1000);
            return SkbFrame.ParseBits(d, 1, channelCount);
        }

        /// <summary>E2 開鎖（ch=1..25；回傳該通道當下信號 0=接通 1=斷開）</summary>
        public byte Unlock(byte addr, byte ch)
        {
            byte[] d = SendCommand(addr, SkbFrame.F_UNLOCK, new byte[] { ch }, 1000);
            return d.Length >= 2 ? d[1] : (byte)0xFF;
        }

        /// <summary>E4 電機：運行到信號「變為」指定狀態停（stopState 0=高 1=低；timeout 單位 100ms）</summary>
        public byte MotorUntilChange(byte addr, byte ch, byte timeout100ms, byte stopState)
        {
            return SendCommand(addr, SkbFrame.F_MOTOR_TO, new byte[] { ch, timeout100ms, stopState }, 3000)[1];
        }

        /// <summary>E5 電機：運行到信號變更 N 次停（掛拍螺桿出貨用）</summary>
        public byte MotorUntilCount(byte addr, byte ch, byte timeout100ms, byte count)
        {
            return SendCommand(addr, SkbFrame.F_MOTOR_CNT, new byte[] { ch, timeout100ms, count }, 3000)[1];
        }

        /// <summary>E6 電機：運行到信號「為」指定狀態停</summary>
        public byte MotorWhileState(byte addr, byte ch, byte timeout100ms, byte state)
        {
            return SendCommand(addr, SkbFrame.F_MOTOR_IS, new byte[] { ch, timeout100ms, state }, 3000)[1];
        }
    }

    /* ================= 模擬器（虛擬鎖控板） ================= */

    /// <summary>
    /// 虛擬 25 路鎖控板：吃同樣的 55 A1 幀、回同樣格式。
    /// E2 開鎖後自動模擬「門開(600ms)→門關(2600ms)」並依配置推 A0。
    /// 開發 Kiosk / 雲端時免硬體；也可注入卡門故障做測試。
    /// </summary>
    public class SimBoardTransport : ISkbTransport
    {
        private readonly byte _addr;
        private readonly int _channels;
        private readonly Queue<byte> _rx = new Queue<byte>();
        private readonly AutoResetEvent _rxEvent = new AutoResetEvent(false);
        private readonly object _lock = new object();

        private readonly bool[] _powered;       // 通道通電（D1）
        private readonly bool[] _disconnected;  // 通道信號（D2）：false=接通/高, true=斷開/低
        private int _baud = 9600;
        private byte _unlockTime10ms = 20;
        private byte _modeUpload = 0;

        /// <summary>設 true 時，E2 後門不關（模擬卡門故障）</summary>
        public bool DoorStuck;

        public SimBoardTransport(byte addr, int channels)
        {
            _addr = addr;
            _channels = channels;
            _powered = new bool[channels];
            _disconnected = new bool[channels]; // 預設全接通（門關）
        }

        public void Open() { }
        public void Close() { }

        public int ReadByte(int timeoutMs)
        {
            if (_rxEvent.WaitOne(timeoutMs))
            {
                lock (_lock)
                {
                    if (_rx.Count > 0)
                    {
                        int b = _rx.Dequeue();
                        if (_rx.Count > 0) _rxEvent.Set();
                        return b;
                    }
                }
            }
            return -1;
        }

        public void Write(byte[] data)
        {
            if (data.Length < 6 || !SkbFrame.ChecksumOk(data)) return;
            byte addr = data[2], func = data[3];
            byte[] d = new byte[data[4]];
            Array.Copy(data, 5, d, 0, d.Length);
            Execute(addr, func, d);
        }

        private void Execute(byte addr, byte func, byte[] d)
        {
            switch (func)
            {
                case SkbFrame.F_SCAN:
                    if (addr == 0xFF) Respond(0xFF, func, new byte[] { _addr });
                    break;

                case SkbFrame.F_MCUID:
                    Respond(addr, func, new byte[] { 0xF7, 0x84, 0xC9, 0x1C, 0x01, 0xEB, 0x07 });
                    break;

                case SkbFrame.F_RCFG:
                    Respond(addr, func, new byte[] {
                        SkbFrame.HEADER, SkbFrame.TYPE, 0x01,
                        (byte)((_baud >> 24) & 0xFF), (byte)((_baud >> 16) & 0xFF),
                        (byte)((_baud >> 8) & 0xFF), (byte)(_baud & 0xFF),
                        _unlockTime10ms, _modeUpload });
                    break;

                case SkbFrame.F_WCFG:
                    _baud = (d[3] << 24) | (d[4] << 16) | (d[5] << 8) | d[6];
                    _unlockTime10ms = d[7];
                    _modeUpload = d[8];
                    Respond(addr, func, d);
                    break;

                case SkbFrame.F_RCH:
                    Respond(addr, func, StateReply(d[0], _powered));
                    break;

                case SkbFrame.F_WCH:
                    if (d[0] < 1 || d[0] > _channels) { Respond(addr, func, new byte[] { d[0], 0xE5 }); break; }
                    _powered[d[0] - 1] = d[1] != 0;
                    Respond(addr, func, new byte[] { d[0], d[1] });
                    break;

                case SkbFrame.F_RSIG:
                    Respond(addr, func, StateReply(d[0], _disconnected));
                    break;

                case SkbFrame.F_UNLOCK:
                    if (d[0] == 0)
                    {
                        byte[] all = new byte[1 + (_channels + 7) / 8];
                        byte[] bits = SkbFrame.BitsToBytes(_disconnected);
                        Array.Copy(bits, 0, all, 1, bits.Length);
                        Respond(addr, func, all);
                    }
                    else
                    {
                        Respond(addr, func, new byte[] { d[0], (byte)(_disconnected[d[0] - 1] ? 1 : 0) });
                        SimulateDoor(d[0]);
                    }
                    break;

                case SkbFrame.F_MOTOR_TO:
                case SkbFrame.F_MOTOR_CNT:
                case SkbFrame.F_MOTOR_IS:
                    Respond(addr, func, new byte[] { d[0], 0x01 }); // 01=執行完成（簡化）
                    break;
            }
        }

        private byte[] StateReply(byte ch, bool[] states)
        {
            if (ch == 0)
            {
                byte[] bits = SkbFrame.BitsToBytes(states);
                byte[] r = new byte[1 + bits.Length];
                Array.Copy(bits, 0, r, 1, bits.Length);
                return r;
            }
            return new byte[] { ch, (byte)(states[ch - 1] ? 1 : 0) };
        }

        /* 開鎖脈衝 → 門開 → 門關（並按配置推 A0） */
        private void SimulateDoor(byte ch)
        {
            int idx = ch - 1;
            _powered[idx] = true;
            Later(_unlockTime10ms * 10, delegate { _powered[idx] = false; });
            Later(600, delegate { _disconnected[idx] = true; PushA0(ch); });
            Later(2600, delegate { if (!DoorStuck) { _disconnected[idx] = false; PushA0(ch); } });
        }

        private void PushA0(byte ch)
        {
            int up = _modeUpload & 0x0F;
            bool disc = _disconnected[ch - 1];
            if ((up == 1 && disc) || (up == 2 && !disc))
                Respond(_addr, SkbFrame.F_AUTO, new byte[] { ch, (byte)(disc ? 1 : 0) });
        }

        private void Later(int ms, Action a)
        {
            var t = new Thread(delegate() { Thread.Sleep(ms); a(); });
            t.IsBackground = true;
            t.Start();
        }

        private void Respond(byte addr, byte func, byte[] data)
        {
            byte[] f = SkbFrame.Build(addr, func, data);
            lock (_lock) { foreach (byte b in f) _rx.Enqueue(b); }
            _rxEvent.Set();
        }
    }
}

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
skb.py — UPUS-SKB 系列鎖控板協議庫（Python / Raspberry Pi）

從 UpusSkb.cs 移植。協議規格見 docs/skb-doc.txt（锁控板技术文档 V3.1）。
幀格式：55 A1 <位址> <功能碼> <長度> <資料...> <XOR>
預設串列參數：9600 / N / 8 / 1

★ 這份是兩條軌道共用的資產：
  示範店（Pi + USB-RS485）與車隊（ESP32 + TTL）跑的是同一份幀格式。
  SimBoard 是那份規格的可執行版本，可用來驗收任何實作。

相依：pyserial（僅 SerialTransport 需要；SimBoard 不需要）
"""

import threading
import time
from typing import List, Optional, Callable

# ============================================================
#  幀
# ============================================================

HEADER = 0x55
TYPE = 0xA1

# 功能碼
F_SCAN = 0xDF       # 廣播尋址（位址必須用 FF）
F_MCUID = 0xDD      # 讀 MCU ID
F_TASK = 0xD9       # 讀任務狀態
F_RCFG = 0xD0       # 讀系統配置
F_WCFG = 0xE0       # 寫系統配置
F_RCH = 0xD1        # 讀通道狀態（通電）
F_WCH = 0xE1        # 寫通道狀態
F_RSIG = 0xD2       # 讀通道信號（門磁）
F_UNLOCK = 0xE2     # 開鎖
F_MOTOR_TO = 0xE4   # 電機：信號變為指定狀態停
F_MOTOR_CNT = 0xE5  # 電機：信號變更 N 次停（掛拍螺桿出貨）
F_MOTOR_IS = 0xE6   # 電機：信號為指定狀態停
F_AUTO = 0xA0       # 自動上傳（板 → 主控）

BROADCAST = 0xFF


def build(addr: int, func: int, data: Optional[bytes] = None) -> bytes:
    """組幀：55 A1 addr func len data... xor"""
    data = data or b""
    f = bytearray([HEADER, TYPE, addr & 0xFF, func & 0xFF, len(data)])
    f += data
    x = 0
    for b in f:
        x ^= b
    f.append(x)
    return bytes(f)


def checksum_ok(frame: bytes) -> bool:
    """校驗：幀頭到資料全部 XOR 應等於最後一位"""
    if len(frame) < 2:
        return False
    x = 0
    for b in frame[:-1]:
        x ^= b
    return x == frame[-1]


def parse_bits(data: bytes, offset: int, count: int) -> List[bool]:
    """位元組解析：MSB 優先（doc：由左至右每位一路）"""
    r = [False] * count
    for i in range(count):
        idx = offset + i // 8
        if idx >= len(data):
            break
        r[i] = (data[idx] & (0x80 >> (i % 8))) != 0
    return r


def bits_to_bytes(bits: List[bool]) -> bytes:
    r = bytearray((len(bits) + 7) // 8)
    for i, on in enumerate(bits):
        if on:
            r[i // 8] |= 0x80 >> (i % 8)
    return bytes(r)


def hexs(data: bytes) -> str:
    return " ".join("%02X" % b for b in data)


# ============================================================
#  傳輸層
# ============================================================

class Transport:
    """傳輸抽象：串口或模擬器都實作這個介面（業務層不感知差異）"""

    def open(self) -> None: ...
    def close(self) -> None: ...
    def write(self, data: bytes) -> None: ...
    def read_byte(self, timeout: float) -> int:
        """讀一個 byte；逾時回傳 -1"""
        ...


class SerialTransport(Transport):
    """USB-RS485 / USB-TTL 串口。Linux 上 CH340 免驅動 → /dev/ttyUSB0"""

    def __init__(self, port: str, baud: int = 9600):
        self.port_name = port
        self.baud = baud
        self._port = None

    def open(self) -> None:
        import serial  # 延後 import，讓 sim 模式不需要 pyserial
        self._port = serial.Serial(
            port=self.port_name,
            baudrate=self.baud,
            bytesize=8,
            parity="N",
            stopbits=1,
            timeout=0.5,
            write_timeout=0.5,
        )
        self._port.reset_input_buffer()
        self._port.reset_output_buffer()

    def close(self) -> None:
        if self._port and self._port.is_open:
            try:
                self._port.close()
            except Exception:
                pass
        self._port = None

    def write(self, data: bytes) -> None:
        self._port.write(data)
        self._port.flush()

    def read_byte(self, timeout: float) -> int:
        try:
            self._port.timeout = timeout
            b = self._port.read(1)
            return b[0] if b else -1
        except Exception:
            return -1


class SimBoardTransport(Transport):
    """
    虛擬鎖控板：吃同樣的 55 A1 幀、回同樣格式。

    E2 開鎖後自動模擬「門開(600ms) → 門關(2600ms)」並依配置推 A0。
    開發 Kiosk / 雲端時免硬體；也可注入卡門故障做測試。

    ★ 這是協議規格的可執行版本 —— 驗收 ESP32 韌體時以它為準。
    """

    def __init__(self, addr: int = 1, channels: int = 25):
        self._addr = addr
        self._channels = channels
        self._rx = bytearray()
        self._lock = threading.Lock()
        self._ev = threading.Event()
        self._powered = [False] * channels        # D1 通道通電
        self._disconnected = [False] * channels   # D2 信號：False=接通(門關)
        self._baud = 9600
        self._unlock_time_10ms = 20
        self._mode_upload = 0
        self.door_stuck = False                   # 設 True 模擬卡門

    def open(self) -> None: pass
    def close(self) -> None: pass

    def read_byte(self, timeout: float) -> int:
        if self._ev.wait(timeout):
            with self._lock:
                if self._rx:
                    b = self._rx.pop(0)
                    if not self._rx:
                        self._ev.clear()
                    return b
                self._ev.clear()
        return -1

    def write(self, data: bytes) -> None:
        if len(data) < 6 or not checksum_ok(data):
            return
        addr, func = data[2], data[3]
        n = data[4]
        self._execute(addr, func, data[5:5 + n])

    # ---- 指令實作 ----

    def _execute(self, addr: int, func: int, d: bytes) -> None:
        if func == F_SCAN:
            if addr == BROADCAST:
                self._respond(BROADCAST, func, bytes([self._addr]))

        elif func == F_MCUID:
            self._respond(addr, func, bytes([0xF7, 0x84, 0xC9, 0x1C, 0x01, 0xEB, 0x07]))

        elif func == F_RCFG:
            self._respond(addr, func, bytes([
                HEADER, TYPE, 0x01,
                (self._baud >> 24) & 0xFF, (self._baud >> 16) & 0xFF,
                (self._baud >> 8) & 0xFF, self._baud & 0xFF,
                self._unlock_time_10ms, self._mode_upload]))

        elif func == F_WCFG:
            self._baud = (d[3] << 24) | (d[4] << 16) | (d[5] << 8) | d[6]
            self._unlock_time_10ms = d[7]
            self._mode_upload = d[8]
            self._respond(addr, func, d)

        elif func == F_RCH:
            self._respond(addr, func, self._state_reply(d[0], self._powered))

        elif func == F_WCH:
            ch = d[0]
            if ch < 1 or ch > self._channels:
                self._respond(addr, func, bytes([ch, 0xE5]))
            else:
                self._powered[ch - 1] = d[1] != 0
                self._respond(addr, func, bytes([ch, d[1]]))

        elif func == F_RSIG:
            self._respond(addr, func, self._state_reply(d[0], self._disconnected))

        elif func == F_UNLOCK:
            ch = d[0]
            if ch == 0:
                bits = bits_to_bytes(self._disconnected)
                self._respond(addr, func, b"\x00" + bits)
            else:
                self._respond(addr, func,
                              bytes([ch, 1 if self._disconnected[ch - 1] else 0]))
                self._simulate_door(ch)

        elif func in (F_MOTOR_TO, F_MOTOR_CNT, F_MOTOR_IS):
            self._respond(addr, func, bytes([d[0], 0x01]))

    def _state_reply(self, ch: int, states: List[bool]) -> bytes:
        if ch == 0:
            return b"\x00" + bits_to_bytes(states)
        return bytes([ch, 1 if states[ch - 1] else 0])

    def _simulate_door(self, ch: int) -> None:
        idx = ch - 1
        self._powered[idx] = True
        self._later(self._unlock_time_10ms / 100.0,
                    lambda: self._set_powered(idx, False))
        self._later(0.6, lambda: self._set_door(idx, True, ch))
        if not self.door_stuck:
            self._later(2.6, lambda: self._set_door(idx, False, ch))

    def _set_powered(self, idx: int, on: bool) -> None:
        self._powered[idx] = on

    def _set_door(self, idx: int, disconnected: bool, ch: int) -> None:
        self._disconnected[idx] = disconnected
        self._push_a0(ch)

    def _push_a0(self, ch: int) -> None:
        up = self._mode_upload & 0x0F
        disc = self._disconnected[ch - 1]
        if (up == 1 and disc) or (up == 2 and not disc):
            self._respond(self._addr, F_AUTO, bytes([ch, 1 if disc else 0]))

    @staticmethod
    def _later(sec: float, fn: Callable[[], None]) -> None:
        t = threading.Timer(sec, fn)
        t.daemon = True
        t.start()

    def _respond(self, addr: int, func: int, data: bytes) -> None:
        f = build(addr, func, data)
        with self._lock:
            self._rx.extend(f)
        self._ev.set()


# ============================================================
#  主控用戶端
# ============================================================

class SkbTimeout(Exception):
    pass


class SkbConfig:
    def __init__(self, soft_addr=0, baud=0, unlock_time_10ms=0, mode_upload=0):
        self.soft_addr = soft_addr
        self.baud = baud
        self.unlock_time_10ms = unlock_time_10ms
        self.mode_upload = mode_upload

    def __str__(self):
        task = (self.mode_upload >> 4) & 0x0F
        up = self.mode_upload & 0x0F
        up_txt = {0: "關", 1: "斷開(低電平)時", 2: "接通(高電平)時"}.get(up, str(up))
        return "波特率=%d, 開鎖時長=%dms, 模式=%s, 自動上傳=%s" % (
            self.baud, self.unlock_time_10ms * 10,
            "應答" if task == 0 else "任務", up_txt)


class SkbClient:
    """
    鎖控板主控。用法：
        c = SkbClient(SerialTransport("/dev/ttyUSB0", 9600))
        c.open(); c.unlock(1, 7); c.close()
    """

    def __init__(self, transport: Transport):
        self._t = transport
        self._io_lock = threading.Lock()
        self._resp_ev = threading.Event()
        self._last_resp: Optional[bytes] = None
        self._running = False
        self._reader: Optional[threading.Thread] = None
        # A0 自動上傳回呼：(board, ch, sig) → sig 0=接通/高, 1=斷開/低
        self.on_auto_upload: Optional[Callable[[int, int, int], None]] = None

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, *a):
        self.close()

    def open(self) -> None:
        self._t.open()
        self._running = True
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()

    def close(self) -> None:
        self._running = False
        try:
            self._t.close()
        except Exception:
            pass
        if self._reader:
            self._reader.join(0.3)
            self._reader = None

    # ---- 接收執行緒：組幀、分流（回應 vs A0 事件）----

    def _read_loop(self) -> None:
        buf = bytearray()
        while self._running:
            try:
                b = self._t.read_byte(0.2)
            except Exception:
                break
            if b < 0:
                continue

            buf.append(b)
            # 對齊幀頭
            while len(buf) >= 2 and not (buf[0] == HEADER and buf[1] == TYPE):
                buf.pop(0)
            if len(buf) > 300:
                buf.clear()
            if len(buf) < 5:
                continue

            n = buf[4]
            if len(buf) < 6 + n:
                continue

            frame = bytes(buf[:6 + n])
            del buf[:6 + n]
            if not checksum_ok(frame):
                continue

            if frame[3] == F_AUTO:
                if self.on_auto_upload and n >= 2:
                    try:
                        self.on_auto_upload(frame[2], frame[5], frame[6])
                    except Exception:
                        pass
            else:
                self._last_resp = frame
                self._resp_ev.set()

    # ---- 送指令並等回應（單主控一問一答）----

    def send_command(self, addr: int, func: int,
                     data: Optional[bytes] = None, timeout: float = 1.0) -> bytes:
        with self._io_lock:
            self._last_resp = None
            self._resp_ev.clear()
            self._t.write(build(addr, func, data))
            if not self._resp_ev.wait(timeout):
                raise SkbTimeout(
                    "板子無回應（請檢查：A/B 線是否接反、位址、波特率、板子電源）")
            f = self._last_resp
            return f[5:5 + f[4]]

    # ---- 高階 API ----

    def scan_address(self) -> int:
        """DF 廣播尋址（總線上只能接一台），回傳板子位址"""
        return self.send_command(BROADCAST, F_SCAN, None, 1.0)[0]

    def read_mcu_id(self, addr: int) -> bytes:
        return self.send_command(addr, F_MCUID, None, 1.0)

    def read_config(self, addr: int) -> SkbConfig:
        d = self.send_command(addr, F_RCFG, None, 1.0)
        return SkbConfig(
            soft_addr=d[2],
            baud=(d[3] << 24) | (d[4] << 16) | (d[5] << 8) | d[6],
            unlock_time_10ms=d[7],
            mode_upload=d[8])

    def write_config(self, addr: int, baud: int,
                     unlock_time_10ms: int, mode_upload: int) -> None:
        d = bytes([HEADER, TYPE, 0x01,
                   (baud >> 24) & 0xFF, (baud >> 16) & 0xFF,
                   (baud >> 8) & 0xFF, baud & 0xFF,
                   unlock_time_10ms, mode_upload])
        self.send_command(addr, F_WCFG, d, 1.0)

    def read_channels(self, addr: int, channel_count: int) -> List[bool]:
        """D1 讀全部通道通電狀態（True=通電）"""
        d = self.send_command(addr, F_RCH, b"\x00", 1.0)
        return parse_bits(d, 1, channel_count)

    def write_channel(self, addr: int, ch: int, on: bool) -> bool:
        d = self.send_command(addr, F_WCH, bytes([ch, 1 if on else 0]), 1.0)
        return len(d) >= 2 and d[1] != 0xE5

    def read_signals(self, addr: int, channel_count: int) -> List[bool]:
        """D2 讀全部通道信號（True=斷開/低=門開）"""
        d = self.send_command(addr, F_RSIG, b"\x00", 1.0)
        return parse_bits(d, 1, channel_count)

    def unlock(self, addr: int, ch: int) -> int:
        """E2 開鎖，回傳該通道當下信號（0=接通 1=斷開）"""
        d = self.send_command(addr, F_UNLOCK, bytes([ch]), 1.0)
        return d[1] if len(d) >= 2 else 0xFF

    def motor_until_change(self, addr, ch, timeout_100ms, stop_state) -> int:
        return self.send_command(addr, F_MOTOR_TO,
                                 bytes([ch, timeout_100ms, stop_state]), 3.0)[1]

    def motor_until_count(self, addr, ch, timeout_100ms, count) -> int:
        """E5 信號變更 N 次停 —— 掛拍螺桿出貨用"""
        return self.send_command(addr, F_MOTOR_CNT,
                                 bytes([ch, timeout_100ms, count]), 3.0)[1]

    def motor_while_state(self, addr, ch, timeout_100ms, state) -> int:
        return self.send_command(addr, F_MOTOR_IS,
                                 bytes([ch, timeout_100ms, state]), 3.0)[1]


# ============================================================
#  格號 → (板位址, 通道) 映射
# ============================================================

class CellMap:
    """
    預設用公式：第 1~N 格→板1，第 N+1 格→板2…（N = channels_per_board）
    若提供 cells.csv（每行 `格號,板位址,通道`）則以該表優先。

    ⚠️ SKB18 = 18 路。22 格需要兩塊板（18 + 4）。
    """

    def __init__(self, channels_per_board: int = 25, first_board_addr: int = 1):
        self.channels_per_board = channels_per_board
        self.first_board_addr = first_board_addr
        self._explicit = {}

    def load(self, path: str) -> int:
        import os
        if not os.path.exists(path):
            return 0
        with open(path, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                p = line.split(",")
                if len(p) < 3:
                    continue
                try:
                    self._explicit[int(p[0])] = (int(p[1]), int(p[2]))
                except ValueError:
                    continue
        return len(self._explicit)

    @property
    def explicit_count(self) -> int:
        return len(self._explicit)

    def get(self, cell: int):
        """回傳 (board, ch)，超出範圍回 None"""
        if cell < 1:
            return None
        if cell in self._explicit:
            return self._explicit[cell]
        idx = cell - 1
        return (self.first_board_addr + idx // self.channels_per_board,
                idx % self.channels_per_board + 1)


# ============================================================
#  命令列自測（免硬體）
# ============================================================

def _demo() -> int:
    print("===== 模擬器：虛擬 25 路鎖控板（位址 1，無需硬體）=====")
    events = []
    sim = SimBoardTransport(1, 25)
    c = SkbClient(sim)
    c.on_auto_upload = lambda a, ch, s: (
        events.append((a, ch, s)),
        print("  [A0 自動上傳] 板%d 第%d格 信號=%d（%s）" %
              (a, ch, s, "接通/高電平" if s == 0 else "斷開/低電平")))
    c.open()
    try:
        print("[1] DF 廣播尋址 …")
        print("    板子位址 =", c.scan_address())

        print("[2] DD 讀 MCU ID …")
        print("    MCU ID =", hexs(c.read_mcu_id(1)))

        print("[3] E0 寫配置：開鎖 200ms、斷開時自動上傳 …")
        c.write_config(1, 9600, 20, 0x01)
        print("   ", c.read_config(1))

        print("[4] D2 讀全部通道信號（應全部接通=門關）：")
        _print_signals(c.read_signals(1, 25))

        print("[5] E2 開第 7 格（模擬客人取件）…")
        print("    回傳信號 =", c.unlock(1, 7))
        print("    （等待模擬 門開 → 門關，約 3 秒 …）")
        time.sleep(3.5)

        print("[6] D2 再讀一次（第 7 格應已回接通=門已關）：")
        _print_signals(c.read_signals(1, 25))
    finally:
        c.close()
    print("===== 取件流程模擬完成 =====")
    return 0


def _print_signals(sig: List[bool]) -> None:
    for i, s in enumerate(sig):
        print("%3d:%s  " % (i + 1, "斷開" if s else "接通"), end="")
        if (i + 1) % 5 == 0:
            print()
    print()


if __name__ == "__main__":
    import sys
    argv = sys.argv[1:]
    if not argv or argv[0] == "sim":
        raise SystemExit(_demo())

    port = argv[0]
    cmd = argv[1] if len(argv) > 1 else "probe"
    baud = 9600
    for a in argv:
        if a.startswith("baud="):
            baud = int(a[5:])

    if cmd == "raw":
        t = SerialTransport(port, baud)
        t.open()
        try:
            got = bytearray()
            for i in range(3):
                f = build(BROADCAST, F_SCAN, None)
                print("[送出 %d/3] %s" % (i + 1, hexs(f)))
                t.write(f)
                end = time.time() + 1.0
                while time.time() < end:
                    b = t.read_byte(0.1)
                    if b >= 0:
                        got.append(b)
            print()
            if not got:
                print("[收到] 0 個位元組 — 完全沒有任何訊號回來。")
                print("  → 物理層問題：A/B 接反、GND 未接、線斷，或協議不符")
                raise SystemExit(2)
            print("[收到] %d 個位元組：%s" % (len(got), hexs(bytes(got))))
            if HEADER in got:
                print("  → 看到幀頭 0x55，通訊正常")
            else:
                print("  → 亂碼：接線對，但波特率不符")
        finally:
            t.close()

    elif cmd == "sweep":
        for b in (9600, 19200, 38400, 57600, 115200):
            print("  %6d bps … " % b, end="", flush=True)
            try:
                with SkbClient(SerialTransport(port, b)) as c:
                    print("[OK] 有回應！板子位址 =", c.scan_address())
                    raise SystemExit(0)
            except SkbTimeout:
                print("無回應")
            except Exception as e:
                print("開埠失敗：", e)
                raise SystemExit(3)
            time.sleep(0.3)
        print("\n五種波特率全部無回應 → 問題在物理層或協議不符")
        raise SystemExit(2)

    else:  # probe
        with SkbClient(SerialTransport(port, baud)) as c:
            print("===== 驗板開始 =====")
            found = c.scan_address()
            print("[1/4] DF 廣播尋址 … 位址 =", found)
            print("[2/4] DD 讀 MCU ID …", hexs(c.read_mcu_id(found)))
            print("[3/4] D0 讀系統配置 …", c.read_config(found))
            print("[4/4] D2 讀全部通道信號 …")
            _print_signals(c.read_signals(found, 25))
            print("===== 驗板完成：協議相符 =====")

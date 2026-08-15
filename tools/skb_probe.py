#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
skb_probe.py — UPUS-SKB 鎖控板驗板工具（Mac / Linux 版）

跟 Win7 上的 SkbProbe.exe 做的事一樣，協議完全相同。
USB-485 或 USB-TTL 都能用，差別只在指到哪個 /dev/cu.*。

安裝相依：
    python3 -m pip install --user pyserial

用法：
    python3 skb_probe.py ports              列出所有序列埠（先跑這個）
    python3 skb_probe.py raw                送 3 次尋址幀，看有沒有位元組回來
    python3 skb_probe.py sweep              掃 5 種波特率
    python3 skb_probe.py hunt               持續偵測，接對會嗶聲（換線時用）
    python3 skb_probe.py listen 20          # 只聽不送 20 秒（測板→PC 方向）
    python3 skb_probe.py fuzz               # 盲測 Modbus RTU（板子可能不講 55 A1）
    python3 skb_probe.py blind              # 二輪盲測：BREAK 喚醒 + 常見幀頭 + ASCII
    python3 skb_probe.py line 3             # 線路體檢：看線是高是低，驗杜邦線接觸

    加 --port /dev/cu.usbserial-1234 指定埠，不加會自動挑第一個 USB 序列埠
    加 --baud 19200 改波特率（預設 9600）
"""

import sys
import time
import glob
import argparse

try:
    import serial
except ImportError:
    sys.exit("缺少 pyserial。在這個目錄下建一個虛擬環境即可：\n"
             "    python3 -m venv .venv\n"
             "    source .venv/bin/activate\n"
             "    pip install pyserial\n"
             "\n"
             "（macOS / 新版 Linux 的系統 Python 受 PEP 668 保護，"
             "不讓直接 pip install。venv 是最乾淨的做法。）")

# ---------- 協議 ----------
HEADER = 0x55
VENDOR = 0xA1
F_SCAN = 0xDF          # 廣播尋址（位址必須用 FF）
ADDR_BROADCAST = 0xFF

BAUDS = [9600, 19200, 38400, 57600, 115200, 4800, 2400, 1200]


def build_frame(addr, func, data=None):
    """55 A1 <位址> <功能碼> <長度> <資料...> <XOR>

    XOR = 前面所有位元組的互斥或。
    驗證：55^A1^FF^DF^00 = D4，與手冊範例 `55 A1 FF DF 00 D4` 相符。
    """
    data = data or b""
    body = bytes([HEADER, VENDOR, addr, func, len(data)]) + data
    xor = 0
    for b in body:
        xor ^= b
    return body + bytes([xor])


def hexs(bs):
    return " ".join("%02X" % b for b in bs)


def modbus_crc(bs):
    """Modbus RTU CRC16（0xA001 反轉、初值 0xFFFF、低 byte 先附）。"""
    crc = 0xFFFF
    for b in bs:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return bytes([crc & 0xFF, (crc >> 8) & 0xFF])


def modbus_frame(addr, func, data):
    body = bytes([addr, func]) + data
    return body + modbus_crc(body)


# ---------- 埠 ----------
def list_ports():
    """Mac 用 /dev/cu.*（callout），不要用 /dev/tty.*（會等 DCD 卡住）。"""
    return sorted(glob.glob("/dev/cu.usb*") + glob.glob("/dev/cu.wch*") +
                  glob.glob("/dev/cu.SLAB*") + glob.glob("/dev/ttyUSB*") +
                  glob.glob("/dev/ttyACM*"))


def cmd_ports():
    ports = list_ports()
    print("=" * 50)
    print("  找到的 USB 序列埠")
    print("=" * 50)
    if not ports:
        print("\n  ✗ 一個都沒有。檢查：")
        print("    1. 轉換器有沒有插好（LED 亮不亮）")
        print("    2. 是不是插在 hub 上 — 先直接插 Mac 本體試試")
        print("    3. macOS 內建 CH34x / CP210x 驅動，通常不用裝；")
        print("       真的抓不到再去裝原廠驅動")
        return 1
    for p in ports:
        hint = ""
        if "wch" in p.lower():
            hint = "  ← CH340/CH341 晶片"
        elif "SLAB" in p:
            hint = "  ← CP210x 晶片"
        print("  %s%s" % (p, hint))
    print("\n  提示：Mac 這邊分不出 485 還是 TTL —— 兩者在系統上長得一模一樣。")
    print("        要看轉換器外殼絲印（寫 'USB to 485' 還是 'USB to TTL'）。")
    return 0


def pick_port(explicit):
    if explicit:
        return explicit
    ports = list_ports()
    if not ports:
        sys.exit("找不到任何 USB 序列埠。先跑：python3 skb_probe.py ports")
    if len(ports) > 1:
        print("[!] 有多個埠，自動選了 %s" % ports[0])
        print("    要指定的話加 --port <路徑>\n")
    return ports[0]


def open_port(port, baud, parity=serial.PARITY_NONE, stopbits=1):
    return serial.Serial(port=port, baudrate=baud, bytesize=8,
                         parity=parity, stopbits=stopbits, timeout=0.2)


def send_and_read(port, baud, frame, listen_ms=700, verbose=True):
    """開埠 → 送一幀 → 收 listen_ms 毫秒 → 關埠。回傳收到的位元組。"""
    got = bytearray()
    ser = open_port(port, baud)
    try:
        ser.reset_input_buffer()
        ser.write(frame)
        ser.flush()
        if verbose:
            print("  [送出] %s" % hexs(frame))
        end = time.time() + listen_ms / 1000.0
        while time.time() < end:
            chunk = ser.read(64)
            if chunk:
                got.extend(chunk)
    finally:
        ser.close()
    return bytes(got)


# ---------- 指令 ----------
def cmd_raw(port, baud):
    print("=" * 50)
    print("  原始位元組監看：%s @ %d bps" % (port, baud))
    print("=" * 50)
    frame = build_frame(ADDR_BROADCAST, F_SCAN)
    got = bytearray()
    for i in range(3):
        got.extend(send_and_read(port, baud, frame))
        time.sleep(0.2)

    print()
    if not got:
        print("  [收到] 0 個位元組 — 完全沒有任何訊號回來。")
        print()
        print("  問題在物理層，不是波特率。請檢查：")
        print("    1. A/B 兩條資料線接反（最常見）→ 對調後再跑一次")
        print("    2. 485 GND 沒接上轉換器的 GND2")
        print("    3. 板子沒有獨立供電（DC 7~24V，USB 轉接頭不供電）")
        print("    4. 端子螺絲沒鎖緊 / 線芯沒咬到銅")
        return 1

    print("  [收到] %d 個位元組" % len(got))
    print("  %s" % hexs(got))
    if HEADER in got:
        print("\n  ★ 看到幀頭 55 — 這組接法和波特率都對了！")
    else:
        print("\n  ⚠ 是亂碼 — 線接對了，但波特率不對。跑 sweep 找。")
    return 0


def cmd_sweep(port):
    print("=" * 50)
    print("  波特率掃描：%s" % port)
    print("  （每個速率送一次 DF 廣播尋址，等 1 秒）")
    print("=" * 50)
    print()
    # 每個速率送三種：DF 廣播、DD 點名位址 1、D0 讀配置位址 1
    frames = [build_frame(ADDR_BROADCAST, F_SCAN),
              build_frame(0x01, 0xDD),
              build_frame(0x01, 0xD0)]
    hit = False
    for baud in BAUDS:
        try:
            got = bytearray()
            for fr in frames:
                got.extend(send_and_read(port, baud, fr, listen_ms=500,
                                         verbose=False))
            got = bytes(got)
        except Exception as e:
            print("  %7d bps ...  開埠失敗：%s" % (baud, e))
            continue
        if got:
            hit = True
            print("  %7d bps ...  ★ 收到 %d bytes: %s" % (baud, len(got), hexs(got)))
        else:
            print("  %7d bps ...  無回應" % baud)
        time.sleep(0.2)

    print()
    if hit:
        print("  ===== 有回應！記下上面那個波特率 =====")
        return 0

    print("  ===== 五種波特率全部無回應 =====")
    print("  波特率已排除，問題在物理層。請依序檢查：")
    print("    1. A/B 兩條資料線對調後再掃一次（最常見原因）")
    print("    2. 485 GND 是否確實接上轉換器的 GND2")
    print("    3. 板子是否有獨立供電 DC 7~24V")
    print("    4. 用 listen 指令看板子會不會自己送東西出來")
    return 1


def cmd_hunt(port, baud):
    print("=" * 50)
    print("  找線模式  %s @ %d bps" % (port, baud))
    print("=" * 50)
    print()
    print("  每 1.5 秒送一次訊號。收到任何回應會「嗶」一聲，")
    print("  不用一直盯著螢幕 —— 眼睛看硬體、手直接換線。")
    print("  換線時不用停程式。按 Ctrl+C 結束。")
    print()
    print("-" * 50)

    # 每輪送兩種：DF 廣播 + DD 點名位址 1（七段顯示器顯示 01）
    frames = [build_frame(ADDR_BROADCAST, F_SCAN),
              build_frame(0x01, 0xDD)]
    rnd = 0
    while True:
        rnd += 1
        try:
            got = bytearray()
            for fr in frames:
                got.extend(send_and_read(port, baud, fr, listen_ms=350,
                                         verbose=False))
            got = bytes(got)
        except Exception as e:
            print("  #%-4d 開埠失敗：%s" % (rnd, e))
            time.sleep(2)
            continue

        stamp = time.strftime("%H:%M:%S")
        if not got:
            print("  #%-4d %s   .....  0 bytes" % (rnd, stamp))
        else:
            for _ in range(3):
                sys.stdout.write("\a")
                sys.stdout.flush()
                time.sleep(0.15)
            print()
            print("  " + "#" * 44)
            print("  ##  有回應了！%d 個位元組" % len(got))
            print("  ##  %s" % hexs(got))
            if HEADER in got:
                print("  ##  看到幀頭 55 — 這組接法就是對的！")
            else:
                print("  ##  是亂碼 — 線接對了，但波特率要用 sweep 找")
            print("  ##  ★ 記下現在的接線方式，然後 Ctrl+C 停止 ★")
            print("  " + "#" * 44)
            print()
        time.sleep(0.8)


def cmd_deep(port):
    """最後一道網：波特率 × 校驗位 × 停止位，全部組合掃一遍。

    為什麼需要：文件寫 N/8/1，但實際板卡若是 E/8/1 或 O/8/1，
    板子永遠收不到合法位元組。而兩支轉換器對接時兩端同為 N，
    這個變數測不出來 —— 是唯一還沒被排除的串口參數。
    """
    print("=" * 50)
    print("  深度掃描：波特率 × 校驗位 × 停止位")
    print("  %s" % port)
    print("=" * 50)
    print()

    parities = [("N", serial.PARITY_NONE),
                ("E", serial.PARITY_EVEN),
                ("O", serial.PARITY_ODD)]
    frames = [build_frame(ADDR_BROADCAST, F_SCAN),
              build_frame(0x01, 0xDD)]

    total = 0
    hits = []
    for baud in BAUDS:
        for pname, pval in parities:
            for stop in (1, 2):
                total += 1
                label = "%6d  8%s%d" % (baud, pname, stop)
                got = bytearray()
                try:
                    ser = open_port(port, baud, pval, stop)
                    try:
                        for fr in frames:
                            ser.reset_input_buffer()
                            ser.write(fr)
                            ser.flush()
                            end = time.time() + 0.30
                            while time.time() < end:
                                chunk = ser.read(64)
                                if chunk:
                                    got.extend(chunk)
                    finally:
                        ser.close()
                except Exception as e:
                    print("  %s  開埠失敗：%s" % (label, e))
                    continue

                if got:
                    hits.append((label, bytes(got)))
                    print("  %s  ★ 收到 %d bytes: %s" % (label, len(got), hexs(got)))
                else:
                    print("  %s  ." % label)

    print()
    print("  共測試 %d 種串口參數組合。" % total)
    if hits:
        print("  ===== 有回應！=====")
        for label, got in hits:
            print("  %s → %s" % (label, hexs(got)))
        return 0
    print("  ===== 全部無回應 =====")
    print("  串口參數已完全排除（波特率 8 種 × 校驗 3 種 × 停止位 2 種）。")
    print("  剩下的可能只有：協議本身不對，或板卡發送端故障。")
    return 1


def cmd_ping(port, baud):
    """把板子能聽懂的指令輪流敲一遍，不只 DF 廣播。

    為什麼需要這個：DF 走廣播位址 FF，走的是韌體裡「廣播」那條路。
    若那條路有問題（或板子被設成不回應廣播），點名式指令仍可能有反應。
    板子預設位址 = 撥碼值 + 1，全 OFF 時是 1。
    """
    print("=" * 50)
    print("  全指令敲門：%s @ %d bps" % (port, baud))
    print("=" * 50)
    print()

    tries = [("DF 廣播尋址", ADDR_BROADCAST, 0xDF, None)]
    for addr in range(1, 33):
        tries.append(("DD 讀 MCU ID  位址 %d" % addr, addr, 0xDD, None))
    for addr in range(1, 9):
        tries.append(("D0 讀系統配置 位址 %d" % addr, addr, 0xD0, None))

    # 先確認埠真的開得起來，免得刷 40 行一樣的錯誤
    try:
        open_port(port, baud).close()
    except Exception as e:
        print("  ✗ 埠打不開：%s" % e)
        print()
        print("  埠號會漂 —— 換 USB 孔或重插就會變。先跑：")
        print("      python3 skb_probe.py ports")
        print("  拿到新的埠號再回來。")
        return 2

    hits = []
    for name, addr, func, data in tries:
        frame = build_frame(addr, func, data)
        try:
            got = send_and_read(port, baud, frame, listen_ms=350, verbose=False)
        except Exception as e:
            print("  %-24s 開埠失敗：%s" % (name, e))
            time.sleep(1)
            continue
        if got:
            hits.append((name, got))
            print("  %-24s ★ 收到 %d bytes: %s" % (name, len(got), hexs(got)))
        else:
            print("  %-24s ." % name)

    print()
    if hits:
        print("  ===== 有回應！=====")
        for name, got in hits:
            print("  %s → %s" % (name, hexs(got)))
        return 0
    print("  ===== 全部無回應 =====")
    print("  DF 廣播 + 32 個位址的 DD + 8 個位址的 D0，板子一律不出聲。")
    print("  位址已經完全排除，不用再懷疑撥碼開關。")
    return 1


def cmd_fuzz(port):
    """盲測 Modbus RTU —— 實物板與文件不符，它可能根本講 Modbus。

    我們一直送 55 A1 私有幀；但實際板卡若是另一系韌體（黑色 PCB、
    50 路板甚至不在文件內），最常見的產業標準協議就是 Modbus RTU。
    掃 波特率 × 校驗位，輪流送標準讀指令（讀線圈 / 讀保持 / 讀輸入暫存器，
    位址 00/01/02/FF）。有任何回應就嗶。
    """
    print("=" * 50)
    print("  Modbus RTU 盲測：%s" % port)
    print("  8 波特率 × 5 校驗，約 2~3 分鐘；有回應會嗶")
    print("=" * 50)
    print()

    frames = []
    for addr in (0x01, 0x02, 0x00, 0xFF):
        frames.append(modbus_frame(addr, 0x01, b"\x00\x00\x00\x08"))  # 讀線圈
        frames.append(modbus_frame(addr, 0x03, b"\x00\x00\x00\x01"))  # 讀保持暫存器
        frames.append(modbus_frame(addr, 0x04, b"\x00\x00\x00\x01"))  # 讀輸入暫存器

    parities = [("N", serial.PARITY_NONE), ("E", serial.PARITY_EVEN),
                ("O", serial.PARITY_ODD), ("M", serial.PARITY_MARK),
                ("S", serial.PARITY_SPACE)]
    hits = []
    for baud in BAUDS:
        for pname, pval in parities:
            got = bytearray()
            try:
                ser = serial.Serial(port=port, baudrate=baud, bytesize=8,
                                    parity=pval, stopbits=1, timeout=0.15)
                try:
                    ser.reset_input_buffer()
                    for fr in frames:
                        ser.write(fr)
                        ser.flush()
                        chunk = ser.read(64)
                        if chunk:
                            got.extend(chunk)
                finally:
                    ser.close()
            except Exception as e:
                print("  %6d 8%s1  開埠失敗：%s" % (baud, pname, e))
                continue
            if got:
                hits.append((baud, pname, bytes(got)))
                for _ in range(3):
                    sys.stdout.write("\a")
                    sys.stdout.flush()
                    time.sleep(0.15)
                print("  %6d 8%s1  ★ 收到 %d bytes: %s" % (baud, pname, len(got), hexs(got)))
            else:
                print("  %6d 8%s1  ." % (baud, pname))

    print()
    if hits:
        print("  ===== Modbus 命中！=====")
        for baud, pname, got in hits:
            print("  %d 8%s1 → %s" % (baud, pname, hexs(got)))
        return 0
    print("  ===== Modbus RTU 也無回應 =====")
    print("  下一條路：listen 同時把板上按鈕全按一輪（抓板子自己吐的幀），")
    print("  或繞過 485，USB-TTL 直接 MCU UART（Bluetooth 空焊區 TX/RX）。")
    return 1


def cmd_line(port, baud, seconds):
    """線路體檢：開埠純看線上狀態，驗證杜邦線有沒有接觸。

    判讀：
    - 板「沒」上電時量到連續 00 → 線被沒電的板子拉低 → 白線有接觸到
    - 板「有」上電時安靜 → 線被板子驅高 → 接觸 OK，且這針可能是 TX
    - 兩種狀態都安靜 → 白線懸空，重新插
    """
    print("=" * 50)
    print("  線路體檢：%s @ %d，%d 秒" % (port, baud, seconds))
    print("=" * 50)
    ser = open_port(port, baud)
    got = bytearray()
    try:
        end = time.time() + seconds
        while time.time() < end:
            chunk = ser.read(64)
            if chunk:
                got.extend(chunk)
    finally:
        ser.close()
    print()
    if not got:
        print("  [安靜] 一個位元組都沒有 — 線是高的（或懸空）。")
        print("  判讀：板『沒上電』卻安靜 → 白線可能沒接觸，重新插再量。")
        print("        板『有上電』且安靜 → 接觸 OK，線被板子驅高。")
        return 0
    zeros = sum(1 for b in got if b == 0)
    print("  [收到 %d bytes] %s" % (len(got), hexs(got[:16])))
    if zeros > len(got) * 0.8:
        print("  判讀：連續 00 = 線被壓低。")
        print("  板沒上電：這就是『白線有接觸』的樣子（沒電的板把線拉低）。接觸 OK！")
        print("  板有上電：這針不是 TX，或黑線 GND 沒接好。")
    else:
        print("  判讀：線上有真實資料或雜訊 — 有接觸，而且有東西在送！")
    return 0


def cmd_blind(port):
    """第二輪 485 盲測：BREAK 喚醒 + 常見幀頭 + ASCII 指令。

    Modbus 測過之後的補網：
    - 有些設備睡眠要吃 BREAK 才醒，醒來可能吐開機文
    - 常見二進位幀頭（AA 55 / 55 AA / EB 90）+ 和校驗
    - 簡單 ASCII 指令（AT / OPEN / *# 類）
    """
    print("=" * 50)
    print("  第二輪盲測：%s" % port)
    print("  BREAK 喚醒 + 常見幀頭 + ASCII；有回應會嗶")
    print("=" * 50)
    print()

    def sum8(bs):
        return sum(bs) & 0xFF

    frames = []
    for head in (b"\xAA\x55", b"\x55\xAA", b"\xEB\x90"):
        body = head + b"\x01\x01\x00"
        frames.append(body + bytes([sum8(body)]))
    frames.append(b"AT\r\n")
    frames.append(b"AT\r")
    frames.append(b"OPEN\r\n")
    frames.append(b"*01#")
    frames.append(b"$01\r")

    hits = []
    for baud in BAUDS:
        try:
            ser = open_port(port, baud)
        except Exception as e:
            print("  %6d  開埠失敗：%s" % (baud, e))
            continue
        got = bytearray()
        try:
            ser.reset_input_buffer()
            ser.send_break(0.08)
            chunk = ser.read(64)
            if chunk:
                got.extend(chunk)
            for fr in frames:
                ser.write(fr)
                ser.flush()
                chunk = ser.read(64)
                if chunk:
                    got.extend(chunk)
        finally:
            ser.close()
        if got:
            hits.append((baud, bytes(got)))
            for _ in range(3):
                sys.stdout.write("\a")
                sys.stdout.flush()
                time.sleep(0.15)
            print("  %6d  ★ 收到 %d bytes: %s" % (baud, len(got), hexs(got)))
        else:
            print("  %6d  ." % baud)

    print()
    if hits:
        print("  ===== 有回應！=====")
        for baud, got in hits:
            print("  %d → %s" % (baud, hexs(got)))
        return 0
    print("  ===== 二輪盲測也無回應 =====")
    return 1


def cmd_listen(port, baud, seconds):
    """只聽不送。用來分辨 TX 路徑壞還是 RX 路徑壞。

    跑這個的同時去按板子上的 reset 或開關按鈕：
      收到位元組 → 板→PC 這條路是通的，問題在 PC→板 或板子不理會指令
      收不到     → 兩條路都不通（或根本沒接對）
    """
    print("=" * 50)
    print("  純接收監聽：%s @ %d bps，%d 秒" % (port, baud, seconds))
    print("=" * 50)
    print()
    print("  ★ 現在去按板子上的 RESET 按鈕幾次（或長按「全開」鍵）★")
    print()

    ser = open_port(port, baud)
    got = bytearray()
    try:
        end = time.time() + seconds
        while time.time() < end:
            chunk = ser.read(64)
            if chunk:
                got.extend(chunk)
                print("  收到 %d bytes: %s" % (len(chunk), hexs(chunk)))
    finally:
        ser.close()

    print()
    if got:
        print("  [結果] 共收到 %d 個位元組 — 板→PC 方向是通的。" % len(got))
        return 0
    print("  [結果] 20 秒內一個位元組都沒有 — 收訊路徑也不通。")
    return 1


def main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("cmd", nargs="?", default="ports",
                    choices=["ports", "raw", "sweep", "hunt", "listen", "ping",
                             "deep", "fuzz", "blind", "line"])
    ap.add_argument("seconds", nargs="?", type=int, default=20)
    ap.add_argument("--port", default=None)
    ap.add_argument("--baud", type=int, default=9600)
    ap.add_argument("-h", "--help", action="store_true")
    args = ap.parse_args()

    if args.help:
        print(__doc__)
        return 0

    if args.cmd == "ports":
        return cmd_ports()

    port = pick_port(args.port)

    if args.cmd == "raw":
        return cmd_raw(port, args.baud)
    if args.cmd == "sweep":
        return cmd_sweep(port)
    if args.cmd == "ping":
        return cmd_ping(port, args.baud)
    if args.cmd == "deep":
        return cmd_deep(port)
    if args.cmd == "fuzz":
        return cmd_fuzz(port)
    if args.cmd == "blind":
        return cmd_blind(port)
    if args.cmd == "line":
        return cmd_line(port, args.baud, args.seconds)
    if args.cmd == "hunt":
        return cmd_hunt(port, args.baud)
    if args.cmd == "listen":
        return cmd_listen(port, args.baud, args.seconds)
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n已停止。")
        sys.exit(130)

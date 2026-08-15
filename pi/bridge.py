#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bridge.py — 本機 HTTP ↔ RS-485 橋接（Python / Raspberry Pi）

從 SkbBridge.cs 移植。瀏覽器碰不到串口，由本程式代送 485 指令。

    Chromium kiosk --> http://localhost:8080/ --> SkbClient --485--> 鎖控板

用法：
    python3 bridge.py                    讀同目錄 config.ini
    python3 bridge.py --config other.ini
    python3 bridge.py --sim              強制模擬器（忽略設定檔的 port）

端點（全部回 JSON，皆加 CORS 標頭）：
    GET /health              服務與連線狀態
    GET /scan                DF 廣播尋址（診斷）
    GET /unlock?cell=7       E2 開第 7 格
    GET /doors               D2 讀全部格位門磁（open=true 表門開）
    GET /events              取出並清空 A0 自動上傳事件佇列
    GET /code?value=1234     查取件碼 → 格號（查本機快取，不連網）
    GET /picked?value=1234   標記取件完成（本機立即生效，回寫走背景佇列）
    GET /sync                立刻強制同步一次 Google Sheet
    GET /                    供應 web/index.html（同源，免 CORS 問題）
"""

import argparse
import configparser
import json
import mimetypes
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import skb
from sheet import SheetSync
from mqtt_link import MqttLink

BASE = os.path.dirname(os.path.abspath(__file__))


# ============================================================
#  設定
# ============================================================

DEFAULTS = {
    "store_id": "store1",
    "port": "/dev/ttyUSB0",
    "baud": "9600",
    "sim": "false",
    "http_port": "8080",
    "cells": "22",
    "channels_per_board": "18",   # SKB18；SKB25 改 25
    "first_board_addr": "1",
    # A0 自動上傳：開了才有即時門磁事件，不用輪詢。
    # ⚠️ 同一條 485 總線只能開一台（多板會碰撞）—— 多板請維持 false 並用 /doors 輪詢
    "autoupload": "false",
    # A0 上傳時機（手冊低4Bit，三選一，無法兩者都要）：
    #   1 = 信號斷開/低電平時 → 門「開」時上傳
    #   2 = 信號接通/高電平時 → 門「關」時上傳 ★ 預設，這才是取件完成
    "autoupload_mode": "2",
    "unlock_ms": "200",
    "csv": "",
    "remote_csv": "",
    "posturl": "",
    "token": "",
    "sync": "60",
    # ── 車隊層（選用；不填就不啟動，其他功能完全正常）──
    "mqtt_host": "",
    "mqtt_port": "8883",
    "mqtt_user": "",
    "mqtt_pass": "",
    "mqtt_tls": "true",
    "mqtt_status_sec": "60",
}


def load_config(path: str) -> dict:
    cfg = dict(DEFAULTS)
    if os.path.exists(path):
        cp = configparser.ConfigParser()
        cp.optionxform = str  # 保留大小寫
        with open(path, encoding="utf-8") as f:
            cp.read_string("[main]\n" + f.read())
        for k, v in cp["main"].items():
            cfg[k.strip().lower()] = v.strip()
    return cfg


def as_bool(v) -> bool:
    return str(v).strip().lower() in ("1", "true", "yes", "on")


# ============================================================
#  橋接服務
# ============================================================

class Bridge:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.store_id = cfg["store_id"]
        self.sim = as_bool(cfg["sim"])
        self.port = cfg["port"]
        self.baud = int(cfg["baud"])
        self.total_cells = int(cfg["cells"])
        self.http_port = int(cfg["http_port"])
        self.autoupload = as_bool(cfg["autoupload"])
        self.autoupload_mode = int(cfg["autoupload_mode"]) & 0x0F
        self.unlock_ms = int(cfg["unlock_ms"])
        self._autoupload_done = False

        self.map = skb.CellMap(int(cfg["channels_per_board"]),
                               int(cfg["first_board_addr"]))
        n = self.map.load(os.path.join(BASE, "cells.csv"))
        self.map_source = ("cells.csv（%d 筆）" % n if n else
                           "公式（每板 %d 路，首板位址 %d）" %
                           (self.map.channels_per_board, self.map.first_board_addr))

        self._client = None
        self._gate = threading.Lock()
        self._events = []
        self._ev_lock = threading.Lock()
        self.last_error = ""

        self.sheet = SheetSync(cfg, BASE)
        self.sheet.on_remote_unlock = self._remote_unlock

        # 車隊層。開鎖不依賴它——連不上也不影響店裡營運。
        self.mqtt = MqttLink(cfg, {
            "unlock": self._mqtt_unlock,
            "doors": lambda: self._locked(self.doors),
            "health": self.health,
            "sync": self.sheet.sync_now,
        })

    # ---- 485 連線（惰性建立、失敗自動重連）----

    def ensure(self) -> skb.SkbClient:
        if self._client:
            return self._client
        t = (skb.SimBoardTransport(self.map.first_board_addr,
                                   self.map.channels_per_board)
             if self.sim else skb.SerialTransport(self.port, self.baud))
        c = skb.SkbClient(t)
        c.on_auto_upload = self._on_auto_upload
        c.open()
        self._client = c
        self.last_error = ""
        print("[連線] " + ("模擬器已就緒" if self.sim else self.port + " 已開啟"),
              flush=True)
        self._apply_board_config(c)
        return c

    def _apply_board_config(self, c) -> None:
        """
        開啟板子的 A0 自動上傳（E0 寫配置）。

        沒開的話門磁只能靠 /doors 輪詢，拿不到即時事件。
        ⚠️ 同一條 485 總線只能開一台，多板會碰撞（見 8/1 決議）。
           所以只對 first_board_addr 寫，且多板時預設不啟用。
        """
        if not self.autoupload or self._autoupload_done:
            return
        boards = {self.map.get(i)[0] for i in range(1, self.total_cells + 1)
                  if self.map.get(i)}
        if len(boards) > 1:
            print("[配置] 偵測到 %d 塊板，A0 會碰撞 —— 不啟用自動上傳，改用 /doors 輪詢"
                  % len(boards), flush=True)
            self.autoupload = False
            self._autoupload_done = True
            return
        addr = self.map.first_board_addr
        try:
            # 高4Bit=0 應答模式；低4Bit=上傳時機（1=門開時, 2=門關時）
            c.write_config(addr, self.baud, max(1, self.unlock_ms // 10),
                           self.autoupload_mode)
            cfg = c.read_config(addr)
            print("[配置] 板%d 已啟用 A0 自動上傳 → %s" % (addr, cfg), flush=True)
            self._autoupload_done = True
        except Exception as e:
            print("[配置] 寫入失敗（不影響開鎖，門磁改用輪詢）：%s" % e, flush=True)

    def drop(self, why: str) -> None:
        self.last_error = why
        if self._client:
            try:
                self._client.close()
            except Exception:
                pass
            self._client = None
        print("[斷線] %s（下次請求會自動重連）" % why, flush=True)

    def _on_auto_upload(self, board: int, ch: int, sig: int) -> None:
        cell = -1
        for i in range(1, self.total_cells + 1):
            m = self.map.get(i)
            if m and m[0] == board and m[1] == ch:
                cell = i
                break
        ev = {"board": board, "ch": ch, "cell": cell,
              "open": sig != 0, "ts": int(time.time() * 1000)}
        with self._ev_lock:
            self._events.append(ev)
            del self._events[:-200]
        print("  [A0] 板%d 通道%d → 格%d %s" %
              (board, ch, cell, "門開" if sig else "門關"), flush=True)
        self.mqtt.event("door", ev)

    def _locked(self, fn, *a):
        with self._gate:
            return fn(*a)

    def _mqtt_unlock(self, cell: int):
        with self._gate:
            return self.unlock(cell)

    def _remote_unlock(self, cell: int) -> bool:
        m = self.map.get(cell)
        if not m or cell > self.total_cells:
            return False
        with self._gate:
            self.ensure().unlock(m[0], m[1])
        return True

    # ---- 業務 ----

    def unlock(self, cell: int):
        m = self.map.get(cell)
        if not m or cell > self.total_cells:
            return None
        board, ch = m
        print("[開鎖] 格%d → 板%d 通道%d" % (cell, board, ch), flush=True)
        sig = self.ensure().unlock(board, ch)
        return {"cell": cell, "board": board, "ch": ch, "open": sig != 0}

    def doors(self):
        c = self.ensure()
        per_board = {}
        out = []
        for cell in range(1, self.total_cells + 1):
            m = self.map.get(cell)
            if not m:
                continue
            b, ch = m
            if b not in per_board:
                per_board[b] = c.read_signals(b, self.map.channels_per_board)
            sig = per_board[b]
            if ch < 1 or ch > len(sig):
                # 映射超出該板實際通道數 —— 設定錯誤，不要讓整支 /doors 掛掉
                out.append({"cell": cell, "board": b, "ch": ch,
                            "open": None, "error": "channel_out_of_range"})
                continue
            out.append({"cell": cell, "board": b, "ch": ch,
                        "open": bool(sig[ch - 1])})
        return out

    def validate_map(self):
        """開機時檢查映射是否超出每板通道數。回傳問題清單。"""
        bad = []
        for cell in range(1, self.total_cells + 1):
            m = self.map.get(cell)
            if not m:
                bad.append((cell, None, None))
                continue
            b, ch = m
            if ch > self.map.channels_per_board:
                bad.append((cell, b, ch))
        return bad

    def pop_events(self):
        with self._ev_lock:
            ev, self._events[:] = list(self._events), []
        return ev

    def health(self):
        ok, err = True, ""
        try:
            self.ensure()
        except Exception as e:
            ok, err = False, str(e)
        return {
            "ok": ok,
            "store": self.store_id,
            "mode": "sim" if self.sim else "serial",
            "port": self.port,
            "baud": self.baud,
            "cells": self.total_cells,
            "channelsPerBoard": self.map.channels_per_board,
            "sheet": bool(self.sheet.csv_url),
            "codes": self.sheet.code_count,
            "pendingWrites": self.sheet.queue_count,
            "lastSync": self.sheet.last_sync.strftime("%H:%M:%S")
                        if self.sheet.last_sync else "",
            "sheetError": self.sheet.last_error,
            "mqtt": ("on" if self.mqtt.connected else
                     ("retry" if self.mqtt.enabled else "off")),
            "mqttError": self.mqtt.last_error,
            "lastError": err or self.last_error,
        }


# ============================================================
#  HTTP
# ============================================================

def make_handler(bridge: Bridge):

    web_root = os.path.join(BASE, "web")

    class Handler(BaseHTTPRequestHandler):
        server_version = "SkbBridge/1.0"

        def log_message(self, fmt, *args):
            pass  # 靜音，避免每次輪詢都洗版

        # ---- 工具 ----

        def _send(self, status: int, body: bytes, ctype: str):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(body)
            except Exception:
                pass

        def _json(self, status: int, obj: dict):
            self._send(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                       "application/json; charset=utf-8")

        def _q(self, name, default=None):
            return parse_qs(urlparse(self.path).query).get(name, [default])[0]

        def _qi(self, name, default=-1):
            try:
                return int(self._q(name, default))
            except (TypeError, ValueError):
                return default

        def do_OPTIONS(self):
            self._send(204, b"", "text/plain")

        # ---- 路由 ----

        def do_GET(self):
            path = urlparse(self.path).path.lower()
            try:
                with bridge._gate:
                    if path == "/health":
                        h = bridge.health()
                        return self._json(200 if h["ok"] else 503, h)

                    if path == "/scan":
                        return self._json(200, {"ok": True,
                                                "address": bridge.ensure().scan_address()})

                    if path == "/unlock":
                        r = bridge.unlock(self._qi("cell"))
                        if r is None:
                            return self._json(400, {"ok": False, "error": "bad_cell"})
                        r["ok"] = True
                        return self._json(200, r)

                    if path == "/doors":
                        return self._json(200, {"ok": True, "cells": bridge.doors()})

                    if path == "/events":
                        return self._json(200, {"ok": True, "events": bridge.pop_events()})

                    if path == "/code":
                        return self._code()

                    if path == "/picked":
                        return self._picked()

                    if path == "/sync":
                        ok, err = bridge.sheet.sync_now()
                        return self._json(200, {"ok": ok,
                                                "codes": bridge.sheet.code_count,
                                                "error": err})

                if self._static(path):
                    return
                self._json(404, {"ok": False, "error": "unknown_endpoint",
                                 "path": path})

            except skb.SkbTimeout as e:
                bridge.drop("逾時：%s" % e)
                self._json(504, {"ok": False, "error": "timeout", "message": str(e)})
            except Exception as e:
                bridge.drop(str(e))
                self._json(500, {"ok": False, "error": "exception", "message": str(e)})

        # ---- 取件碼（查本機快取，完全不連網）----

        def _code(self):
            v = self._q("value")
            if not v:
                return self._json(400, {"ok": False, "error": "missing_value"})
            e = bridge.sheet.lookup(v)
            if e is None:
                return self._json(200, {"ok": False, "error": "not_found"})
            if e.expired:
                return self._json(200, {"ok": False, "error": "expired",
                                        "expires": e.expires, "cell": e.cell})
            if not e.pickable:
                return self._json(200, {"ok": False, "error": "not_pickable",
                                        "status": e.status, "cell": e.cell})
            if e.cell > bridge.total_cells:
                return self._json(200, {"ok": False, "error": "cell_out_of_range",
                                        "cell": e.cell})
            return self._json(200, {"ok": True, "cell": e.cell,
                                    "status": e.status, "note": e.note})

        def _picked(self):
            v = self._q("value")
            if not v:
                return self._json(400, {"ok": False, "error": "missing_value"})
            cell = self._qi("cell")
            bridge.sheet.mark_picked(v, cell)
            bridge.mqtt.event("picked", {"code": v, "cell": cell,
                                         "ts": int(time.time() * 1000)})
            print("[取件] 碼 %s → 格%d（待回寫 %d 筆）" %
                  (v, cell, bridge.sheet.queue_count), flush=True)
            return self._json(200, {"ok": True, "queued": bridge.sheet.queue_count})

        # ---- 靜態網頁（同源載入，省掉 file:// 連 localhost 的問題）----

        def _static(self, path: str) -> bool:
            if not os.path.isdir(web_root):
                return False
            rel = "index.html" if path in ("/", "") else path.lstrip("/")
            full = os.path.realpath(os.path.join(web_root, rel))
            if not full.startswith(os.path.realpath(web_root)):
                return False  # 防目錄穿越
            if not os.path.isfile(full):
                return False
            ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype.endswith("javascript"):
                ctype += "; charset=utf-8"
            with open(full, "rb") as f:
                self._send(200, f.read(), ctype)
            return True

    return Handler


# ============================================================
#  main
# ============================================================

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(BASE, "config.ini"))
    ap.add_argument("--sim", action="store_true", help="強制模擬器模式")
    args = ap.parse_args()

    cfg = load_config(args.config)
    if args.sim:
        cfg["sim"] = "true"

    b = Bridge(cfg)

    print("=" * 58)
    print("  SkbBridge — 智慧拍櫃 HTTP↔RS-485 橋接（Pi 版）")
    print("=" * 58)
    print("  店號      ： %s" % b.store_id)
    print("  模式      ： %s" % ("模擬器（無硬體）" if b.sim
                                 else "串口 %s @ %d" % (b.port, b.baud)))
    print("  HTTP      ： http://localhost:%d/" % b.http_port)
    print("  總格數    ： %d" % b.total_cells)
    print("  格號映射  ： %s" % b.map_source)
    print("  A0 自動上傳： %s" % (
        ("啟用 — %s時上傳" % ("門開" if b.autoupload_mode == 1 else "門關"))
        if b.autoupload else "關閉（門磁走 /doors 輪詢）"))
    print("  取件碼來源： %s" % ("Google Sheet CSV（每 %d 秒同步）" % b.sheet.interval
                                if b.sheet.csv_url else "未設定 — 前端退回 DEMO 碼"))
    print("  遠端開格  ： %s" % (b.sheet.remote_csv and "已啟用" or "未設定"))
    print("  取件回寫  ： %s" % (b.sheet.post_url and "Apps Script（背景佇列）"
                                or "未設定 — 僅記錄於本機 pickups.queue"))
    print("  車隊 MQTT ： %s" % (("%s:%d（%s）" % (b.mqtt.host, b.mqtt.port,
                                 "TLS" if b.mqtt.tls else "明文"))
                                if b.mqtt.enabled else "未設定 — 遠端開格改走 Sheet 輪詢"))

    # ⚠️ 容量檢查 —— 公式模式與 cells.csv 都要驗
    need = -(-b.total_cells // b.map.channels_per_board)
    if need > 1:
        print()
        print("  ⚠️  %d 格 ÷ 每板 %d 路 = 需要 %d 塊板級聯" %
              (b.total_cells, b.map.channels_per_board, need))

    bad = b.validate_map()
    if bad:
        print()
        print("  🛑 映射錯誤：以下格號的通道超出每板 %d 路" % b.map.channels_per_board)
        for cell, board, ch in bad[:8]:
            print("       格 %-3d → 板%s 通道%s" % (cell, board, ch))
        if len(bad) > 8:
            print("       …共 %d 筆" % len(bad))
        print("     請修正 cells.csv，或把 channels_per_board 改成正確值。")
        print("     （SKB18=18、SKB25=25、SKB36=36）")
    print()

    b.sheet.start()
    b.mqtt.start()

    if os.path.isfile(os.path.join(BASE, "web", "index.html")):
        print("[OK] Kiosk 網頁：http://localhost:%d/" % b.http_port)
    else:
        print("[!]  web/index.html 不存在，僅提供 API")
    print("[OK] 健康檢查：http://localhost:%d/health" % b.http_port)
    print("     Ctrl+C 結束。", flush=True)

    srv = ThreadingHTTPServer(("127.0.0.1", b.http_port), make_handler(b))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n結束中…")
    finally:
        b.mqtt.stop()
        b.sheet.stop()
        b.drop("shutdown")
    return 0


if __name__ == "__main__":
    sys.exit(main())

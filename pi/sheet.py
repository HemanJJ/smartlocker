#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sheet.py — Google Sheet ↔ 本機快取同步（Python / Raspberry Pi）

從 SheetSync.cs 移植。設計原則不變：

    ★ 開鎖永遠查本機，網路只負責更新本機。★

斷網、Google 掛掉、Sheet 被改壞，都不影響已同步下來的取件碼。
開機先讀快取，所以沒網路也能立刻服務。

比 .NET 版少一個大麻煩：Python 沒有 TLS 1.2 的問題。

Sheet 欄位（第一列標題，中英皆可辨識）：
    取件碼 | 格號 | 狀態 | 取件時間 | 備註
    code   | cell | status | picked_at | note
狀態：待取 / 已取 / 停用（空白視同「待取」）

★ 5 家店的遠端開格：
    另一份發布的 CSV，欄位 `店號,格號`。
    每台 Pi 只認自己的店號，處理完會記錄避免重複開。
    這是 MVP 的權宜做法（延遲 = 同步間隔）；正式版走 MQTT。
"""

import csv
import io
import json
import os
import threading
import time
import urllib.request
from datetime import datetime
from typing import Dict, List, Optional

UA = "SkbBridge-Pi/1.0"


class CodeEntry:
    __slots__ = ("code", "cell", "status", "note", "expires")

    def __init__(self, code: str, cell: int, status: str = "",
                 note: str = "", expires: str = ""):
        self.code = code
        self.cell = cell
        self.status = status
        self.note = note
        self.expires = expires   # 空白 = 不限期

    @property
    def expired(self) -> bool:
        """效期已過？空白視為不限期。接受 YYYY-MM-DD 或 YYYY-MM-DD HH:MM"""
        s = (self.expires or "").strip()
        if not s:
            return False
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d",
                    "%Y/%m/%d %H:%M", "%Y/%m/%d"):
            try:
                dt = datetime.strptime(s, fmt)
                if fmt == "%Y-%m-%d" or fmt == "%Y/%m/%d":
                    dt = dt.replace(hour=23, minute=59, second=59)
                return datetime.now() > dt
            except ValueError:
                continue
        return False  # 格式看不懂就不擋，避免把有效碼誤殺

    @property
    def pickable(self) -> bool:
        if self.expired:
            return False
        s = (self.status or "").strip()
        if not s:
            return True
        return s in ("待取", "待取件") or s.lower() in ("pending", "ready")


def _norm(h: str) -> str:
    return (h or "").strip().lower()


_COL_CODE = {"取件碼", "取件码", "code", "pickup", "pickupcode"}
_COL_CELL = {"格號", "格号", "cell", "cellno", "格位"}
_COL_STATUS = {"狀態", "状态", "status"}
_COL_NOTE = {"備註", "备注", "note", "remark"}
_COL_STORE = {"店號", "店号", "store", "storeid", "店"}
_COL_EXPIRES = {"效期", "有效期", "到期", "expires", "expiry", "valid_until"}


class SheetSync:
    def __init__(self, cfg: dict, base_dir: str):
        self.csv_url = cfg.get("csv", "").strip()
        self.post_url = cfg.get("posturl", "").strip()
        self.token = cfg.get("token", "").strip()
        self.remote_csv = cfg.get("remote_csv", "").strip()
        self.store_id = cfg.get("store_id", "").strip()
        self.interval = int(cfg.get("sync", 60))
        self.base = base_dir

        self.cache_file = os.path.join(base_dir, "codes.cache.csv")
        self.queue_file = os.path.join(base_dir, "pickups.queue")
        self.done_file = os.path.join(base_dir, "remote_done.json")

        self._codes: Dict[str, CodeEntry] = {}
        self._queue: List[dict] = []
        self._remote_done = set()
        self._lock = threading.RLock()
        self._running = False

        self.last_sync: Optional[datetime] = None
        self.last_error = ""
        # 遠端開格回呼：fn(cell:int) -> bool
        self.on_remote_unlock = None

    # ---------- 啟動 ----------

    def start(self) -> None:
        self._load_cache()
        self._load_queue()
        self._load_done()
        self._running = True
        threading.Thread(target=self._loop, daemon=True).start()

    def stop(self) -> None:
        self._running = False

    def _loop(self) -> None:
        while self._running:
            if self.csv_url:
                ok, err = self.sync_now()
                print("[同步] " + ("Sheet 已更新，取件碼 %d 筆" % self.code_count
                                  if ok else "失敗（繼續使用本機快取）：" + err),
                      flush=True)
            self._poll_remote_unlock()
            self.flush_queue()
            for _ in range(self.interval):
                if not self._running:
                    return
                time.sleep(1)

    # ---------- 讀取：CSV → 本機 ----------

    def _fetch(self, url: str, timeout: float = 12.0) -> str:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8-sig", errors="replace")

    def sync_now(self):
        if not self.csv_url:
            self.last_error = "未設定 csv 網址"
            return False, self.last_error
        try:
            text = self._fetch(self.csv_url)
        except Exception as e:
            self.last_error = str(e)
            return False, self.last_error

        if "<html" in text[:2000].lower():
            self.last_error = "拿到的是 HTML 不是 CSV — 請確認 Sheet 已「發布到網路」且格式選 CSV"
            return False, self.last_error

        try:
            parsed = self._parse(text, self.store_id)
        except Exception as e:
            self.last_error = "CSV 解析失敗：%s" % e
            return False, self.last_error

        if not parsed:
            self.last_error = "解析後 0 筆，保留舊快取不覆寫"
            return False, self.last_error

        with self._lock:
            self._codes = parsed
            # 已在本機標記取件、但還沒回寫成功的，覆蓋回「已取」，避免重複開格
            for q in self._queue:
                e = self._codes.get(q["code"])
                if e:
                    e.status = "已取"
            self.last_sync = datetime.now()
            self.last_error = ""

        try:
            with open(self.cache_file, "w", encoding="utf-8") as f:
                f.write(text)
        except Exception:
            pass
        return True, ""

    def _load_cache(self) -> None:
        if not os.path.exists(self.cache_file):
            return
        try:
            with open(self.cache_file, encoding="utf-8-sig") as f:
                self._codes = self._parse(f.read(), self.store_id)
            print("[快取] 已載入本機取件碼 %d 筆（尚未連線 Google）" % len(self._codes),
                  flush=True)
        except Exception as e:
            print("[快取] 載入失敗：%s" % e, flush=True)

    @staticmethod
    def _parse(text: str, store_id: str = "") -> Dict[str, CodeEntry]:
        """
        解析 Sheet CSV。

        ★ 多店隔離：若 Sheet 有「店號」欄，**只收 store_id 相符的列**。
          沒有該欄則全收（單店情境，向後相容）。

          這條很重要 —— 5 家共用一份 Sheet 時，沒有過濾的話
          A 店客人輸入 B 店的碼會打開 A 店的櫃子。
        """
        rows = list(csv.reader(io.StringIO(text)))
        out: Dict[str, CodeEntry] = {}
        if not rows:
            return out

        head = [_norm(h) for h in rows[0]]
        i_code = i_cell = i_status = i_note = i_store = i_exp = -1
        for i, h in enumerate(head):
            if h in _COL_CODE:
                i_code = i
            elif h in _COL_CELL:
                i_cell = i
            elif h in _COL_STATUS:
                i_status = i
            elif h in _COL_NOTE:
                i_note = i
            elif h in _COL_STORE:
                i_store = i
            elif h in _COL_EXPIRES:
                i_exp = i

        start = 1
        if i_code < 0 or i_cell < 0:
            i_code, i_cell, i_status, i_note, start = 0, 1, 2, 3, 0

        def cellv(r, i):
            return r[i].strip() if 0 <= i < len(r) else ""

        for r in rows[start:]:
            if len(r) <= max(i_code, i_cell):
                continue
            # 多店隔離
            if i_store >= 0 and store_id:
                if cellv(r, i_store) != store_id:
                    continue
            code = r[i_code].strip()
            if not code:
                continue
            try:
                cell = int(r[i_cell].strip())
            except ValueError:
                continue
            if cell < 1:
                continue
            out[code] = CodeEntry(code, cell,
                                  cellv(r, i_status), cellv(r, i_note),
                                  cellv(r, i_exp))
        return out

    # ---------- 查詢 ----------

    def lookup(self, code: str) -> Optional[CodeEntry]:
        if not code:
            return None
        with self._lock:
            return self._codes.get(code.strip())

    @property
    def code_count(self) -> int:
        with self._lock:
            return len(self._codes)

    @property
    def queue_count(self) -> int:
        with self._lock:
            return len(self._queue)

    # ---------- 回寫：本機佇列 → Apps Script ----------

    def mark_picked(self, code: str, cell: int) -> None:
        with self._lock:
            e = self._codes.get(code)
            if e:
                e.status = "已取"
            self._queue.append({
                "ts": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "code": code, "cell": cell})
        self._save_queue()

    def _load_queue(self) -> None:
        if not os.path.exists(self.queue_file):
            return
        try:
            with open(self.queue_file, encoding="utf-8") as f:
                self._queue = [json.loads(l) for l in f if l.strip()]
            if self._queue:
                print("[佇列] 有 %d 筆取件記錄尚未回寫" % len(self._queue), flush=True)
        except Exception:
            self._queue = []

    def _save_queue(self) -> None:
        try:
            with self._lock:
                lines = [json.dumps(q, ensure_ascii=False) for q in self._queue]
            with open(self.queue_file, "w", encoding="utf-8") as f:
                f.write("\n".join(lines) + ("\n" if lines else ""))
        except Exception:
            pass

    def flush_queue(self) -> None:
        """把佇列 POST 出去。失敗就原封不動留著，下輪再試。"""
        if not self.post_url:
            return
        with self._lock:
            batch = list(self._queue)
        if not batch:
            return

        body = json.dumps({"token": self.token, "store": self.store_id,
                           "items": batch}, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            self.post_url, data=body, method="POST",
            headers={"Content-Type": "application/json; charset=utf-8",
                     "User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=12) as r:
                if r.status == 200:
                    with self._lock:
                        del self._queue[:len(batch)]
                    self._save_queue()
                    print("[回寫] 已送出 %d 筆取件記錄" % len(batch), flush=True)
        except Exception as e:
            print("[回寫] 失敗，保留於本機佇列：%s" % e, flush=True)

    # ---------- 遠端開格（5 家店的 MVP 救援機制）----------

    def _load_done(self) -> None:
        try:
            if os.path.exists(self.done_file):
                with open(self.done_file, encoding="utf-8") as f:
                    self._remote_done = set(json.load(f))
        except Exception:
            self._remote_done = set()

    def _save_done(self) -> None:
        try:
            with open(self.done_file, "w", encoding="utf-8") as f:
                json.dump(sorted(self._remote_done)[-500:], f)
        except Exception:
            pass

    def _poll_remote_unlock(self) -> None:
        """
        讀第二份 CSV（欄位：店號, 格號[, 請求時間]），只處理自己店號的列。
        已處理過的用 `店號|格號|時間` 當鍵記錄，避免重複開。
        """
        if not (self.remote_csv and self.store_id and self.on_remote_unlock):
            return
        try:
            text = self._fetch(self.remote_csv, timeout=10)
        except Exception:
            return
        if "<html" in text[:2000].lower():
            return

        try:
            rows = list(csv.reader(io.StringIO(text)))
        except Exception:
            return
        if not rows:
            return

        head = [_norm(h) for h in rows[0]]
        i_store = i_cell = -1
        for i, h in enumerate(head):
            if h in _COL_STORE:
                i_store = i
            elif h in _COL_CELL:
                i_cell = i
        start = 1
        if i_store < 0 or i_cell < 0:
            i_store, i_cell, start = 0, 1, 0

        changed = False
        for r in rows[start:]:
            if len(r) <= max(i_store, i_cell):
                continue
            if r[i_store].strip() != self.store_id:
                continue
            try:
                cell = int(r[i_cell].strip())
            except ValueError:
                continue
            key = "|".join(x.strip() for x in r)
            if key in self._remote_done:
                continue
            print("[遠端開格] 店 %s 第 %d 格" % (self.store_id, cell), flush=True)
            try:
                self.on_remote_unlock(cell)
            except Exception as e:
                print("[遠端開格] 失敗：%s" % e, flush=True)
                continue
            self._remote_done.add(key)
            changed = True
        if changed:
            self._save_done()

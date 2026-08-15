#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mqtt_link.py — 車隊層：遠端開格、狀態回報、事件上報

★ 最高原則（Blueprint 附錄 B2）：
    開鎖路徑不得依賴網路。

  MQTT 是**加法**，不是必需品：
    - 沒設定 → 不啟動，其他功能完全正常
    - 連不上 → 背景無限重試，永不阻塞開鎖
    - broker 掛掉 → 店裡照常營運，只是遠端看不到

  這一層任何例外都被吞掉並記錄，絕不往上拋。

────────────────────────────────────────────────────────────
Topic 設計（{store} = config.ini 的 store_id）

  雲端 → 裝置
    skb/{store}/cmd/unlock    {"cell":7,"req":"abc123"}
    skb/{store}/cmd/sync      {}                       強制同步 Sheet
    skb/{store}/cmd/ping      {}                       要求立刻回報狀態
    skb/{store}/cmd/doors     {}                       要求回報門磁

  裝置 → 雲端
    skb/{store}/status        retained，每 N 秒一次心跳
    skb/{store}/lwt           retained，斷線時 broker 自動發（★ 車隊監控靠它）
    skb/{store}/evt/door      A0 門開/門關
    skb/{store}/evt/picked    取件完成
    skb/{store}/evt/ack       指令執行結果（含 req 對應）

  訂閱全部店：skb/+/status  或  skb/+/evt/#
────────────────────────────────────────────────────────────

相依：paho-mqtt
"""

import json
import threading
import time
from typing import Callable, Dict, Optional

try:
    import paho.mqtt.client as mqtt
    HAVE_PAHO = True
except ImportError:
    HAVE_PAHO = False


class MqttLink:
    def __init__(self, cfg: dict, handlers: Dict[str, Callable]):
        """
        handlers 需要提供：
            unlock(cell:int) -> dict|None
            doors()          -> list
            health()         -> dict
            sync()           -> (bool, str)
        """
        self.enabled = bool(cfg.get("mqtt_host", "").strip())
        self.host = cfg.get("mqtt_host", "").strip()
        self.port = int(cfg.get("mqtt_port", 8883))
        self.user = cfg.get("mqtt_user", "").strip()
        self.password = cfg.get("mqtt_pass", "").strip()
        self.tls = str(cfg.get("mqtt_tls", "true")).strip().lower() in ("1", "true", "yes", "on")
        self.store = cfg.get("store_id", "unknown").strip()
        self.status_interval = int(cfg.get("mqtt_status_sec", 60))

        self.h = handlers
        self._c: Optional["mqtt.Client"] = None
        self._running = False
        self._connected = False
        self._last_err = ""
        self._seen_req = []          # 指令去重（broker 重送時不要重複開格）

        self.base = "skb/%s" % self.store

    # ---------- 生命週期 ----------

    def start(self) -> None:
        if not self.enabled:
            return
        if not HAVE_PAHO:
            print("[MQTT] 未安裝 paho-mqtt，略過（pip install paho-mqtt）", flush=True)
            self.enabled = False
            return

        self._running = True
        threading.Thread(target=self._run, daemon=True).start()
        threading.Thread(target=self._status_loop, daemon=True).start()

    def stop(self) -> None:
        self._running = False
        if self._c:
            try:
                # 主動下線：把 status 改成 offline，別讓監控以為還活著
                self._pub(self.base + "/lwt", {"online": False,
                                               "reason": "shutdown"}, retain=True)
                self._c.loop_stop()
                self._c.disconnect()
            except Exception:
                pass

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def last_error(self) -> str:
        return self._last_err

    # ---------- 連線（失敗永遠重試，不阻塞任何人）----------

    def _run(self) -> None:
        backoff = 5
        while self._running:
            try:
                c = mqtt.Client(client_id="skb-%s" % self.store, clean_session=True)
                if self.user:
                    c.username_pw_set(self.user, self.password)
                if self.tls:
                    c.tls_set()
                # 遺囑：這台斷線時 broker 自動幫我們發，車隊監控就是靠這個
                c.will_set(self.base + "/lwt",
                           json.dumps({"online": False, "reason": "lwt"}),
                           qos=1, retain=True)
                c.on_connect = self._on_connect
                c.on_disconnect = self._on_disconnect
                c.on_message = self._on_message

                c.connect(self.host, self.port, keepalive=45)
                self._c = c
                backoff = 5
                c.loop_forever(retry_first_connection=False)
            except Exception as e:
                self._connected = False
                self._last_err = str(e)
                print("[MQTT] 連線失敗（%ds 後重試）：%s" % (backoff, e), flush=True)
            if not self._running:
                break
            time.sleep(backoff)
            backoff = min(backoff * 2, 120)

    def _on_connect(self, client, userdata, flags, rc):
        if rc != 0:
            self._last_err = "connect rc=%s" % rc
            print("[MQTT] 連線被拒 rc=%s" % rc, flush=True)
            return
        self._connected = True
        self._last_err = ""
        client.subscribe(self.base + "/cmd/#", qos=1)
        self._pub(self.base + "/lwt", {"online": True}, retain=True)
        self._publish_status()
        print("[MQTT] 已連線 %s:%d，訂閱 %s/cmd/#" %
              (self.host, self.port, self.base), flush=True)

    def _on_disconnect(self, client, userdata, rc):
        self._connected = False
        if rc != 0:
            print("[MQTT] 斷線 rc=%s，將自動重連" % rc, flush=True)

    # ---------- 指令 ----------

    def _on_message(self, client, userdata, msg):
        try:
            topic = msg.topic
            try:
                payload = json.loads(msg.payload.decode("utf-8") or "{}")
            except Exception:
                payload = {}
            cmd = topic.rsplit("/", 1)[-1]
            req = str(payload.get("req", ""))

            # 去重：broker 重送或網路抖動時不要重複開格
            if req:
                if req in self._seen_req:
                    print("[MQTT] 指令 %s 已處理過，略過（req=%s）" % (cmd, req), flush=True)
                    return
                self._seen_req.append(req)
                del self._seen_req[:-200]

            print("[MQTT] 收到指令 %s %s" % (cmd, payload), flush=True)
            ok, result = self._dispatch(cmd, payload)
            self._pub(self.base + "/evt/ack",
                      {"cmd": cmd, "req": req, "ok": ok, "result": result})
        except Exception as e:
            # 這一層絕不能把例外往上拋
            print("[MQTT] 處理指令時發生錯誤：%s" % e, flush=True)

    def _dispatch(self, cmd: str, payload: dict):
        try:
            if cmd == "unlock":
                cell = int(payload.get("cell", -1))
                r = self.h["unlock"](cell)
                return (r is not None), (r or {"error": "bad_cell", "cell": cell})

            if cmd == "doors":
                return True, {"cells": self.h["doors"]()}

            if cmd == "sync":
                ok, err = self.h["sync"]()
                return ok, {"error": err}

            if cmd == "ping":
                self._publish_status()
                return True, {"pong": True}

            return False, {"error": "unknown_cmd", "cmd": cmd}
        except Exception as e:
            return False, {"error": "exception", "message": str(e)}

    # ---------- 上報 ----------

    def _status_loop(self) -> None:
        while self._running:
            for _ in range(self.status_interval):
                if not self._running:
                    return
                time.sleep(1)
            if self._connected:
                self._publish_status()

    def _publish_status(self) -> None:
        try:
            s = self.h["health"]()
            s["ts"] = int(time.time())
            self._pub(self.base + "/status", s, retain=True)
        except Exception as e:
            print("[MQTT] 狀態回報失敗：%s" % e, flush=True)

    def event(self, kind: str, payload: dict) -> None:
        """給 bridge 呼叫。永遠不阻塞、永遠不丟例外。"""
        if not (self.enabled and self._connected):
            return
        try:
            self._pub("%s/evt/%s" % (self.base, kind), payload)
        except Exception:
            pass

    def _pub(self, topic: str, obj: dict, retain: bool = False) -> None:
        if not self._c:
            return
        try:
            self._c.publish(topic, json.dumps(obj, ensure_ascii=False),
                            qos=1, retain=retain)
        except Exception:
            pass

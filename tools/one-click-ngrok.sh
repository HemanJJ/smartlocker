#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  🎯 smartlocker 一鍵雲端隧道（cloudflared 主 + ngrok 備援）
#  把本機「模擬電控板」http://localhost:4321 開一個公開網址
#  讓你在別地 demo 也能連到 4321 當作模擬板（開格／22 格看板）
# ═══════════════════════════════════════════════════════════════
set -e

SMARTLOCKER="$HOME/Desktop/projects/code/smartlocker"
PORT=4321
FIRST=1

# 找隧道工具：cloudflared 優先、ngrok 備援
TUNNEL_BIN=""
for candidate in cloudflared ngrok; do
  if command -v "$candidate" >/dev/null 2>&1; then TUNNEL_BIN="$candidate"; break; fi
done
if [ -z "$TUNNEL_BIN" ]; then
  echo "❌ 找不到 cloudflared/ngrok。請先安裝：brew install cloudflared 或 brew install ngrok"
  exit 1
fi
echo "✅ 隧道工具：$TUNNEL_BIN"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  🎯 smartlocker 一鍵雲端隧道（外網 Demo）          ║"
echo "║  目標：把 http://localhost:${PORT} 開成公開網址             ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# 1. 確認模擬板 4321 是否在跑，沒跑就啟動
if curl -s --max-time 1 "http://localhost:${PORT}/state" >/dev/null 2>&1; then
  echo "✅ 模擬電控板已在跑 (http://localhost:${PORT}/)"
else
  echo "→ 模擬電控板未啟動，正在啟動..."
  (cd "$SMARTLOCKER/simulator" && nohup node mock-485.mjs >/tmp/mock485.log 2>&1 &)
  sleep 1.5
  if ! curl -s --max-time 2 "http://localhost:${PORT}/state" >/dev/null 2>&1; then
    echo "❌ 模擬板啟動失敗，請看 /tmp/mock485.log"
    exit 1
  fi
  echo "✅ 模擬板已啟動"
fi

# 2. 清除可能存在的舊隧道（避免網址重複）
pkill -f "cloudflared tunnel --url http://${PORT}" 2>/dev/null || true
pkill -f "ngrok http ${PORT}" 2>/dev/null || true
pkill -f "cloudflared" 2>/dev/null || true
sleep 1

# 3. 啟動隧道：cloudflared 或 ngrok
if [ "$TUNNEL_BIN" = "cloudflared" ]; then
  nohup cloudflared tunnel --url "http://127.0.0.1:${PORT}" >/tmp/cloudflared.log 2>&1 &
else
  nohup ngrok http ${PORT} --log "stdout" >/tmp/ngrok.log 2>&1 &
fi
sleep 3

# 4. 抓公開網址（cloudflared trycloudflare / ngrok API）
URL=""
for i in $(seq 1 10); do
  if [ "$TUNNEL_BIN" = "cloudflared" ]; then
    URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" /tmp/cloudflared.log | head -1)
  else
    URL=$(curl -s --max-time 1 http://localhost:4040/api/tunnels 2>/dev/null \
          | python3 -c "import json,sys
try:
  d=json.load(sys.stdin)
  for t in d.get('tunnels',[]):
    if t.get('public_url','').startswith('https'): print(t['public_url']); break
except Exception: pass" 2>/dev/null)
  fi
  if [ -n "$URL" ]; then break; fi
  sleep 1
done

if [ -z "$URL" ]; then
  echo "⚠️  無法自動取得公開網址，請打開 http://localhost:4040 查看。"
  echo "   日誌：/tmp/cloudflared.log"
  exit 1
fi

echo ""
echo "══════════════════════════════════════════════════════"
echo "  🎉 外網 Demo 網址已上線！"
echo ""
echo "  🔗 模擬板公開網址："
echo "     $URL"
echo ""
echo "  📋 給 kiosk 用（別地 demo）："
echo "     LOCKER_BRIDGE_URL=$URL"
echo ""
echo "  🖥  22 格看板網頁：  $URL/"
echo "  ⚡ 送幀測試："
echo "     curl -X POST $URL/rs485 -d '{\"hex\":\"55A101E2010117\"}'"
echo "══════════════════════════════════════════════════════"
echo ""

# 5. 寫入一個「目前網址」檔，供 Dashboard 顯示
echo "$URL" > "/tmp/smartlocker_tunnel_url.txt"
echo "${GREEN:-}" ""
echo "（此隧道連到 http://localhost:${PORT}，關掉本視窗不會停隧道，"
echo "  停止用： pkill -f 'cloudflared' ）"

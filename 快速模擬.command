#!/bin/bash
# 羽拍有約 · 穿線模擬 一鍵啟動（Mac 點兩下執行）
cd "$(dirname "$0")"

echo "════════════════════════════════════"
echo "  羽拍有約 · 穿線模擬 一鍵啟動"
echo "════════════════════════════════════"

# 1. 啟動格口模擬板（22 格看板，若 4321 已佔用則跳過）
if lsof -i :4321 >/dev/null 2>&1; then
  echo "✓ 模擬板已在跑（http://localhost:4321/）"
else
  echo "→ 啟動格口模擬板..."
  node simulator/mock-485.mjs &
  BOARD_PID=$!
  sleep 1
fi

# 2. 啟動 kiosk 輪詢（印貼紙＋開格）
echo "→ 啟動 kiosk 輪詢（印＋開格）..."
(cd web && BASE_URL=https://smartlocker-alpha.vercel.app LOCKER_BRIDGE_URL=http://localhost:4321 node scripts/kiosk-poller.mjs) &
POLLER_PID=$!
sleep 1

# 3. 開三個瀏覽器視窗
open "http://localhost:4321/"
open "https://smartlocker-alpha.vercel.app/order"
open "https://smartlocker-alpha.vercel.app/admin"

echo ""
echo "────────────────────────────────────────"
echo " 已開三個視窗："
echo "  ① 格口模擬板  http://localhost:4321/"
echo "  ② kiosk 下單  https://smartlocker-alpha.vercel.app/order"
echo "  ③ 員工後台    https://smartlocker-alpha.vercel.app/admin"
echo "────────────────────────────────────────"
echo " 模擬流程："
echo "  下單 → 看板開門 → LINE 傳取件碼（綁定＋電子小票）"
echo "        → 後台取件/送回/付款 → 客人收取件通知"
echo ""
echo " 結束：關掉這個視窗（會停掉輪詢程式）"
trap "kill $POLLER_PID $BOARD_PID 2>/dev/null" EXIT
wait

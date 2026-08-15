#!/usr/bin/env bash
# ============================================================
#  install.sh — 樹莓派一鍵佈署（智慧拍櫃 Kiosk）
#
#  在 Raspberry Pi OS (64-bit, Desktop) 上執行：
#      cd /opt/skb/pi && sudo bash install.sh
#
#  它會做：
#    1. 裝相依（pyserial、paho-mqtt、chromium、unclutter）
#    2. 把 USB-RS485 固定成 /dev/skb485（避免 ttyUSB0/1 跳號）
#    3. skbbridge.service   — 橋接服務，開機自啟、當掉自動重啟
#    4. skbkiosk.service    — Chromium kiosk，同上
#    5. 關螢幕保護與休眠
#    6. （選）裝 Tailscale — 讓您從任何地方 ssh 進來
#
#  ★ 5 家店：這支腳本 5 台跑一模一樣，差異只在 config.ini
# ============================================================
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_USER="${SUDO_USER:-pi}"
KIOSK_HOME="$(getent passwd "$KIOSK_USER" | cut -d: -f6)"

if [[ $EUID -ne 0 ]]; then
  echo "請用 sudo 執行： sudo bash install.sh"
  exit 1
fi

echo "============================================================"
echo "  智慧拍櫃 Kiosk — 樹莓派佈署"
echo "  目錄：$DIR"
echo "  使用者：$KIOSK_USER"
echo "============================================================"
echo

# ── 1. 相依 ────────────────────────────────────────────────
echo "[1/6] 安裝相依套件…"
apt-get update -qq
apt-get install -y -qq python3-serial python3-paho-mqtt chromium-browser unclutter xdotool curl >/dev/null
echo "      done."

# ── 2. 串口固定名稱 ────────────────────────────────────────
echo "[2/6] 設定 USB-RS485 固定裝置名稱 /dev/skb485…"
cat > /etc/udev/rules.d/99-skb485.rules <<'EOF'
# CH340 (QinHeng) USB-Serial → 固定成 /dev/skb485
# 插多個 USB 裝置時 ttyUSB0/1 會跳號，用固定名稱才可靠
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="7523", SYMLINK+="skb485", MODE="0666"
# FTDI 版轉換器（若改用 FTDI 晶片，取消下一行註解）
#SUBSYSTEM=="tty", ATTRS{idVendor}=="0403", ATTRS{idProduct}=="6001", SYMLINK+="skb485", MODE="0666"
EOF
udevadm control --reload-rules && udevadm trigger || true
usermod -aG dialout "$KIOSK_USER"
echo "      done.（config.ini 的 port 建議改成 /dev/skb485）"

# ── 3. 橋接服務 ────────────────────────────────────────────
echo "[3/6] 建立 skbbridge.service…"
cat > /etc/systemd/system/skbbridge.service <<EOF
[Unit]
Description=SkbBridge - 智慧拍櫃 HTTP/RS-485 橋接
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$KIOSK_USER
WorkingDirectory=$DIR
ExecStart=/usr/bin/python3 $DIR/bridge.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
echo "      done."

# ── 4. Kiosk 服務 ──────────────────────────────────────────
echo "[4/6] 建立 skbkiosk.service…"
cat > "$DIR/run-kiosk.sh" <<'EOF'
#!/usr/bin/env bash
# 等橋接起來（最多 60 秒），再開瀏覽器
for i in $(seq 1 30); do
  curl -sf http://localhost:8080/health >/dev/null && break
  sleep 2
done

export DISPLAY=:0
xset s off; xset -dpms; xset s noblank      # 不關螢幕、不進省電
unclutter -idle 0.1 -root &                  # 藏滑鼠游標

PROFILE="$HOME/.skb-chrome"
# 清掉「Chrome 未正確關閉」的還原提示
if [ -f "$PROFILE/Default/Preferences" ]; then
  sed -i 's/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$PROFILE/Default/Preferences" || true
fi

exec chromium-browser \
  --kiosk \
  --app=http://localhost:8080/ \
  --user-data-dir="$PROFILE" \
  --no-first-run \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-translate \
  --disable-features=TranslateUI,Translate \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --noerrdialogs \
  --check-for-update-interval=31536000
EOF
chmod +x "$DIR/run-kiosk.sh"
chown "$KIOSK_USER":"$KIOSK_USER" "$DIR/run-kiosk.sh"

cat > /etc/systemd/system/skbkiosk.service <<EOF
[Unit]
Description=SkbKiosk - Chromium 全螢幕取件介面
After=graphical.target skbbridge.service
Wants=skbbridge.service

[Service]
Type=simple
User=$KIOSK_USER
Environment=DISPLAY=:0
Environment=XAUTHORITY=$KIOSK_HOME/.Xauthority
ExecStart=$DIR/run-kiosk.sh
Restart=always
RestartSec=5

[Install]
WantedBy=graphical.target
EOF
echo "      done."

# ── 5. 電源與螢幕 ──────────────────────────────────────────
echo "[5/6] 關閉螢幕保護與休眠…"
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null 2>&1 || true
echo "      done."

systemctl daemon-reload
systemctl enable skbbridge.service skbkiosk.service >/dev/null

# ── 6. Tailscale（選用）────────────────────────────────────
echo "[6/6] Tailscale（遠端 SSH，5 家店強烈建議）"
if command -v tailscale >/dev/null 2>&1; then
  echo "      已安裝，略過。"
else
  read -r -p "      要現在安裝嗎？[y/N] " yn
  if [[ "${yn:-N}" =~ ^[Yy]$ ]]; then
    curl -fsSL https://tailscale.com/install.sh | sh
    echo
    echo "      裝好了。接著執行（會給您一個授權網址）："
    echo "          sudo tailscale up --hostname=$(grep -E '^\s*store_id' "$DIR/config.ini" 2>/dev/null | cut -d= -f2 | tr -d ' ' || echo skb-pi)"
  else
    echo "      略過。之後可執行： curl -fsSL https://tailscale.com/install.sh | sh"
  fi
fi

echo
echo "============================================================"
echo "  佈署完成"
echo "============================================================"
echo
echo "  接下來："
echo "    1. 編輯設定       nano $DIR/config.ini"
echo "         ★ store_id 每店必須不同"
echo "         ★ port 建議改成 /dev/skb485"
echo "    2. 確認串口       ls -l /dev/skb485"
echo "    3. 驗板           python3 $DIR/skb.py /dev/skb485 probe"
echo "    4. 啟動           sudo systemctl start skbbridge skbkiosk"
echo "    5. 看狀態         systemctl status skbbridge"
echo "       看 log         journalctl -u skbbridge -f"
echo
echo "  沒硬體想先看畫面：  python3 $DIR/bridge.py --sim"
echo
echo "  ⚠️ 重開機一次讓 dialout 群組生效。"
echo

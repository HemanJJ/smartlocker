// kiosk 開格輪詢程式（跑在 Win10 kiosk 上）
// 輪詢雲端 cell_commands → 組 RS-485 開鎖幀 → 送給「模擬橋」或「實體鎖控板」→ 回報完成。
//
// 用法（模擬模式，接視覺模擬板）：
//   BASE_URL=https://smartlocker-alpha.vercel.app LOCKER_BRIDGE_URL=http://localhost:4321 node scripts/locker-poller.mjs
// 用法（實體模式，接 RS-485 串口；需實作 serial 送出）：
//   BASE_URL=... LOCKER_MODE=serial LOCKER_SERIAL_PORT=COM3 node scripts/locker-poller.mjs
// 單次執行（測試用）：加 ONCE=1
//
// 協議：UPUS-SKB，幀 = 55 A1 <地址> <功能碼> <長度> <資料> <XOR校驗>；開鎖功能碼 E2。

const BASE = process.env.BASE_URL || 'https://smartlocker-alpha.vercel.app';
const BRIDGE = process.env.LOCKER_BRIDGE_URL || 'http://localhost:4321';
const MODE = process.env.LOCKER_MODE || 'bridge';
const ADDR = Number(process.env.LOCKER_ADDR || 1); // 板卡地址（撥碼 +1）
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL || 2000);

function buildFrame(addr, func, data) {
  const bytes = [0x55, 0xa1, addr, func, data.length, ...data];
  bytes.push(bytes.reduce((a, b) => a ^ b, 0) & 0xff);
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
}

async function fetchPending() {
  const res = await fetch(`${BASE}/api/cell-commands?status=pending`);
  const data = await res.json();
  return data.ok ? data.commands : [];
}

async function sendUnlock(slotNo) {
  const frame = buildFrame(ADDR, 0xe2, [slotNo]);
  if (MODE === 'serial') {
    // 實體 RS-485：此處接 serialport 送出 frame（Node 需安裝 serialport）。
    // 參考：const { SerialPort } = require('serialport'); port.write(Buffer.from(frame, 'hex'));
    console.log(`[serial] 送出開鎖幀 ${frame} 到 ${process.env.LOCKER_SERIAL_PORT || 'COM?'}`);
    return true;
  }
  // 模擬模式：送給視覺模擬橋
  const res = await fetch(`${BRIDGE}/rs485`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hex: frame }),
  });
  const result = await res.json();
  if (result.error) {
    console.error(`[bridge] 開格 ${slotNo} 失敗：${result.error}`);
    return false;
  }
  console.log(`[bridge] 開格 ${slotNo}：TX ${frame} → RX ${result.hex}`);
  return true;
}

async function markDone(id) {
  await fetch(`${BASE}/api/cell-commands/${id}/done`, { method: 'POST' });
}

async function loop() {
  console.log(`[locker] 開始輪詢 ${BASE}/api/cell-commands (mode=${MODE}, addr=${ADDR})`);
  for (;;) {
    try {
      const jobs = await fetchPending();
      if (jobs.length) console.log(`[locker] 發現 ${jobs.length} 筆開格指令`);
      for (const j of jobs) {
        console.log(`[locker] 開格 第${j.slotNo} 格`);
        const ok = await sendUnlock(j.slotNo);
        if (ok) {
          await markDone(j.id);
          console.log(`[locker] ✓ 已回報完成（指令 ${j.id}）`);
        }
      }
    } catch (e) {
      console.error('[locker] 錯誤:', e.message);
    }
    if (process.env.ONCE) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  console.log('[locker] 本輪結束');
}

loop();

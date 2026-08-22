// kiosk 統一輪詢程式（列印＋開格，一個程式搞定）
// 跑在 Win10 kiosk 上，取代舊的 print-poller.mjs + locker-poller.mjs 兩支分開跑。
//
// 流程（以實際實體流程為準）：
//   交拍：輪詢 print_jobs → ①印貼紙（含格號）→ ②開第 N 格 → ③回報完成
//   開格（取件/送回/客人取件）：輪詢 cell_commands → 開第 N 格 → 回報完成
//
// 用法（模擬模式）：
//   BASE_URL=https://smartlocker-alpha.vercel.app LOCKER_BRIDGE_URL=http://localhost:4321 node scripts/kiosk-poller.mjs
// 單次（測試）：加 ONCE=1
//
// 依賴：qrcode、sharp（已在 web/package.json）

import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const BASE = process.env.BASE_URL || 'https://smartlocker-alpha.vercel.app';
const BRIDGE = process.env.LOCKER_BRIDGE_URL || 'http://localhost:4321';
const MODE = process.env.LOCKER_MODE || 'bridge';
const PRINT_MODE = process.env.PRINT_MODE || 'file';
const ADDR = Number(process.env.LOCKER_ADDR || 1);
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL || 2000);

// ── RS-485 幀 ──
function buildFrame(addr, func, data) {
  const bytes = [0x55, 0xa1, addr, func, data.length, ...data];
  bytes.push(bytes.reduce((a, b) => a ^ b, 0) & 0xff);
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
}

async function sendUnlock(slotNo) {
  const frame = buildFrame(ADDR, 0xe2, [slotNo]);
  if (MODE === 'serial') {
    // 實體 RS-485：接 serialport 寫出 frame
    console.log(`[serial] 開格 ${slotNo}：TX ${frame}`);
    return true;
  }
  const res = await fetch(`${BRIDGE}/rs485`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hex: frame }),
  });
  const r = await res.json();
  if (r.error) { console.error(`[開格] 格${slotNo} 失敗：${r.error}`); return false; }
  console.log(`[開格] 格${slotNo}：TX ${frame} → RX ${r.hex}`);
  return true;
}

// ── 貼紙 ──
async function generateLabel(job) {
  const L = job.label;
  const colorText = L.color ? ` · ${L.color}` : '';
  // 4×3 cm 貼紙 @203dpi ≈ 320×240 px；內容：線種＋色、磅數、取件碼（無 QR/格號/金額）
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
  <rect width="320" height="240" fill="#fff"/>
  <text x="160" y="54" font-family="Arial, sans-serif" font-size="26" font-weight="bold" text-anchor="middle" fill="#000">${L.model}${colorText}</text>
  <text x="160" y="94" font-family="Arial, sans-serif" font-size="24" text-anchor="middle" fill="#000">${L.tension} lbs</text>
  <text x="160" y="132" font-family="Arial, sans-serif" font-size="18" text-anchor="middle" fill="#777">取件碼</text>
  <text x="160" y="198" font-family="Arial, sans-serif" font-size="58" font-weight="bold" text-anchor="middle" fill="#000">${L.pickupCode}</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function printLabel(pngBuf, job) {
  if (PRINT_MODE === 'file') {
    const file = path.join(process.cwd(), `label-${job.label.pickupCode}.png`);
    fs.writeFileSync(file, pngBuf);
    console.log(`[列印] 已輸出貼紙：${file}`);
    return true;
  }
  const tmp = path.join(os.tmpdir(), `label-${job.label.pickupCode}.png`);
  fs.writeFileSync(tmp, pngBuf);
  const { execSync } = require('child_process');
  try {
    execSync(`powershell -Command "Start-Process -FilePath '${tmp}' -Verb Print"`, { stdio: 'ignore' });
    return true;
  } catch (e) {
    console.error('[列印] 失敗:', e.message);
    return false;
  }
}

// ── 雲端 API ──
async function fetchPrintJobs() {
  const r = await fetch(`${BASE}/api/print-jobs?status=pending`).then((x) => x.json());
  return r.ok ? r.jobs : [];
}
async function fetchCellCommands() {
  const r = await fetch(`${BASE}/api/cell-commands?status=pending`).then((x) => x.json());
  return r.ok ? r.commands : [];
}
async function markPrintDone(id) {
  await fetch(`${BASE}/api/print-jobs/${id}/done`, { method: 'POST' });
}
async function markCellDone(id) {
  await fetch(`${BASE}/api/cell-commands/${id}/done`, { method: 'POST' });
}

async function loop() {
  console.log(`[kiosk] 開始（列印+開格） ${BASE} (mode=${MODE}, addr=${ADDR})`);
  for (;;) {
    try {
      // ① 交拍：印貼紙 → 開格 → 回報
      const jobs = await fetchPrintJobs();
      for (const job of jobs) {
        console.log(`[交拍] 單號 ${job.label.orderNo} → 第 ${job.label.slotNo} 格`);
        const png = await generateLabel(job);
        if (!(await printLabel(png, job))) continue;
        if (await sendUnlock(job.label.slotNo)) {
          await markPrintDone(job.id);
          console.log(`[交拍] ✓ 完成（已印＋已開第 ${job.label.slotNo} 格）`);
        }
      }

      // ② 開格（取件/送回/客人取件）
      const cmds = await fetchCellCommands();
      for (const c of cmds) {
        console.log(`[開格] 第 ${c.slotNo} 格`);
        if (await sendUnlock(c.slotNo)) {
          await markCellDone(c.id);
          console.log(`[開格] ✓ 完成（第 ${c.slotNo} 格）`);
        }
      }
    } catch (e) {
      console.error('[kiosk] 錯誤:', e.message);
    }
    if (process.env.ONCE) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  console.log('[kiosk] 本輪結束');
}

loop();

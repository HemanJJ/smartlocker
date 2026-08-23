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
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);

const BASE = process.env.BASE_URL || 'https://smartlocker-alpha.vercel.app';
const BRIDGE = process.env.LOCKER_BRIDGE_URL || 'http://localhost:4321';
const MODE = process.env.LOCKER_MODE || 'bridge';
const PRINT_MODE = process.env.PRINT_MODE || 'file';
const ADDR = Number(process.env.LOCKER_ADDR || 1);
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL || 2000);
// 每店店名（中文＋英文），從環境變數帶入（300 店各設自己的）
const STORE = process.env.STORE || '太平永成店';
const STORE_EN = process.env.STORE_EN || 'Pai store';
const PRINTER_NAME = process.env.PRINTER || 'Gprinter GP-3120TN';

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

// ── 標籤列印（中文，Seagull 驅動；呼叫 print-label.ps1）──
async function printLabel(job) {
  const L = job.label;
  // 從訂單資料自動組出標籤 4 行（線種+色 / 磅數 / 金額 / 取件號）
  const line1 = L.color ? `${L.model} ${L.color}` : L.model;
  const line2 = `${L.tension} lbs`;
  const line3 = `NT$${L.price}`;
  const line4 = `取件號 ${L.pickupCode}`;
  const cfg = { store: STORE, storeEn: STORE_EN, line1, line2, line3, line4, printer: PRINTER_NAME };

  if (PRINT_MODE === 'file') {
    // 預覽模式：只輸出標籤設定 JSON，方便看訊息（不改動列印）
    const f = path.join(process.cwd(), `label-${L.pickupCode}.json`);
    fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
    console.log(`[列印] 已輸出標籤設定：${f}`);
    return true;
  }

  // 寫暫存 config → 呼叫 print-label.ps1（Seagull 驅動＋微軟正黑印中文）
  const tmp = path.join(os.tmpdir(), `label-${L.pickupCode}.json`);
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  const here = path.dirname(fileURLToPath(import.meta.url));
  const script = path.join(here, 'print-label.ps1');
  const { execSync } = require('child_process');
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${script}" -ConfigFile "${tmp}"`, { stdio: 'ignore' });
    console.log(`[列印] ✓ 已印 ${L.pickupCode}（${STORE}）`);
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
        if (!(await printLabel(job))) continue;
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

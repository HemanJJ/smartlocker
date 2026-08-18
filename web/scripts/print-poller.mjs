// kiosk 列印輪詢程式（參考實作，跑在 Win10 kiosk 上）
// 輪詢雲端 print_jobs → 產生貼紙 PNG（QR＋文字）→ 列印 → 回報完成。
//
// 用法：
//   BASE_URL=https://smartlocker-alpha.vercel.app PRINT_MODE=file node scripts/print-poller.mjs
//   （PRINT_MODE=file 會把貼紙存成 label-<取件碼>.png，方便先看版型）
//   BASE_URL=... PRINT_MODE=windows node scripts/print-poller.mjs
//   （PRINT_MODE=windows 會呼叫 Windows 驅動列印）
//
// 貼紙規格：2×3 吋（50.8×76.2mm @203dpi ≈ 406×609 px），GoDex EZ120。
// 依 HANDOFF §四，正式列印可改走 C# + GoDex SDK；此檔為可先跑通的參考版。
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const QRCode = require('qrcode');
const sharp = require('sharp');

const BASE = process.env.BASE_URL || 'https://smartlocker-alpha.vercel.app';
const PRINT_MODE = process.env.PRINT_MODE || 'file';
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL || 3000);

async function fetchPending() {
  const res = await fetch(`${BASE}/api/print-jobs?status=pending`);
  const data = await res.json();
  return data.ok ? data.jobs : [];
}

// 產生 406×609 貼紙圖（QR 編碼取件碼＋文字）。文字用 ASCII 確保任何平台都能印；
// 若要中文（線種／第X格），確認 kiosk 有中文字型後把下面的 label 字串換掉即可。
async function generateLabel(job) {
  const L = job.label;
  const qr = await QRCode.toDataURL(L.pickupCode, { width: 280, margin: 1 });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="406" height="609" viewBox="0 0 406 609">
  <rect width="406" height="609" fill="#fff"/>
  <image href="${qr}" x="63" y="28" width="280" height="280"/>
  <text x="203" y="338" font-family="Arial, sans-serif" font-size="44" font-weight="bold" text-anchor="middle" fill="#000">${L.pickupCode}</text>
  <text x="203" y="386" font-family="Arial, sans-serif" font-size="28" text-anchor="middle" fill="#000">${L.model}  ${L.tension} lbs</text>
  <text x="203" y="428" font-family="Arial, sans-serif" font-size="28" text-anchor="middle" fill="#000">NT$${L.price}</text>
  <text x="203" y="478" font-family="Arial, sans-serif" font-size="32" font-weight="bold" text-anchor="middle" fill="#000">SLOT ${L.slotNo}</text>
  <text x="203" y="540" font-family="Arial, sans-serif" font-size="20" text-anchor="middle" fill="#777">${L.orderNo}</text>
  <text x="203" y="575" font-family="Arial, sans-serif" font-size="16" text-anchor="middle" fill="#777">羽拍有約 · 穿線</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function printLabel(pngBuf, job) {
  if (PRINT_MODE === 'file') {
    const file = path.join(process.cwd(), `label-${job.label.pickupCode}.png`);
    fs.writeFileSync(file, pngBuf);
    console.log(`[print] 已輸出貼紙圖檔：${file}`);
    return true;
  }
  // Windows 驅動列印：寫暫存 PNG → 呼叫系統列印（會用預設印表機）。
  // 實機若要精準對位/濃度，改接 GoDex EZ120 SDK（或 C# + .NET DLL）直接驅動。
  const tmp = path.join(os.tmpdir(), `label-${job.label.pickupCode}.png`);
  fs.writeFileSync(tmp, pngBuf);
  const { execSync } = require('child_process');
  try {
    execSync(`powershell -Command "Start-Process -FilePath '${tmp}' -Verb Print"`, { stdio: 'ignore' });
    return true;
  } catch (e) {
    console.error('[print] 列印失敗:', e.message);
    return false;
  }
}

async function markDone(job) {
  await fetch(`${BASE}/api/print-jobs/${job.id}/done`, { method: 'POST' });
}

async function loop() {
  console.log(`[poller] 開始輪詢 ${BASE}/api/print-jobs (interval=${POLL_INTERVAL}ms, mode=${PRINT_MODE})`);
  for (;;) {
    try {
      const jobs = await fetchPending();
      if (jobs.length) console.log(`[poller] 發現 ${jobs.length} 筆待印`);
      for (const job of jobs) {
        console.log(`[poller] 印 單號=${job.label.orderNo} 取件碼=${job.label.pickupCode} 格=${job.label.slotNo}`);
        const png = await generateLabel(job);
        const okPrint = await printLabel(png, job);
        if (okPrint) {
          await markDone(job);
          console.log(`[poller] ✓ 完成並回報 ${job.label.orderNo}`);
        }
      }
    } catch (e) {
      console.error('[poller] 錯誤:', e.message);
    }
    if (process.env.ONCE) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  console.log('[poller] 本輪結束');
}

loop();

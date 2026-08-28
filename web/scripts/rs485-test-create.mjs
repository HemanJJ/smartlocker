// rs485-test-create.mjs — 在生產 DB 建一筆測試「列印工作」(slot=1)，讓 kiosk poller 抓去開格
// 用法：node scripts/rs485-test-create.mjs  （讀 .env.local 的 DATABASE_URL）
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { neon } = require('@neondatabase/serverless');

const envPath = new URL('../.env.local', import.meta.url).pathname;
let dbUrl = process.env.DATABASE_URL || '';
try {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    if (line.startsWith('DATABASE_URL=')) { dbUrl = line.slice('DATABASE_URL='.length).replace(/^"|"$/g, '').trim(); break; }
  }
} catch {}
if (!dbUrl) { console.error('缺 DATABASE_URL'); process.exit(1); }
const sql = neon(dbUrl);

const slot = 1;
const orderNo = 'TEST-RS485-' + Date.now().toString().slice(-6);
const pickup = String(Math.floor(100000 + Math.random() * 900000));

// 1) 測試訂單
const o = await sql`INSERT INTO orders (order_no, string_id, color, tension, price, pickup_code, status, paid, line_user_id, customer_name, note, current_slot)
  VALUES (${orderNo}, 1, '', 24, 250, ${pickup}, 'pending', FALSE, '', '', 'RS485測試', ${slot}) RETURNING id`;
const orderId = Number(o[0].id);

// 2) 佔格
await sql`UPDATE locker_slots SET status='occupied', order_id=${orderId}, updated_at=NOW() WHERE slot_no=${slot} AND status='empty'`;

// 3) 列印工作（poller 抓這個 → Send-Unlock(slot)）
const label = { orderNo, pickupCode: pickup, model: 'AL-69', color: '', tension: 24, price: 250, slotNo: slot, note: 'RS485測試' };
const p = await sql`INSERT INTO print_jobs (order_id, label_data) VALUES (${orderId}, ${JSON.stringify(label)}) RETURNING id`;
console.log('OK order=' + orderId + ' orderNo=' + orderNo + ' slot=' + slot + ' printJob=' + Number(p[0].id));
console.log('CLEANUP=' + JSON.stringify({ orderId, slot }));

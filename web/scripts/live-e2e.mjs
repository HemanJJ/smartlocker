// 對「真實」環境跑穿線服務端到端（需要 server 已在跑 + 有效 DATABASE_URL）。
// 用法：BASE_URL=http://localhost:3100 node scripts/live-e2e.mjs
// 會建立一筆測試訂單跑完整流程，最後刪除該訂單並還原格口。

import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const { neon } = require('@neondatabase/serverless');

const BASE = process.env.BASE_URL || 'http://localhost:3100';

function loadDbUrl() {
  const envPath = new URL('../.env.local', import.meta.url).pathname;
  try {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      if (line.startsWith('DATABASE_URL=')) {
        return line.slice('DATABASE_URL='.length).replace(/^"|"$/g, '').trim();
      }
    }
  } catch {}
  return process.env.DATABASE_URL || '';
}

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${extra ? '  ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? '  ' + extra : ''}`);
  }
}

async function waitServer() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server 未就緒：' + BASE);
}

async function main() {
  await waitServer();

  console.log('── 線種（觸發真實建表＋種子）──');
  const s = await api('GET', '/api/strings');
  ok('GET /api/strings 回 11 條線種', s.data.ok && s.data.strings?.length === 11, `(got ${s.data.strings?.length})`);

  const slots0 = await api('GET', '/api/slots');
  ok('GET /api/slots 22 格且全 empty', slots0.data.ok && slots0.data.slots?.length === 22 && slots0.data.slots.every((x) => x.status === 'empty'));

  console.log('── 下單 ──');
  const c = await api('POST', '/api/orders', { stringId: 1, tension: 24, customerName: 'E2E測試' });
  ok('POST /api/orders 成功', c.data.ok && c.data.order, c.data.error ? `(${c.data.error})` : '');
  const order = c.data.order;
  if (!order) {
    console.log('無法繼續（無訂單），停止');
    process.exit(1);
  }
  console.log(`    單號=${order.orderNo} 取件碼=${order.pickupCode} 格號=${order.currentSlot}`);
  ok('狀態 pending、已分格', order.status === 'pending' && order.currentSlot != null);

  console.log('── 生命週期 ──');
  const take = await api('POST', `/api/orders/${order.id}/action`, { action: 'take' });
  ok('take → stringing、無格號', take.data.ok && take.data.order?.status === 'stringing' && take.data.order?.currentSlot === null, take.data.error ? `(${take.data.error})` : '');

  const ret = await api('POST', `/api/orders/${order.id}/action`, { action: 'return' });
  ok('return → ready、分到格', ret.data.ok && ret.data.order?.status === 'ready' && ret.data.order?.currentSlot != null, ret.data.error ? `(${ret.data.error})` : '');

  const pay = await api('POST', `/api/orders/${order.id}/action`, { action: 'pay' });
  ok('pay → paid=true', pay.data.ok && pay.data.order?.paid === true, pay.data.error ? `(${pay.data.error})` : '');

  const done = await api('POST', `/api/orders/${order.id}/action`, { action: 'complete' });
  ok('complete → done', done.data.ok && done.data.order?.status === 'done', done.data.error ? `(${done.data.error})` : '');

  const slots1 = await api('GET', '/api/slots');
  ok('完成後格口全 empty', slots1.data.ok && slots1.data.slots.every((x) => x.status === 'empty'));

  console.log('── 清理測試訂單 ──');
  const sql = neon(loadDbUrl());
  await sql`DELETE FROM orders WHERE id = ${order.id}`;
  await sql`UPDATE locker_slots SET status = 'empty', order_id = NULL WHERE order_id = ${order.id}`;
  console.log('  ✓ 已刪除測試訂單');

  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('E2E 失敗:', err.message);
  process.exit(1);
});

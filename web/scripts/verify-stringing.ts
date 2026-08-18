// 驗證穿線服務的「真實程式碼」：直接呼叫 src/lib/stringing.ts 的函式，
// 以 PGlite（WASM Postgres）當資料庫，透過 __setDbOverride 繞過 Neon 連線。
// 用法：npm i --no-save @electric-sql/pglite tsx && npx tsx scripts/verify-stringing.ts

import { PGlite } from '@electric-sql/pglite';
import { __setDbOverride } from '../src/lib/db';
import {
  ensureStringingSchema,
  listStrings,
  listSlots,
  createOrder,
  transitionOrder,
  getOrderById,
  getOrderByPickupCode,
  bindCustomer,
  listMineOrders,
} from '../src/lib/stringing';

const db = new PGlite();

// 模擬 neon() 的 tagged-template：${param} → $n，回傳 rows 陣列
__setDbOverride((strings: TemplateStringsArray, ...params: unknown[]) => {
  let text = '';
  const values: unknown[] = [];
  strings.forEach((s, i) => {
    text += s;
    if (i < params.length) {
      values.push(params[i]);
      text += `$${values.length}`;
    }
  });
  return db.query(text, values).then((r: any) => r.rows);
});

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`);
  }
}
async function throws(name: string, fn: () => Promise<unknown>, needle?: string) {
  try {
    await fn();
    failed++;
    console.log(`  ✗ ${name}（未拋出錯誤）`);
  } catch (e: any) {
    const m = String(e?.message || e);
    if (needle && !m.includes(needle)) {
      failed++;
      console.log(`  ✗ ${name}（錯誤訊息不符：${m}）`);
    } else {
      passed++;
      console.log(`  ✓ ${name}`);
    }
  }
}

async function main() {
  console.log('── schema + 種子（真實 ensureStringingSchema）──');
  await ensureStringingSchema();
  ok('線種 11 條', (await listStrings()).length === 11);
  const slots0 = await listSlots();
  ok('格口 22 格且全 empty', slots0.length === 22 && slots0.every((s) => s.status === 'empty'));

  console.log('── createOrder（真實函式）──');
  const order = await createOrder({ stringId: 1, tension: 24, customerName: '測試客人' });
  ok('取件碼為 6 位數字', /^\d{6}$/.test(order.pickupCode));
  ok('單號開頭 S-', order.orderNo.startsWith('S-'));
  ok('狀態 pending', order.status === 'pending');
  ok('費用 = 線種價 250', order.price === 250);
  ok('線種型號 AL-69', order.stringModel === 'AL-69');
  ok('分到格口 1', order.currentSlot === 1);

  let slots = await listSlots();
  ok('格口 1 occupied', slots.find((s) => s.slotNo === 1)?.status === 'occupied');

  console.log('── 生命週期（真實 transitionOrder）──');
  await transitionOrder(order.id, 'take');
  let o = await getOrderById(order.id);
  slots = await listSlots();
  ok('take → stringing、無格號', o!.status === 'stringing' && o!.currentSlot === null);
  ok('take 後格口釋放', slots.every((s) => s.status === 'empty'));

  await transitionOrder(order.id, 'return');
  o = await getOrderById(order.id);
  slots = await listSlots();
  ok('return → ready、分到格口', o!.status === 'ready' && o!.currentSlot != null);
  ok('return 後有 1 格 occupied', slots.filter((s) => s.status === 'occupied').length === 1);

  await transitionOrder(order.id, 'pay');
  o = await getOrderById(order.id);
  ok('pay → paid = true', o!.paid === true);

  await transitionOrder(order.id, 'complete');
  o = await getOrderById(order.id);
  slots = await listSlots();
  ok('complete → done、completed_at 已填', o!.status === 'done' && o!.completedAt != null);
  ok('complete 後格口釋放', slots.every((s) => s.status === 'empty'));

  console.log('── 查詢與綁定 ──');
  const byCode = await getOrderByPickupCode(order.pickupCode);
  ok('getOrderByPickupCode 找到單', byCode?.id === order.id && byCode?.stringModel === 'AL-69');

  const bind1 = await bindCustomer(order.pickupCode, 'userA');
  ok('首次綁定 boundNow = true', bind1.boundNow === true);
  const bind2 = await bindCustomer(order.pickupCode, 'userA');
  ok('重複綁定同一人 boundNow = false', bind2.boundNow === false && bind2.alreadyBoundOther === false);
  const bind3 = await bindCustomer(order.pickupCode, 'userB');
  ok('他人綁定 alreadyBoundOther = true', bind3.alreadyBoundOther === true);
  ok('listMineOrders(userA) = 1 筆', (await listMineOrders('userA')).length === 1);

  console.log('── 錯誤路徑 ──');
  await throws('線種不存在 → 拋錯', () => createOrder({ stringId: 999, tension: 24 }), '線種不存在');
  await throws('磅數超上限 → 拋錯', () => createOrder({ stringId: 1, tension: 99 }), '磅數上限');
  await throws('對 done 訂單 take → 拋錯', () => transitionOrder(order.id, 'take'), '待收件');
  await throws('未知操作 → 拋錯', () => transitionOrder(order.id, 'bogus'), '未知操作');

  console.log(`\n結果：${passed} 通過 / ${failed} 失敗`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('驗證失敗:', err);
  process.exit(1);
});

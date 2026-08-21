// 同步商品目錄（依王清標提供 venue_faq.txt）＋進銷存欄位（cost_price / min_qty）
// 用法：DATABASE_URL=<neon> node scripts/sync-catalog.mjs
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url || !url.startsWith('postgres')) {
  console.error('❌ 請設 DATABASE_URL（Neon）');
  process.exit(1);
}
const sql = neon(url);

await sql`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS cost_price INTEGER NOT NULL DEFAULT 0`;
await sql`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS min_qty INTEGER NOT NULL DEFAULT 0`;

// sku, name, category, price, qty, min_qty
const CATALOG = [
  ['DEFI-BALL-12', 'DEFI 比賽球（一桶 12 入）', 'badminton', 500, 10, 5],
  ['STRING-070', '拍線 0.70mm（只買線）', 'badminton', 80, 20, 10],
  ['STRING-066', '拍線 0.66–0.68mm（只買線）', 'badminton', 100, 20, 10],
  ['STRING-061', '拍線 0.61–0.65mm（只買線）', 'badminton', 150, 15, 10],
  ['GRIP-1', '握把布', 'badminton', 50, 20, 10],
  ['RAMEN-C', '碗裝泡麵（經典）', 'ramen', 65, 10, 8],
  ['RAMEN-S', '碗裝泡麵（辣味）', 'ramen', 70, 10, 8],
  ['RAMEN-CUP', '杯麵', 'ramen', 50, 8, 6],
  ['SNACK-1', '零食', 'other', 30, 6, 5],
  ['FIRSTAID-1', 'OK 繃 / 肌貼', 'other', 80, 3, 2],
  // 註：礦泉水不下架販售（館內黑松販賣機是另一家，2026-08-21 決定）
];

await sql`DELETE FROM inventory`;
for (const [sku, name, category, price, qty, minQty] of CATALOG) {
  await sql`
    INSERT INTO inventory (sku, name, category, price, cost_price, min_qty, qty, cabinet_id, slot_no, status)
    VALUES (${sku}, ${name}, ${category}, ${price}, 0, ${minQty}, ${qty}, 'df-f', 0, 'on_shelf')
  `;
}
console.log(`✅ 目錄已同步：${CATALOG.length} 個商品（cost=0、安全存量已設）`);

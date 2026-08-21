// 王清標商品 假設性測試資料（每項 100 個、789 折三階、全上架 kiosk）
// 價錢來源：venue_faq.txt（王清標提供）＋ 網路均價（2026-08 台灣零售）
// 用法：DATABASE_URL=<neon> node scripts/seed-mall-test.mjs
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url || !url.startsWith('postgres')) { console.error('❌ 請設 DATABASE_URL'); process.exit(1); }
const sql = neon(url);

// sku, name, category, price, 價錢來源
const CATALOG = [
  ['DEFI-BALL-12', 'DEFI 比賽球（一桶 12 入）', 'badminton', 500, 'FAQ：一桶 500 元起'],
  ['STRING-070', '拍線 0.70mm（只買線）', 'badminton', 80, 'FAQ：每條 80 元起'],
  ['STRING-066', '拍線 0.66–0.68mm（只買線）', 'badminton', 100, 'FAQ：每條 100 元起'],
  ['STRING-061', '拍線 0.61–0.65mm（只買線）', 'badminton', 150, 'FAQ：每條 150 元起'],
  ['GRIP-1', '握把布', 'badminton', 60, '網路均價（VICTOR/YONEX 單條 50–100）'],
  ['RACKET-1', '球拍（新手款）', 'badminton', 1500, 'FAQ：1000–3000 取中價'],
  ['SHOE-1', '羽球鞋', 'badminton', 1800, 'FAQ：約 1800 元'],
  ['BAG-1', '球袋', 'badminton', 1200, 'FAQ：800–1800 取中價'],
  ['KNEE-1', '護膝', 'badminton', 500, '網路均價（LP/Mueller/adidas 300–800）'],
  ['SOCK-1', '羽球襪', 'badminton', 180, '網路均價（YONEX/Mizuno 120–250）'],
  ['RAMEN-C', '碗裝泡麵（經典）', 'ramen', 65, '既有定價'],
  ['RAMEN-S', '碗裝泡麵（辣味）', 'ramen', 70, '既有定價'],
  ['RAMEN-CUP', '杯麵', 'ramen', 50, '既有定價'],
  ['FIRSTAID-1', 'OK 繃 / 肌貼', 'other', 80, '既有定價'],
  ['SNACK-1', '零食', 'other', 30, '既有定價'],
];

// 789 折三階（滿 50→9折、滿 100→8折、滿 200→7折）
const TIERS = [
  [50, 90], [100, 80], [200, 70],
];

// 1) 庫存：全換成王清標商品，每項 100 個、全上架、成本待談（0）
await sql`DELETE FROM inventory`;
for (const [sku, name, category, price, src] of CATALOG) {
  await sql`
    INSERT INTO inventory (sku, name, category, price, cost_price, min_qty, qty, cabinet_id, slot_no, status)
    VALUES (${sku}, ${name}, ${category}, ${price}, 0, 10, 100, 'df-f', 0, 'on_shelf')
  `;
}

// 2) 量價階梯：全部商品 789 折三階
await sql`DELETE FROM price_tiers`;
for (const [sku] of CATALOG) {
  for (const [minQty, percent] of TIERS) {
    await sql`INSERT INTO price_tiers (sku, min_qty, tier_type, percent) VALUES (${sku}, ${minQty}, 'percent', ${percent})`;
  }
}

console.log(`✅ 王清標商品測試資料已建立：${CATALOG.length} 項 × 100 個、全上架、每項 789 折三階`);
CATALOG.forEach(([, name, , price, src]) => console.log(`  ${name.padEnd(16)} NT$${String(price).padStart(4)}  (${src})`));

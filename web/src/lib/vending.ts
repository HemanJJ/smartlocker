import { getDb } from './db';

// ── 販售（自動販售＋泡麵 24h）資料模型 ──────────────────────────
// 規格：smartlocker/docs/規格-販售與泡麵24h.md（Phase 1）
// 與穿線共用同一個 Neon 庫：這裡只 CREATE TABLE，絕不動既有表。

export type VendingCategory = 'badminton' | 'ramen' | 'other';

export interface CatalogItem {
  sku: string;
  name: string;
  category: VendingCategory;
  price: number;
  costPrice: number;
  minQty: number;
  qty: number;
  status: string;
  cabinetId: string;
  slotNo: number;
  expiryDate: string | null;
}

export interface InventoryInput {
  sku: string;
  name: string;
  category: VendingCategory;
  price: number;
  costPrice?: number;
  minQty?: number;
  qty: number;
  status?: string;
  cabinetId?: string;
  slotNo?: number;
  expiryDate?: string | null;
}

let ensurePromise: Promise<void> | null = null;

export function ensureVendingSchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const sql = getDb();

      // 販售庫存（一 SKU 一列；格口綁定在 cabinet_id + slot_no）
      await sql`
        CREATE TABLE IF NOT EXISTS inventory (
          id SERIAL PRIMARY KEY,
          venue_id INTEGER NOT NULL DEFAULT 1,
          cabinet_id VARCHAR(10) NOT NULL DEFAULT 'df-f',
          slot_no INTEGER NOT NULL DEFAULT 0,
          sku VARCHAR(40) NOT NULL UNIQUE,
          name VARCHAR(100) NOT NULL,
          category VARCHAR(20) NOT NULL DEFAULT 'other',
          price INTEGER NOT NULL DEFAULT 0,
          cost_price INTEGER NOT NULL DEFAULT 0,
          qty INTEGER NOT NULL DEFAULT 0,
          expiry_date DATE,
          status VARCHAR(10) NOT NULL DEFAULT 'on_shelf',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      // 進銷存地基：成本價（毛利 = price − cost_price）
      await sql`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS cost_price INTEGER NOT NULL DEFAULT 0`;

      // 安全存量（低於此值 LINE 提醒補貨；進銷存也用）
      await sql`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS min_qty INTEGER NOT NULL DEFAULT 0`;

      // 多店：唯一鍵從 (sku) 改為 (venue_id, sku)，各分店各自有貨
      await sql`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_sku_key' AND conrelid = 'inventory'::regclass) THEN
            ALTER TABLE inventory DROP CONSTRAINT inventory_sku_key;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_venue_sku_key' AND conrelid = 'inventory'::regclass) THEN
            ALTER TABLE inventory ADD CONSTRAINT inventory_venue_sku_key UNIQUE (venue_id, sku);
          END IF;
        END $$;
      `;

      // 販售訂單（Phase 2 金流開通後使用）
      await sql`
        CREATE TABLE IF NOT EXISTS sale_orders (
          id SERIAL PRIMARY KEY,
          order_no VARCHAR(30) NOT NULL UNIQUE,
          venue_id INTEGER NOT NULL DEFAULT 1,
          cabinet_id VARCHAR(10) NOT NULL DEFAULT '',
          slot_no INTEGER NOT NULL DEFAULT 0,
          sku VARCHAR(40) NOT NULL DEFAULT '',
          name VARCHAR(100) NOT NULL DEFAULT '',
          qty INTEGER NOT NULL DEFAULT 1,
          unit_price INTEGER NOT NULL DEFAULT 0,
          amount INTEGER NOT NULL DEFAULT 0,
          pay_status VARCHAR(20) NOT NULL DEFAULT 'pending_payment',
          open_status VARCHAR(20) NOT NULL DEFAULT 'pending',
          line_user_id VARCHAR(255) NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`CREATE INDEX IF NOT EXISTS idx_inventory_status ON inventory(status)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory(category)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_sale_orders_pay ON sale_orders(pay_status)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_sale_orders_created ON sale_orders(created_at)`;

      await seedVendingCatalogIfEmpty();
      console.log('[Vending] Schema initialized');
    })();
  }
  return ensurePromise;
}

// ── 起始目錄（依王清標提供：羽球館CRM/venue_faq.txt） ──
// cost_price=0 待進貨時填（進銷存 Phase 1b）；qty 只是起始值。

const STARTER_CATALOG: [sku: string, name: string, category: VendingCategory, price: number, qty: number][] = [
  ['DEFI-BALL-12', 'DEFI 比賽球（一桶 12 入）', 'badminton', 500, 10],
  ['STRING-070', '拍線 0.70mm（只買線）', 'badminton', 80, 20],
  ['STRING-066', '拍線 0.66–0.68mm（只買線）', 'badminton', 100, 20],
  ['STRING-061', '拍線 0.61–0.65mm（只買線）', 'badminton', 150, 15],
  ['GRIP-1', '握把布（定價待確認）', 'badminton', 60, 20],
  ['RAMEN-C', '碗裝泡麵（經典）', 'ramen', 65, 10],
  ['RAMEN-S', '碗裝泡麵（辣味）', 'ramen', 70, 10],
  ['RAMEN-CUP', '杯麵', 'ramen', 50, 8],
  ['WATER-1', '礦泉水', 'other', 20, 12],
  ['SNACK-1', '零食', 'other', 30, 6],
  ['FIRSTAID-1', 'OK 繃 / 肌貼', 'other', 80, 3],
];

async function seedVendingCatalogIfEmpty() {
  const sql = getDb();
  const rows = await sql`SELECT COUNT(*)::int AS n FROM inventory`;
  if (rows[0].n > 0) return;
  for (const [sku, name, category, price, qty] of STARTER_CATALOG) {
    await sql`
      INSERT INTO inventory (sku, name, category, price, qty, cabinet_id, slot_no)
      VALUES (${sku}, ${name}, ${category}, ${price}, ${qty}, 'df-f', 0)
      ON CONFLICT (venue_id, sku) DO NOTHING
    `;
  }
}

// ── 讀取 ──

/** 前台目錄：只回上架中的商品 */
export async function listCatalog(venueId = 1): Promise<CatalogItem[]> {
  const sql = getDb();
  await ensureVendingSchema();
  const rows = await sql`
    SELECT sku, name, category, price, cost_price, min_qty, qty, status, cabinet_id, slot_no,
           to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date
    FROM inventory
    WHERE status = 'on_shelf' AND venue_id = ${venueId}
    ORDER BY category, id
  `;
  return rows.map(mapRow);
}

/** 後台：全部（含下架） */
export async function listAllInventory(venueId = 1): Promise<CatalogItem[]> {
  const sql = getDb();
  await ensureVendingSchema();
  const rows = await sql`
    SELECT sku, name, category, price, cost_price, min_qty, qty, status, cabinet_id, slot_no,
           to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date
    FROM inventory
    WHERE venue_id = ${venueId}
    ORDER BY status, category, id
  `;
  return rows.map(mapRow);
}

function mapRow(r: any): CatalogItem {
  return {
    sku: r.sku,
    name: r.name,
    category: r.category as VendingCategory,
    price: r.price,
    costPrice: r.cost_price,
    minQty: r.min_qty,
    qty: r.qty,
    status: r.status,
    cabinetId: r.cabinet_id,
    slotNo: r.slot_no,
    expiryDate: r.expiry_date,
  };
}

// ── 寫入（後台） ──

export async function upsertInventory(input: InventoryInput, venueId = 1) {
  const sql = getDb();
  await ensureVendingSchema();
  const status = input.status ?? 'on_shelf';
  const cabinetId = input.cabinetId ?? 'df-f';
  const slotNo = input.slotNo ?? 0;
  const expiry = input.expiryDate || null;
  await sql`
    INSERT INTO inventory (venue_id, sku, name, category, price, cost_price, min_qty, qty, status, cabinet_id, slot_no, expiry_date, updated_at)
    VALUES (${venueId}, ${input.sku}, ${input.name}, ${input.category}, ${input.price}, ${input.costPrice ?? 0}, ${input.minQty ?? 0}, ${input.qty}, ${status}, ${cabinetId}, ${slotNo}, ${expiry}, NOW())
    ON CONFLICT (venue_id, sku) DO UPDATE SET
      name = EXCLUDED.name,
      category = EXCLUDED.category,
      price = EXCLUDED.price,
      cost_price = EXCLUDED.cost_price,
      min_qty = EXCLUDED.min_qty,
      qty = EXCLUDED.qty,
      status = EXCLUDED.status,
      cabinet_id = EXCLUDED.cabinet_id,
      slot_no = EXCLUDED.slot_no,
      expiry_date = EXCLUDED.expiry_date,
      updated_at = NOW()
  `;
}

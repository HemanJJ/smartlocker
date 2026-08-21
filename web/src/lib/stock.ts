import { getDb } from './db';
import { pushMessage } from './line';

// ── 老闆版簡易進銷存（5 家連鎖用） ──────────────────────────
// 供應商（預留 LINE 窗口）＋進貨單＋盤點＋安全存量＋LINE 通知
// 規格：smartlocker/docs/規格-販售與泡麵24h.md

let ensurePromise: Promise<void> | null = null;

export function ensureStockSchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const sql = getDb();

      // 安全存量（庫存表加欄位；min_qty=0 表示不預警）
      await sql`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS min_qty INTEGER NOT NULL DEFAULT 0`;

      // 供應商（line_id 預留：以後設好 ID 就能一鍵轉訂單）
      await sql`
        CREATE TABLE IF NOT EXISTS suppliers (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          line_id VARCHAR(100) NOT NULL DEFAULT '',
          phone VARCHAR(30) NOT NULL DEFAULT '',
          note VARCHAR(255) NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      // 進貨單
      await sql`
        CREATE TABLE IF NOT EXISTS purchase_orders (
          id SERIAL PRIMARY KEY,
          order_no VARCHAR(30) NOT NULL UNIQUE,
          venue_id INTEGER NOT NULL DEFAULT 1,
          supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
          status VARCHAR(10) NOT NULL DEFAULT 'draft',
          total_cost INTEGER NOT NULL DEFAULT 0,
          note VARCHAR(255) NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          received_at TIMESTAMPTZ
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS purchase_items (
          id SERIAL PRIMARY KEY,
          order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
          sku VARCHAR(40) NOT NULL,
          name VARCHAR(100) NOT NULL,
          qty INTEGER NOT NULL DEFAULT 0,
          unit_cost INTEGER NOT NULL DEFAULT 0
        )
      `;

      // 盤點
      await sql`
        CREATE TABLE IF NOT EXISTS stocktakes (
          id SERIAL PRIMARY KEY,
          venue_id INTEGER NOT NULL DEFAULT 1,
          note VARCHAR(255) NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS stocktake_items (
          id SERIAL PRIMARY KEY,
          stocktake_id INTEGER NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
          sku VARCHAR(40) NOT NULL,
          name VARCHAR(100) NOT NULL,
          system_qty INTEGER NOT NULL DEFAULT 0,
          actual_qty INTEGER NOT NULL DEFAULT 0
        )
      `;

      // 配貨單（總倉 → 店家，內部移動；draft→approved 才動庫存）
      await sql`
        CREATE TABLE IF NOT EXISTS transfers (
          id SERIAL PRIMARY KEY,
          from_venue_id INTEGER NOT NULL,
          to_venue_id INTEGER NOT NULL,
          note VARCHAR(255) NOT NULL DEFAULT '',
          status VARCHAR(10) NOT NULL DEFAULT 'approved',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          approved_at TIMESTAMPTZ
        )
      `;
      await sql`ALTER TABLE transfers ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'approved'`;
      await sql`ALTER TABLE transfers ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`;
      await sql`
        CREATE TABLE IF NOT EXISTS transfer_items (
          id SERIAL PRIMARY KEY,
          transfer_id INTEGER NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
          sku VARCHAR(40) NOT NULL,
          name VARCHAR(100) NOT NULL,
          qty INTEGER NOT NULL,
          unit_cost INTEGER NOT NULL DEFAULT 0
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_transfers_created ON transfers(created_at)`;

      await sql`CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_po_venue ON purchase_orders(venue_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_stocktakes_venue ON stocktakes(venue_id)`;

      // 量價階梯（盤商模式：談的底價→零售價→滿量打折；後台動態可編輯）
      await sql`
        CREATE TABLE IF NOT EXISTS price_tiers (
          id SERIAL PRIMARY KEY,
          sku VARCHAR(40) NOT NULL,
          min_qty INTEGER NOT NULL,
          tier_type VARCHAR(10) NOT NULL DEFAULT 'percent',
          percent INTEGER,
          unit_price INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (sku, min_qty)
        )
      `;
      await seedPriceTiersIfEmpty();
    })();
  }
  return ensurePromise;
}

// ── 量價階梯 ──

async function seedPriceTiersIfEmpty() {
  const sql = getDb();
  const rows = await sql`SELECT COUNT(*)::int AS n FROM price_tiers`;
  if (rows[0].n > 0) return;
  await sql`INSERT INTO price_tiers (sku, min_qty, tier_type, percent) VALUES ('DEFI-BALL-12', 50, 'percent', 80)`;
  await sql`INSERT INTO price_tiers (sku, min_qty, tier_type, percent) VALUES ('DEFI-BALL-12', 100, 'percent', 70)`;
  console.log('[Stock] 量價階梯種子已放（DEFI 球：滿50件8折/滿100件7折）');
}

export async function listPriceTiers(): Promise<any[]> {
  const sql = getDb();
  await ensureStockSchema();
  const rows = await sql`SELECT id, sku, min_qty, tier_type, percent, unit_price FROM price_tiers ORDER BY sku, min_qty`;
  return rows.map((r: any) => ({
    id: r.id,
    sku: r.sku,
    minQty: r.min_qty,
    tierType: r.tier_type,
    percent: r.percent,
    unitPrice: r.unit_price,
  }));
}

/** 新增/更新階梯；applyTo: single（預設）/ category / all（批次套用） */
export async function upsertPriceTier(input: {
  sku: string;
  minQty: number;
  tierType: 'percent' | 'unit_price';
  percent?: number;
  unitPrice?: number;
  applyTo?: 'single' | 'category' | 'all';
  category?: string;
}) {
  const sql = getDb();
  await ensureStockSchema();
  if (input.applyTo === 'single' && !input.sku) throw new Error('請填 SKU（或改用批次套用）');
  if (input.minQty < 1) throw new Error('門檻數量必填');
  if (input.tierType === 'percent') {
    if (!input.percent || input.percent < 1 || input.percent > 99) throw new Error('折數要 1~99');
  } else {
    if (!input.unitPrice || input.unitPrice < 1) throw new Error('單價必填');
  }

  // 決定要套用到哪些 SKU
  let skus: string[] = [];
  if (input.applyTo === 'all') {
    const rows = await sql`SELECT sku FROM inventory WHERE status = 'on_shelf'`;
    skus = rows.map((r: any) => r.sku);
  } else if (input.applyTo === 'category') {
    const rows = await sql`SELECT sku FROM inventory WHERE category = ${input.category ?? 'other'} AND status = 'on_shelf'`;
    skus = rows.map((r: any) => r.sku);
  } else {
    skus = [input.sku];
  }
  if (skus.length === 0) throw new Error('沒有可套用的商品');

  for (const sku of skus) {
    await sql`
      INSERT INTO price_tiers (sku, min_qty, tier_type, percent, unit_price)
      VALUES (${sku}, ${input.minQty}, ${input.tierType}, ${input.percent ?? null}, ${input.unitPrice ?? null})
      ON CONFLICT (sku, min_qty) DO UPDATE SET
        tier_type = EXCLUDED.tier_type,
        percent = EXCLUDED.percent,
        unit_price = EXCLUDED.unit_price
    `;
  }
  return { applied: skus.length };
}

export async function deletePriceTier(id: number) {
  const sql = getDb();
  await ensureStockSchema();
  if (!id) throw new Error('缺階梯 id');
  await sql`DELETE FROM price_tiers WHERE id = ${id}`;
}

// ── 配貨到店（總倉 → 店家） ──

export async function createTransfer(input: {
  fromVenueId: number;
  toVenueId: number;
  note?: string;
  items: { sku: string; name: string; qty: number }[];
}) {
  const sql = getDb();
  await ensureStockSchema();
  if (input.fromVenueId === input.toVenueId) throw new Error('不能配給自己');
  const items = input.items.filter((i) => i.qty > 0 && i.sku);
  if (items.length === 0) throw new Error('至少一筆商品');

  // 檢查來源夠不夠 + 抓來源的價格/成本
  const shortages: string[] = [];
  for (const it of items) {
    const src = await sql`SELECT qty FROM inventory WHERE venue_id = ${input.fromVenueId} AND sku = ${it.sku}`;
    const have = src.length ? src[0].qty : 0;
    if (have < it.qty) shortages.push(`${it.name}（有 ${have}，要 ${it.qty}）`);
  }
  if (shortages.length) throw new Error(`庫存不足：${shortages.join('、')}`);

  const res = await sql`
    INSERT INTO transfers (from_venue_id, to_venue_id, note, status)
    VALUES (${input.fromVenueId}, ${input.toVenueId}, ${input.note ?? ''}, 'draft')
    RETURNING id
  `;
  const transferId = res[0].id;

  for (const it of items) {
    const src = await sql`SELECT name, price, cost_price, min_qty FROM inventory WHERE venue_id = ${input.fromVenueId} AND sku = ${it.sku}`;
    const s0 = src.length ? src[0] : { name: it.name, price: 0, cost_price: 0, min_qty: 0 };
    await sql`INSERT INTO transfer_items (transfer_id, sku, name, qty, unit_cost) VALUES (${transferId}, ${it.sku}, ${s0.name}, ${it.qty}, ${s0.cost_price})`;
  }
  return { id: transferId, moved: items.length, status: 'draft' };
}

/** 核准配貨：才動庫存（來源−、目的+）＋記錄＋LINE 通知 */
export async function approveTransfer(transferId: number): Promise<{ ok: boolean; error?: string }> {
  const sql = getDb();
  await ensureStockSchema();
  const rows = await sql`SELECT id, status, from_venue_id, to_venue_id FROM transfers WHERE id = ${transferId}`;
  if (rows.length === 0) return { ok: false, error: '找不到配貨單' };
  if (rows[0].status === 'approved') return { ok: false, error: '已核准過了' };
  if (rows[0].status === 'rejected') return { ok: false, error: '已退回的單不能核准' };
  const { from_venue_id: fromVenue, to_venue_id: toVenue } = rows[0];
  const items = await sql`SELECT sku, name, qty FROM transfer_items WHERE transfer_id = ${transferId}`;

  // 核准前再次驗證庫存夠不夠
  const shortages: string[] = [];
  for (const it of items) {
    const src = await sql`SELECT qty FROM inventory WHERE venue_id = ${fromVenue} AND sku = ${it.sku}`;
    const have = src.length ? src[0].qty : 0;
    if (have < it.qty) shortages.push(`${it.name}（有 ${have}，要 ${it.qty}）`);
  }
  if (shortages.length) return { ok: false, error: `庫存不足，請退回調整：${shortages.join('、')}` };

  for (const it of items) {
    const src = await sql`SELECT name, category, price, cost_price, min_qty FROM inventory WHERE venue_id = ${fromVenue} AND sku = ${it.sku}`;
    const s0 = src[0];
    await sql`UPDATE inventory SET qty = qty - ${it.qty}, updated_at = NOW() WHERE venue_id = ${fromVenue} AND sku = ${it.sku}`;
    await sql`
      INSERT INTO inventory (venue_id, sku, name, category, price, cost_price, min_qty, qty, cabinet_id, slot_no, status)
      VALUES (${toVenue}, ${it.sku}, ${s0.name}, ${s0.category}, ${s0.price}, ${s0.cost_price}, ${s0.min_qty}, ${it.qty}, 'df-f', 0, 'on_shelf')
      ON CONFLICT (venue_id, sku) DO UPDATE SET
        qty = inventory.qty + EXCLUDED.qty,
        cost_price = EXCLUDED.cost_price,
        price = EXCLUDED.price,
        updated_at = NOW()
    `;
  }
  await sql`UPDATE transfers SET status = 'approved', approved_at = NOW() WHERE id = ${transferId}`;

  // LINE 通知「完成配送」
  const raw = process.env.STAFF_LINE_USER_ID || process.env.STAFF_LINE_USER_IDS || '';
  const admins = raw.split(',').map((x) => x.trim()).filter(Boolean);
  const f = await sql`SELECT name FROM venues WHERE id = ${fromVenue}`;
  const t = await sql`SELECT name FROM venues WHERE id = ${toVenue}`;
  const text = [
    '✅ 配貨已核准・完成配送',
    `${f[0]?.name} → ${t[0]?.name}`,
    ...items.map((i: any) => `• ${i.name} ×${i.qty}`),
  ].join('\n');
  for (const admin of admins) await pushMessage(admin, [{ type: 'text', text }]);
  return { ok: true };
}

/** 退回配貨單 */
export async function rejectTransfer(transferId: number) {
  const sql = getDb();
  await ensureStockSchema();
  const rows = await sql`SELECT id, status FROM transfers WHERE id = ${transferId}`;
  if (rows.length === 0) throw new Error('找不到配貨單');
  if (rows[0].status !== 'draft') throw new Error('只能退回草稿單');
  await sql`UPDATE transfers SET status = 'rejected' WHERE id = ${transferId}`;
}

/** 草稿單改數量 */
export async function updateTransferItems(transferId: number, items: { id: number; qty: number }[]) {
  const sql = getDb();
  await ensureStockSchema();
  const rows = await sql`SELECT id, status FROM transfers WHERE id = ${transferId}`;
  if (rows.length === 0) throw new Error('找不到配貨單');
  if (rows[0].status !== 'draft') throw new Error('只有草稿單能改數量');
  for (const it of items) {
    if (it.qty < 1) throw new Error('數量至少 1');
    await sql`UPDATE transfer_items SET qty = ${it.qty} WHERE id = ${it.id} AND transfer_id = ${transferId}`;
  }
}

/** 需求單：低於安全存量 → 建議補貨量 = 安全×2 − 目前 */
export async function getReplenishmentNeeds(venueId: number): Promise<any[]> {
  const sql = getDb();
  await ensureStockSchema();
  const rows = await sql`
    SELECT sku, name, qty, min_qty FROM inventory
    WHERE venue_id = ${venueId} AND status = 'on_shelf' AND min_qty > 0 AND qty <= min_qty
    ORDER BY qty
  `;
  return rows.map((r: any) => ({
    sku: r.sku,
    name: r.name,
    qty: r.qty,
    minQty: r.min_qty,
    suggestQty: Math.max(1, r.min_qty * 2 - r.qty),
  }));
}

export async function listTransfers(): Promise<any[]> {
  const sql = getDb();
  await ensureStockSchema();
  const rows = await sql`
    SELECT t.id, t.from_venue_id, t.to_venue_id, t.note, t.status, t.created_at, t.approved_at,
           f.name AS from_name, t2.name AS to_name
    FROM transfers t
    LEFT JOIN venues f ON f.id = t.from_venue_id
    LEFT JOIN venues t2 ON t2.id = t.to_venue_id
    ORDER BY t.id DESC LIMIT 100
  `;
  for (const r of rows) {
    r.items = await sql`SELECT id, sku, name, qty, unit_cost FROM transfer_items WHERE transfer_id = ${r.id}`;
  }
  return rows;
}

// ── 供應商 ──

export async function listSuppliers(): Promise<any[]> {
  const sql = getDb();
  await ensureStockSchema();
  const rows = await sql`SELECT id, name, line_id, phone, note FROM suppliers ORDER BY id`;
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    lineId: r.line_id,
    phone: r.phone,
    note: r.note,
  }));
}

export async function upsertSupplier(input: { id?: number; name: string; lineId?: string; phone?: string; note?: string }) {
  const sql = getDb();
  await ensureStockSchema();
  const name = input.name.trim();
  if (!name) throw new Error('供應商名稱必填');
  if (input.id) {
    await sql`
      UPDATE suppliers SET name = ${name}, line_id = ${input.lineId ?? ''},
        phone = ${input.phone ?? ''}, note = ${input.note ?? ''} WHERE id = ${input.id}
    `;
  } else {
    await sql`
      INSERT INTO suppliers (name, line_id, phone, note)
      VALUES (${name}, ${input.lineId ?? ''}, ${input.phone ?? ''}, ${input.note ?? ''})
    `;
  }
}

// ── 安全存量檢查 ＋ LINE 通知 ──

export interface LowStockItem {
  sku: string;
  name: string;
  qty: number;
  minQty: number;
}

export async function listLowStock(venueId = 1): Promise<LowStockItem[]> {
  const sql = getDb();
  await ensureStockSchema();
  const rows = await sql`
    SELECT sku, name, qty, min_qty FROM inventory
    WHERE venue_id = ${venueId} AND min_qty > 0 AND qty <= min_qty AND status = 'on_shelf'
    ORDER BY qty
  `;
  return rows.map((r: any) => ({ sku: r.sku, name: r.name, qty: r.qty, minQty: r.min_qty }));
}

/** 低庫存 → 推 LINE 給老闆（STAFF_LINE_USER_ID）。回傳通知幾筆＋錯誤資訊。 */
export async function notifyLowStock(venueId = 1): Promise<{ notified: number; error?: string }> {
  const low = await listLowStock(venueId);
  if (low.length === 0) return { notified: 0 };
  const lines = low.map((i) => `• ${i.name}：剩 ${i.qty}（安全 ${i.minQty}）`);
  const text = [
    '⚠️ 安全存量提醒（太平店）',
    ...lines,
    '',
    '後台 → 進貨單 可一鍵帶入補貨',
  ].join('\n');
  const raw = process.env.STAFF_LINE_USER_ID || process.env.STAFF_LINE_USER_IDS || '';
  const admins = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (admins.length === 0) {
    return { notified: 0, error: '沒有 STAFF_LINE_USER_ID' };
  }
  let pushedAny = false;
  for (const admin of admins) {
    const ok = await pushMessage(admin, [{ type: 'text', text }]);
    if (ok) pushedAny = true;
  }
  return pushedAny ? { notified: low.length } : { notified: 0, error: 'LINE 推播失敗（見 Vercel log）' };
}

// ── 進貨單 ──

export async function createPurchaseOrder(input: {
  venueId?: number;
  supplierId: number;
  note?: string;
  items: { sku: string; name: string; qty: number; unitCost: number }[];
}) {
  const sql = getDb();
  await ensureStockSchema();
  if (!input.supplierId) throw new Error('請選供應商');
  const items = input.items.filter((i) => i.qty > 0);
  if (items.length === 0) throw new Error('至少一筆商品');
  const total = items.reduce((s, i) => s + i.qty * i.unitCost, 0);
  const orderNo = `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 9000 + 1000)}`;
  const res = await sql`
    INSERT INTO purchase_orders (order_no, venue_id, supplier_id, status, total_cost, note)
    VALUES (${orderNo}, ${input.venueId ?? 1}, ${input.supplierId}, 'draft', ${total}, ${input.note ?? ''})
    RETURNING id
  `;
  const orderId = res[0].id;
  for (const it of items) {
    await sql`
      INSERT INTO purchase_items (order_id, sku, name, qty, unit_cost)
      VALUES (${orderId}, ${it.sku}, ${it.name}, ${it.qty}, ${it.unitCost})
    `;
  }
  return { id: orderId, orderNo };
}

export async function listPurchaseOrders(venueId?: number): Promise<any[]> {
  const sql = getDb();
  await ensureStockSchema();
  const rows = venueId
    ? await sql`
        SELECT po.id, po.order_no, po.venue_id, po.supplier_id, s.name AS supplier_name,
               po.status, po.total_cost, po.note, po.created_at, po.received_at
        FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.venue_id = ${venueId}
        ORDER BY po.id DESC LIMIT 100
      `
    : await sql`
        SELECT po.id, po.order_no, po.venue_id, po.supplier_id, s.name AS supplier_name,
               po.status, po.total_cost, po.note, po.created_at, po.received_at
        FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
        ORDER BY po.id DESC LIMIT 100
      `;
  for (const r of rows) {
    r.items = await sql`SELECT sku, name, qty, unit_cost FROM purchase_items WHERE order_id = ${r.id}`;
  }
  return rows;
}

/** 入庫：庫存 += qty、成本更新、狀態 received，然後檢查安全存量通知 */
export async function receivePurchaseOrder(orderId: number) {
  const sql = getDb();
  await ensureStockSchema();
  const rows = await sql`SELECT id, status, venue_id FROM purchase_orders WHERE id = ${orderId}`;
  if (rows.length === 0) throw new Error('找不到進貨單');
  if (rows[0].status === 'received') throw new Error('已入庫過了');
  const venueId = rows[0].venue_id;
  const items = await sql`SELECT sku, name, qty, unit_cost FROM purchase_items WHERE order_id = ${orderId}`;
  for (const it of items) {
    await sql`
      INSERT INTO inventory (venue_id, sku, name, category, price, cost_price, qty, cabinet_id, slot_no, status)
      VALUES (${venueId}, ${it.sku}, ${it.name}, 'other', 0, ${it.unit_cost}, ${it.qty}, 'df-f', 0, 'off_shelf')
      ON CONFLICT (venue_id, sku) DO UPDATE SET
        qty = inventory.qty + EXCLUDED.qty,
        cost_price = EXCLUDED.cost_price,
        updated_at = NOW()
    `;
  }
  await sql`
    UPDATE purchase_orders SET status = 'received', received_at = NOW()
    WHERE id = ${orderId}
  `;
  await notifyLowStock(venueId);
  return { received: items.length };
}
// ── 盤點 ──

export async function createStocktake(input: {
  venueId?: number;
  note?: string;
  items: { sku: string; name: string; actualQty: number }[];
}) {
  const sql = getDb();
  await ensureStockSchema();
  const items = input.items.filter((i) => i.actualQty >= 0);
  if (items.length === 0) throw new Error('沒有盤點項目');
  const venueId = input.venueId ?? 1;
  const res = await sql`
    INSERT INTO stocktakes (venue_id, note) VALUES (${venueId}, ${input.note ?? ''})
    RETURNING id
  `;
  const takeId = res[0].id;
  for (const it of items) {
    const sys = await sql`SELECT qty FROM inventory WHERE sku = ${it.sku} AND venue_id = ${venueId}`;
    const systemQty = sys.length ? sys[0].qty : 0;
    await sql`
      INSERT INTO stocktake_items (stocktake_id, sku, name, system_qty, actual_qty)
      VALUES (${takeId}, ${it.sku}, ${it.name}, ${systemQty}, ${it.actualQty})
    `;
    await sql`
      UPDATE inventory SET qty = ${it.actualQty}, updated_at = NOW()
      WHERE sku = ${it.sku} AND venue_id = ${venueId}
    `;
  }
  await notifyLowStock(venueId);
  return { id: takeId, applied: items.length };
}

// ── 報表 ──

export async function getReports(venueId = 1): Promise<any> {
  const sql = getDb();
  await ensureStockSchema();
  const items = await sql`
    SELECT sku, name, category, price, cost_price, qty, min_qty, expiry_date
    FROM inventory WHERE venue_id = ${venueId} AND status = 'on_shelf'
    ORDER BY category, id
  `;
  let stockValue = 0;
  let potentialProfit = 0;
  const expiringSoon: any[] = [];
  for (const it of items) {
    stockValue += it.qty * it.cost_price;
    potentialProfit += it.qty * (it.price - it.cost_price);
    if (it.expiry_date) {
      const days = Math.ceil((new Date(it.expiry_date).getTime() - Date.now()) / 86400000);
      if (days >= 0 && days <= 14) expiringSoon.push({ sku: it.sku, name: it.name, expiryDate: it.expiry_date, days });
    }
  }
  const lowStock = await listLowStock(venueId);
  return { items, totals: { stockValue, potentialProfit }, lowStock, expiringSoon };
}

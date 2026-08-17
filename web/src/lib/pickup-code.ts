import { getDb, ensurePriceColumns } from './db';

export interface PickupCode {
  venueId: number;
  code: string;
  cell: number;
  status: 'ready' | 'used' | 'expired';
  lineUserId: string;
  lineName: string;
  venue: string;
  bookingDate: string;
  timeSlot: string;
  price: number;
  createdAt: string;
  expiryAt: string;
  usedAt: string | null;
}

export async function generateCode(
  venueId: number,
  cell: number,
  lineUserId = '',
  lineName = '',
  venue = '',
  bookingDate = '',
  timeSlot = '',
  ttlDays = 3,
  price = 0
): Promise<PickupCode> {
  await ensurePriceColumns();
  const sql = getDb();

  // 產生不重複 6 位數字碼（venue 內唯一）
  let code: string;
  let attempts = 0;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
    attempts++;
    const existing = await sql`
      SELECT 1 FROM pickup_codes WHERE venue_id = ${venueId} AND code = ${code}
    `;
    if (existing.length === 0) break;
  } while (attempts < 100);

  if (attempts >= 100) throw new Error('無法產生不重複取件碼');

  const result = await sql`
    INSERT INTO pickup_codes (venue_id, code, cell, line_user_id, line_name, venue, booking_date, time_slot, price, expiry_at)
    VALUES (${venueId}, ${code}, ${cell}, ${lineUserId}, ${lineName}, ${venue}, ${bookingDate}, ${timeSlot}, ${price},
            NOW() + ${ttlDays + ' days'}::INTERVAL)
    RETURNING *
  `;

  return rowToCode(result[0]);
}

/**
 * 驗證取件碼。
 * venueId 為 null 時查所有分店（kiosk 一定帶 venue，LINE 文字查詢可不帶）。
 * 回傳：格號（>0）、-1 不存在/過期、-2 已使用
 */
export async function validateCode(code: string, venueId?: number): Promise<number> {
  const sql = getDb();
  const rows = venueId
    ? await sql`
        SELECT cell, status, expiry_at FROM pickup_codes
        WHERE venue_id = ${venueId} AND code = ${code}
      `
    : await sql`
        SELECT cell, status, expiry_at FROM pickup_codes
        WHERE code = ${code}
        ORDER BY created_at DESC
      `;

  if (rows.length === 0) return -1;

  const row = rows[0];
  if (row.status === 'used') return -2;
  if (new Date(row.expiry_at) < new Date()) {
    await sql`UPDATE pickup_codes SET status = 'expired' WHERE id = ${row.id}`;
    return -1;
  }
  return Number(row.cell);
}

export async function markUsed(code: string, venueId?: number): Promise<boolean> {
  const sql = getDb();
  const result = venueId
    ? await sql`
        UPDATE pickup_codes SET status = 'used', used_at = NOW()
        WHERE venue_id = ${venueId} AND code = ${code} AND status = 'ready'
        RETURNING id
      `
    : await sql`
        UPDATE pickup_codes SET status = 'used', used_at = NOW()
        WHERE code = ${code} AND status = 'ready'
        RETURNING id
      `;
  return result.length > 0;
}

export async function getUserOrders(lineUserId: string): Promise<PickupCode[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM pickup_codes WHERE line_user_id = ${lineUserId}
    ORDER BY created_at DESC
  `;
  return rows.map(rowToCode);
}

export async function getStats() {
  const sql = getDb();
  const result = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'ready' AND expiry_at > NOW()) AS active,
      COUNT(*) FILTER (WHERE status = 'used') AS used
    FROM pickup_codes
  `;
  return { active: Number(result[0].active), used: Number(result[0].used) };
}

export async function getVenueCodesForCsv(venueId: number) {
  const sql = getDb();
  return await sql`
    SELECT code, cell, status
    FROM pickup_codes
    WHERE venue_id = ${venueId}
      AND status IN ('ready', 'used')
      AND expiry_at > NOW()
    ORDER BY cell, created_at
  `;
}

/** 分店營收報表：每家店租借數、完成數、營收 */
export async function getVenueReport() {
  await ensurePriceColumns();
  const sql = getDb();
  return await sql`
    SELECT
      v.id, v.slug, v.name, v.price AS default_price,
      COUNT(p.id) AS total_rentals,
      COUNT(p.id) FILTER (WHERE p.status = 'used') AS completed_rentals,
      COALESCE(SUM(p.price) FILTER (WHERE p.status = 'used'), 0) AS revenue
    FROM venues v
    LEFT JOIN pickup_codes p ON p.venue_id = v.id
    GROUP BY v.id, v.slug, v.name, v.price
    ORDER BY v.id
  `;
}

function rowToCode(row: any): PickupCode {
  return {
    venueId: Number(row.venue_id),
    code: row.code,
    cell: Number(row.cell),
    status: row.status,
    lineUserId: row.line_user_id,
    lineName: row.line_name,
    venue: row.venue,
    bookingDate: row.booking_date,
    timeSlot: row.time_slot,
    price: Number(row.price ?? 0),
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    expiryAt: row.expiry_at?.toISOString?.() ?? row.expiry_at,
    usedAt: row.used_at?.toISOString?.() ?? row.used_at ?? null,
  };
}

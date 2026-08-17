import { neon } from '@neondatabase/serverless';

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  return neon(url);
}

export async function initSchema() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS venues (
      id SERIAL PRIMARY KEY,
      slug VARCHAR(20) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      address VARCHAR(255) NOT NULL DEFAULT '',
      phone VARCHAR(20) NOT NULL DEFAULT '',
      cell_count INTEGER NOT NULL DEFAULT 22,
      line_token VARCHAR(255) NOT NULL DEFAULT '',
      writeback_token VARCHAR(64) NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 50,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS pickup_codes (
      id SERIAL PRIMARY KEY,
      venue_id INTEGER NOT NULL REFERENCES venues(id),
      code VARCHAR(6) NOT NULL,
      cell INTEGER NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'ready',
      line_user_id VARCHAR(255) NOT NULL DEFAULT '',
      line_name VARCHAR(255) NOT NULL DEFAULT '',
      venue VARCHAR(255) NOT NULL DEFAULT '',
      booking_date VARCHAR(20) NOT NULL DEFAULT '',
      time_slot VARCHAR(20) NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expiry_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '3 days',
      used_at TIMESTAMPTZ,
      UNIQUE(venue_id, code)
    );

    CREATE INDEX IF NOT EXISTS idx_pc_venue ON pickup_codes(venue_id);
    CREATE INDEX IF NOT EXISTS idx_pc_code ON pickup_codes(venue_id, code);
    CREATE INDEX IF NOT EXISTS idx_pc_line ON pickup_codes(venue_id, line_user_id);
    CREATE INDEX IF NOT EXISTS idx_pc_status ON pickup_codes(venue_id, status);
  `;
  console.log('[DB] Schema initialized');
}

/** 補齊 price 欄位（舊資料庫升級用，冪等） */
export async function ensurePriceColumns() {
  const sql = getDb();
  await sql`ALTER TABLE venues ADD COLUMN IF NOT EXISTS price INTEGER NOT NULL DEFAULT 50`;
  await sql`ALTER TABLE pickup_codes ADD COLUMN IF NOT EXISTS price INTEGER NOT NULL DEFAULT 0`;
}

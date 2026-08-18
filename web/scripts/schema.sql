-- Neon PostgreSQL schema for smartlocker pickup codes
-- Run in Neon SQL console or via: psql $DATABASE_URL -f scripts/schema.sql

CREATE TABLE IF NOT EXISTS pickup_codes (
  id SERIAL PRIMARY KEY,
  code VARCHAR(6) NOT NULL UNIQUE,
  cell INTEGER NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'ready',
  line_user_id VARCHAR(255) NOT NULL DEFAULT '',
  line_name VARCHAR(255) NOT NULL DEFAULT '',
  venue VARCHAR(255) NOT NULL DEFAULT '',
  booking_date VARCHAR(20) NOT NULL DEFAULT '',
  time_slot VARCHAR(20) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expiry_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '3 days',
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pickup_codes_code ON pickup_codes(code);
CREATE INDEX IF NOT EXISTS idx_pickup_codes_line_user_id ON pickup_codes(line_user_id);
CREATE INDEX IF NOT EXISTS idx_pickup_codes_status ON pickup_codes(status);

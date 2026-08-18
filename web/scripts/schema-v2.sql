-- ============================================
-- V2 多店舖架構（5 家店 MVP）
-- 用法：psql $DATABASE_URL -f scripts/schema-v2.sql
-- ============================================

-- 分店
CREATE TABLE IF NOT EXISTS venues (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  address VARCHAR(255) NOT NULL DEFAULT '',
  phone VARCHAR(20) NOT NULL DEFAULT '',
  cell_count INTEGER NOT NULL DEFAULT 22,
  line_token VARCHAR(255) NOT NULL DEFAULT '',
  writeback_token VARCHAR(64) NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 格號映射（選用，跟 kiosk cells.csv 概念一樣）
CREATE TABLE IF NOT EXISTS venue_cells (
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  cell_number INTEGER NOT NULL,
  board_addr INTEGER NOT NULL DEFAULT 1,
  board_channel INTEGER NOT NULL,
  label VARCHAR(50) NOT NULL DEFAULT '',
  PRIMARY KEY (venue_id, cell_number)
);

-- 取件碼（綁定分店）
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expiry_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '3 days',
  used_at TIMESTAMPTZ,
  UNIQUE(venue_id, code)
);

CREATE INDEX IF NOT EXISTS idx_pc_venue ON pickup_codes(venue_id);
CREATE INDEX IF NOT EXISTS idx_pc_code ON pickup_codes(venue_id, code);
CREATE INDEX IF NOT EXISTS idx_pc_line ON pickup_codes(venue_id, line_user_id);
CREATE INDEX IF NOT EXISTS idx_pc_status ON pickup_codes(venue_id, status);

-- 預設 5 家店（只有空表時才插入）
INSERT INTO venues (slug, name, cell_count, writeback_token)
SELECT * FROM (VALUES
  ('df-a', '迪飛羽球館 A 館', 22, 'wb_token_df_a_change_me'),
  ('df-b', '迪飛羽球館 B 館', 22, 'wb_token_df_b_change_me'),
  ('df-c', '迪飛羽球館 C 館', 22, 'wb_token_df_c_change_me'),
  ('df-d', '迪飛羽球館 D 館', 22, 'wb_token_df_d_change_me'),
  ('df-e', '迪飛羽球館 E 館', 22, 'wb_token_df_e_change_me')
) AS v(slug, name, cell_count, writeback_token)
WHERE NOT EXISTS (SELECT 1 FROM venues);

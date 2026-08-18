import { neon } from '@neondatabase/serverless';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('請設定 DATABASE_URL');
    process.exit(1);
  }

  const sql = neon(url);

  console.log('建立 venues 表格...');
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
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  console.log('✓ venues 就緒');

  console.log('建立 pickup_codes 表格...');
  await sql`
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
  `;
  console.log('✓ pickup_codes 就緒');

  console.log('建立索引...');
  await sql`CREATE INDEX IF NOT EXISTS idx_pc_venue ON pickup_codes(venue_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pc_code ON pickup_codes(venue_id, code)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pc_line ON pickup_codes(venue_id, line_user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pc_status ON pickup_codes(venue_id, status)`;
  console.log('✓ 索引就緒');

  const existing = await sql`SELECT COUNT(*) AS cnt FROM venues`;
  if (Number(existing[0].cnt) === 0) {
    console.log('插入預設 5 家分店...');
    await sql`
      INSERT INTO venues (slug, name, cell_count, writeback_token) VALUES
        ('df-a', '迪飛羽球館 A 館', 22, 'wb_token_df_a_change_me'),
        ('df-b', '迪飛羽球館 B 館', 22, 'wb_token_df_b_change_me'),
        ('df-c', '迪飛羽球館 C 館', 22, 'wb_token_df_c_change_me'),
        ('df-d', '迪飛羽球館 D 館', 22, 'wb_token_df_d_change_me'),
        ('df-e', '迪飛羽球館 E 館', 22, 'wb_token_df_e_change_me')
    `;
    console.log('✓ 5 家分店已插入');
  } else {
    console.log('分店已存在，略過');
  }

  console.log('\nSchema 初始化完成！');
}

main().catch((err) => {
  console.error('初始化失敗:', err);
  process.exit(1);
});

// 管理密碼種子（單一密碼）：清掉舊的、種入新的（scrypt salt:hash 格式）
// 用法：
//   DATABASE_URL=<neon網址> NEW_ADMIN_PASSWORD=<密碼> node scripts/seed-admin-password.mjs
import { neon } from '@neondatabase/serverless';
import { randomBytes, scryptSync } from 'node:crypto';

const url = process.env.DATABASE_URL;
if (!url || !url.startsWith('postgres')) {
  console.error('❌ 請設 DATABASE_URL（Neon 網址）');
  process.exit(1);
}
const pw = process.env.NEW_ADMIN_PASSWORD;
if (!pw) {
  console.error('❌ 請設 NEW_ADMIN_PASSWORD');
  process.exit(1);
}

const salt = randomBytes(16).toString('hex');
const hash = scryptSync(pw, salt, 64).toString('hex');
const sql = neon(url);

await sql`CREATE TABLE IF NOT EXISTS admin_credentials (
  id SERIAL PRIMARY KEY,
  password_hash VARCHAR(200) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;
await sql`DELETE FROM admin_credentials`;
await sql`INSERT INTO admin_credentials (password_hash) VALUES (${salt + ':' + hash})`;

console.log('✅ admin_credentials 已種子化（後台密碼 = NEW_ADMIN_PASSWORD 的值）');

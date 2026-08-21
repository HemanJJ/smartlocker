import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getDb } from './db';

// ── 管理密碼（存資料庫，後台可自行修改） ────────────────────
// 之前密碼在 Vercel env（改不動），現在改存 admin_credentials 表，
// 後台「改密碼」頁直接更新 DB。Vercel 的 ADMIN_PASSWORD 只當首次種子。

const scrypt = promisify(_scrypt);

let ensurePromise: Promise<void> | null = null;

/** 建表（不自動種子；種子由 scripts/seed-admin-password.mjs 顯式執行） */
export function ensureAdminCredentials(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const sql = getDb();
      await sql`
        CREATE TABLE IF NOT EXISTS admin_credentials (
          id SERIAL PRIMARY KEY,
          password_hash VARCHAR(200) NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
    })();
  }
  return ensurePromise;
}

async function hashPw(pw: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const buf = (await scrypt(pw, salt, 64)) as Buffer;
  return `${salt}:${buf.toString('hex')}`;
}

async function verifyPw(pw: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const buf = (await scrypt(pw, salt, 64)) as Buffer;
  const storedBuf = Buffer.from(hash, 'hex');
  return buf.length === storedBuf.length && timingSafeEqual(buf, storedBuf);
}

/** 驗證管理密碼（登入用） */
export async function checkAdminPassword(password: string): Promise<boolean> {
  try {
    const sql = getDb();
    await ensureAdminCredentials();
    const rows = await sql`SELECT password_hash FROM admin_credentials ORDER BY id LIMIT 1`;
    if (rows.length === 0) return false; // 未種子 = 鎖死（安全預設）
    return verifyPw(password, rows[0].password_hash);
  } catch (e) {
    console.error('[AdminPassword] 驗證失敗:', e);
    return false;
  }
}

/** 改密碼：驗證目前密碼 → 更新新密碼 */
export async function changeAdminPassword(
  current: string,
  next: string
): Promise<{ ok: boolean; error?: string }> {
  if (!next || next.length < 6) {
    return { ok: false, error: '新密碼至少 6 碼' };
  }
  const sql = getDb();
  await ensureAdminCredentials();
  const rows = await sql`SELECT id, password_hash FROM admin_credentials ORDER BY id LIMIT 1`;
  if (rows.length === 0) {
    return { ok: false, error: '管理密碼尚未初始化' };
  }
  if (!(await verifyPw(current, rows[0].password_hash))) {
    return { ok: false, error: '目前密碼錯誤' };
  }
  const hash = await hashPw(next);
  await sql`UPDATE admin_credentials SET password_hash = ${hash}, updated_at = NOW() WHERE id = ${rows[0].id}`;
  return { ok: true };
}

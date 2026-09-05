import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getDb } from './db';

// ── 後台員工（保險箱式登入：人名 + 4 碼 PIN）──────────────────
// 每位員工一組 PIN，登入後可自改。預設 1234。

const scrypt = promisify(_scrypt);

export interface StaffItem {
  id: number;
  name: string;
  role: 'admin' | 'staff';
}

let ensurePromise: Promise<void> | null = null;

const SEED_STAFF: { name: string; role: 'admin' | 'staff' }[] = [
  { name: '管理員', role: 'admin' },   // MIS/老闆
  { name: '王清標', role: 'staff' },
  { name: '王小姐', role: 'staff' },
  { name: '謝小姐', role: 'staff' },
  { name: '黃先生', role: 'staff' },
];

export function ensureStaffSchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const sql = getDb();
      await sql`
        CREATE TABLE IF NOT EXISTS staff (
          id SERIAL PRIMARY KEY,
          name VARCHAR(60) NOT NULL UNIQUE,
          pin_hash VARCHAR(200) NOT NULL,
          role VARCHAR(10) NOT NULL DEFAULT 'staff',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      const defaultHash = await hashPin('1234');
      for (const s of SEED_STAFF) {
        await sql`
          INSERT INTO staff (name, pin_hash, role) VALUES (${s.name}, ${defaultHash}, ${s.role})
          ON CONFLICT (name) DO NOTHING
        `;
      }
      // 修正既有資料：4 位員工一律 staff、管理員一律 admin（避免舊種子把王清標設成 admin）
      await sql`UPDATE staff SET role = 'staff' WHERE name IN ('王清標','王小姐','謝小姐','黃先生')`;
      await sql`UPDATE staff SET role = 'admin' WHERE name = '管理員'`;
    })().catch((e) => { ensurePromise = null; throw e; });
  }
  return ensurePromise;
}

async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const buf = (await scrypt(pin, salt, 64)) as Buffer;
  return `${salt}:${buf.toString('hex')}`;
}

async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const buf = (await scrypt(pin, salt, 64)) as Buffer;
  const storedBuf = Buffer.from(hash, 'hex');
  return buf.length === storedBuf.length && timingSafeEqual(buf, storedBuf);
}

/** 員工名單（登入下拉用；只回 id/name/role） */
export async function listStaff(): Promise<StaffItem[]> {
  await ensureStaffSchema();
  const sql = getDb();
  const rows = await sql`SELECT id, name, role FROM staff ORDER BY id`;
  return rows.map((r: any) => ({ id: Number(r.id), name: r.name, role: r.role }));
}

/** 驗證某人 + PIN（登入用） */
export async function verifyStaffPin(name: string, pin: string): Promise<boolean> {
  try {
    await ensureStaffSchema();
    const sql = getDb();
    const rows = await sql`SELECT pin_hash FROM staff WHERE name = ${name}`;
    if (rows.length === 0) return false;
    return verifyPin(pin, rows[0].pin_hash);
  } catch {
    return false;
  }
}

/** 修改自己的 PIN：驗證目前 PIN → 更新新 PIN */
export async function changeStaffPin(
  name: string,
  currentPin: string,
  newPin: string
): Promise<{ ok: boolean; error?: string }> {
  if (!/^\d{4}$/.test(newPin)) return { ok: false, error: '新 PIN 需為 4 位數字' };
  await ensureStaffSchema();
  const sql = getDb();
  const rows = await sql`SELECT id, pin_hash FROM staff WHERE name = ${name}`;
  if (rows.length === 0) return { ok: false, error: '員工不存在' };
  if (!(await verifyPin(currentPin, rows[0].pin_hash))) return { ok: false, error: '目前 PIN 錯誤' };
  const hash = await hashPin(newPin);
  await sql`UPDATE staff SET pin_hash = ${hash}, updated_at = NOW() WHERE id = ${rows[0].id}`;
  return { ok: true };
}

/** 查某員工角色（admin 才有敏感功能權限） */
export async function getStaffRole(name: string): Promise<'admin' | 'staff' | null> {
  await ensureStaffSchema();
  const sql = getDb();
  const rows = await sql`SELECT role FROM staff WHERE name = ${name}`;
  return rows.length === 0 ? null : (rows[0].role as 'admin' | 'staff');
}

/** 新增員工（預設 PIN 1234） */
export async function addStaff(name: string, role: 'admin' | 'staff' = 'staff'): Promise<{ ok: boolean; error?: string }> {
  const n = name.trim();
  if (!n) return { ok: false, error: '請輸入姓名' };
  await ensureStaffSchema();
  const sql = getDb();
  const exist = await sql`SELECT 1 FROM staff WHERE name = ${n}`;
  if (exist.length > 0) return { ok: false, error: '此員工已存在' };
  const hash = await hashPin('1234');
  await sql`INSERT INTO staff (name, pin_hash, role) VALUES (${n}, ${hash}, ${role})`;
  return { ok: true };
}

/** 重置某員工 PIN 為 1234 */
export async function resetStaffPin(name: string): Promise<{ ok: boolean; error?: string }> {
  await ensureStaffSchema();
  const sql = getDb();
  const rows = await sql`SELECT id FROM staff WHERE name = ${name}`;
  if (rows.length === 0) return { ok: false, error: '員工不存在' };
  const hash = await hashPin('1234');
  await sql`UPDATE staff SET pin_hash = ${hash}, updated_at = NOW() WHERE id = ${rows[0].id}`;
  return { ok: true };
}

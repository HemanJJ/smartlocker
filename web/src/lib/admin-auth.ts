// ── 後台簡易認證（Phase 1：密碼門） ──────────────────────────
// 中期目標：跟 booking 一樣搬 member/staff/admin 三層。
// Cookie 用 HMAC-SHA256 簽章；全部用 Web Crypto（Edge middleware 與
// Node route handler 都能跑，不需 node:crypto）。

export const ADMIN_COOKIE = 'skb_admin';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 天

const enc = new TextEncoder();

function secret(): string {
  return process.env.SESSION_SECRET || process.env.LINE_CHANNEL_SECRET || 'skb-dev-secret';
}

async function hmacKey(usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage]
  );
}

function bufToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlToBuf(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function makeAdminToken(staff?: string): Promise<string> {
  const staffEnc = staff ? encodeURIComponent(staff) : '';
  const value = `admin:${staffEnc}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  const key = await hmacKey('sign');
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(value));
  return `${value}.${bufToB64url(sig)}`;
}

/** 從有效 token 取出登入員工名（無則空字串） */
export async function getAdminStaff(token: string | undefined | null): Promise<string> {
  if (!token) return '';
  if (!(await isValidAdminToken(token))) return '';
  const value = token.slice(0, token.lastIndexOf('.'));
  const parts = value.split(':');
  if (parts.length < 3) return '';
  try { return decodeURIComponent(parts[1]); } catch { return ''; }
}

export async function isValidAdminToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const value = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let sigBuf: ArrayBuffer;
  try {
    sigBuf = b64urlToBuf(sig);
  } catch {
    return false;
  }
  const key = await hmacKey('verify');
  return crypto.subtle.verify('HMAC', key, sigBuf, enc.encode(value));
}

/** 密碼驗證／修改已移到 lib/admin-passwords.ts（存資料庫，後台可改） */

export const ADMIN_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: COOKIE_MAX_AGE,
};

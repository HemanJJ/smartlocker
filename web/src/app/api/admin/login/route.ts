import { NextResponse } from 'next/server';
import { checkAdminPassword } from '@/lib/admin-passwords';
import { logAdminAction } from '@/lib/stringing';
import {
  makeAdminToken,
  ADMIN_COOKIE,
  ADMIN_COOKIE_OPTIONS,
} from '@/lib/admin-auth';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const password = String(body?.password ?? '');
  const ok = await checkAdminPassword(password);
  if (!ok) {
    await logAdminAction('登入失敗', '', '密碼錯誤');
    return NextResponse.json({ ok: false, error: '密碼錯誤' }, { status: 401 });
  }
  await logAdminAction('登入成功', '', '');
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, await makeAdminToken(), ADMIN_COOKIE_OPTIONS);
  return res;
}

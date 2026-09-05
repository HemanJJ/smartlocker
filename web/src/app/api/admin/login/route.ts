import { NextResponse } from 'next/server';
import { verifyStaffPin } from '@/lib/staff';
import { logAdminAction } from '@/lib/stringing';
import {
  makeAdminToken,
  ADMIN_COOKIE,
  ADMIN_COOKIE_OPTIONS,
} from '@/lib/admin-auth';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? '').trim();
  const pin = String(body?.pin ?? '').replace(/\D/g, '');

  if (!name || !/^\d{4}$/.test(pin)) {
    await logAdminAction('登入失敗', name, '格式錯誤');
    return NextResponse.json({ ok: false, error: '請選名字並輸入 4 碼 PIN' }, { status: 401 });
  }

  const ok = await verifyStaffPin(name, pin);
  if (!ok) {
    await logAdminAction('登入失敗', name, 'PIN 錯誤');
    return NextResponse.json({ ok: false, error: 'PIN 錯誤' }, { status: 401 });
  }

  await logAdminAction('登入成功', name, '');
  const res = NextResponse.json({ ok: true, name });
  res.cookies.set(ADMIN_COOKIE, await makeAdminToken(name), ADMIN_COOKIE_OPTIONS);
  return res;
}

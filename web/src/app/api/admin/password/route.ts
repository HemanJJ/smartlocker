import { NextResponse } from 'next/server';
import { changeAdminPassword } from '@/lib/admin-passwords';

export const runtime = 'nodejs';

// 後台改密碼（middleware 已擋未登入）
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const current = String(body?.current ?? '');
  const next = String(body?.next ?? '');
  const result = await changeAdminPassword(current, next);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

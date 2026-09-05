import { NextRequest, NextResponse } from 'next/server';
import { changeStaffPin } from '@/lib/staff';
import { getAdminName } from '@/lib/admin-auth';

export const runtime = 'nodejs';

// 改自己的 PIN（middleware 已擋未登入；由 cookie 知道是哪位員工）
export async function POST(request: NextRequest) {
  const name = await getAdminName(request);
  if (!name) {
    return NextResponse.json({ ok: false, error: '請先登入' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const current = String(body?.current ?? '').replace(/\D/g, '');
  const next = String(body?.next ?? '').replace(/\D/g, '');
  const result = await changeStaffPin(name, current, next);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

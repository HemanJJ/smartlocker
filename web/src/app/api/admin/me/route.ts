import { NextResponse } from 'next/server';
import { getStaffRole } from '@/lib/staff';
import { ADMIN_COOKIE, getAdminStaff } from '@/lib/admin-auth';

export const runtime = 'nodejs';

// GET /api/admin/me → 目前登入者的姓名 + 角色（後台 UI 依角色顯示/隱藏功能）
export async function GET(req: Request) {
  const cookieHeader = req.headers.get('cookie') || '';
  const token = cookieHeader
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${ADMIN_COOKIE}=`))
    ?.split('=').slice(1).join('=');
  const name = await getAdminStaff(token);
  if (!name) {
    return NextResponse.json({ ok: false, error: '未登入' }, { status: 401 });
  }
  const role = await getStaffRole(name);
  return NextResponse.json({ ok: true, name, role });
}

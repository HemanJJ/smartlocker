import { NextRequest, NextResponse } from 'next/server';
import { getStaffRole } from '@/lib/staff';
import { getAdminName } from '@/lib/admin-auth';

export const runtime = 'nodejs';

// GET /api/admin/me → 目前登入者的姓名 + 角色
export async function GET(request: NextRequest) {
  const name = await getAdminName(request);
  if (!name) {
    return NextResponse.json({ ok: false, error: '未登入' }, { status: 401 });
  }
  const role = await getStaffRole(name);
  return NextResponse.json({ ok: true, name, role });
}

import { NextRequest, NextResponse } from 'next/server';
import { listStaff, addStaff, resetStaffPin, getStaffRole } from '@/lib/staff';
import { getAdminName } from '@/lib/admin-auth';

export const runtime = 'nodejs';

// GET /api/admin/staff → 員工名單（admin-only）
export async function GET(request: NextRequest) {
  const name = await getAdminName(request);
  if (!name || (await getStaffRole(name)) !== 'admin') {
    return NextResponse.json({ ok: false, error: '只有管理員可管理員工' }, { status: 403 });
  }
  const staff = await listStaff();
  return NextResponse.json({ ok: true, staff });
}

// POST /api/admin/staff → { action: 'add', name, role } 或 { action: 'reset', name }（admin-only）
export async function POST(request: NextRequest) {
  const name = await getAdminName(request);
  if (!name || (await getStaffRole(name)) !== 'admin') {
    return NextResponse.json({ ok: false, error: '只有管理員可管理員工' }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const action = String(body?.action ?? '');
  if (action === 'add') {
    const r = await addStaff(String(body?.name ?? ''), body?.role === 'admin' ? 'admin' : 'staff');
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  }
  if (action === 'reset') {
    const r = await resetStaffPin(String(body?.name ?? ''));
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  }
  return NextResponse.json({ ok: false, error: '未知操作' }, { status: 400 });
}

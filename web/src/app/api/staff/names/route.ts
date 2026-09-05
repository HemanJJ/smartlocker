import { NextResponse } from 'next/server';
import { listStaff } from '@/lib/staff';

export const runtime = 'nodejs';

// GET /api/staff/names → 登入頁下拉用（只回員工姓名清單，不含 PIN）
export async function GET() {
  try {
    const staff = await listStaff();
    return NextResponse.json({ ok: true, names: staff.map((s) => s.name) });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

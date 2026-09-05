import { NextRequest, NextResponse } from 'next/server';
import { queueOpenAllSlots, logAdminAction, taiwanMMDD } from '@/lib/stringing';
import { getStaffRole } from '@/lib/staff';
import { getAdminName } from '@/lib/admin-auth';

export const runtime = 'nodejs';

// POST /api/admin/open-all → 一鍵全開（受 middleware 保護；僅 admin；密碼=今日 MMDD 4 碼；記名）
export async function POST(request: NextRequest) {
  try {
    const operator = await getAdminName(request);
    if (!operator) {
      return NextResponse.json({ ok: false, error: '請先登入' }, { status: 401 });
    }
    const role = await getStaffRole(operator);
    if (role !== 'admin') {
      await logAdminAction('一鍵全開-失敗', operator, '無權限(非 admin)');
      return NextResponse.json({ ok: false, error: '只有管理員可一鍵全開' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const password = String(body?.password ?? '').trim();
    if (!/^\d{4}$/.test(password)) {
      await logAdminAction('一鍵全開-失敗', operator, '密碼格式錯誤');
      return NextResponse.json({ ok: false, error: '請輸入今日日期 4 碼（如 0903）' }, { status: 401 });
    }
    if (password !== taiwanMMDD()) {
      await logAdminAction('一鍵全開-失敗', operator, '密碼錯誤');
      return NextResponse.json({ ok: false, error: '密碼錯誤（＝今日日期 4 碼）' }, { status: 401 });
    }

    const queued = await queueOpenAllSlots();
    await logAdminAction('一鍵全開', operator, `開啟 ${queued} 格`);
    return NextResponse.json({ ok: true, queued });
  } catch (err: any) {
    console.error('[AdminOpenAll] 一鍵全開失敗:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

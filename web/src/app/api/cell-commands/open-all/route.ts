import { NextRequest, NextResponse } from 'next/server';
import { queueOpenAllSlots, logAdminAction, taiwanMMDD } from '@/lib/stringing';

export const runtime = 'nodejs';

// POST /api/cell-commands/open-all → 一鍵全開
// body: { operator: '員工名', password: '今日 MMDD 4 碼（如 0903）' }
// 多一道手續：密碼＝今日日期，並記入操作 log（誰、何時、開幾格）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const operator = String(body?.operator ?? '').trim();
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
    console.error('[CellCommands] 一鍵全開失敗:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

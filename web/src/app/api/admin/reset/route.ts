import { NextResponse } from 'next/server';
import { clearAllOrders, logAdminAction } from '@/lib/stringing';

export const runtime = 'nodejs';

export async function POST() {
  try {
    await clearAllOrders();
    await logAdminAction('清空資料', '', '清空全部訂單＋格口');
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[AdminReset] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

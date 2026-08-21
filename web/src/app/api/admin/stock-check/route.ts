import { NextResponse } from 'next/server';
import { notifyLowStock } from '@/lib/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 手動「檢查安全存量」→ LINE 通知老闆
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const venueId = Number(body?.venueId ?? 1);
    const result = await notifyLowStock(venueId);
    return NextResponse.json({ ok: true, notified: result.notified, error: result.error });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

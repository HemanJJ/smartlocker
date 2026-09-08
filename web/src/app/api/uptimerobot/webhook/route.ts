import { NextRequest, NextResponse } from 'next/server';
import { pushMessage } from '@/lib/line';

export const runtime = 'nodejs';

// POST /api/uptimerobot/webhook
// UptimeRobot 掛站（down）警報 → 轉 LINE，只發給「admin 一人」（UPTIME_ADMIN_USER_ID）。
// 恢復（up）等其他事件不發。支援 form-encoded 與 JSON 兩種 body。
export async function POST(request: NextRequest) {
  try {
    let payload: Record<string, string> = {};
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await request.text();
      payload = Object.fromEntries(new URLSearchParams(text));
    } else {
      payload = (await request.json().catch(() => ({}))) as Record<string, string>;
    }

    // 只發「掛了」；alertType=1 或 friendly 含 down。up 等其餘事件略過。
    const alertType = String(payload.alertType ?? '');
    const friendly = String(payload.alertTypeFriendlyName ?? '');
    const isDown = alertType === '1' || /down/i.test(friendly);
    if (!isDown) {
      return NextResponse.json({ ok: true, skipped: 'not-down' });
    }

    const name = payload.monitorFriendlyName || payload.monitorURL || '未知站點';
    const details = (payload.alertDetails || '').trim();
    const text = `🔴 UptimeRobot｜${name} 掛了${details ? `\n${details}` : ''}`.trim();

    const adminId = (process.env.UPTIME_ADMIN_USER_ID || '').trim();
    if (!adminId) {
      console.warn('[UptimeRobot webhook] 未設定 UPTIME_ADMIN_USER_ID，略過');
      return NextResponse.json({ ok: true, skipped: 'no-admin' });
    }
    await pushMessage(adminId, [{ type: 'text', text }]);
    return NextResponse.json({ ok: true, sent: 1 });
  } catch (e: any) {
    console.error('[UptimeRobot webhook] 錯誤:', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

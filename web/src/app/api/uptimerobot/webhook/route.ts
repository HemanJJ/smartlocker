import { NextRequest, NextResponse } from 'next/server';
import { pushMessage } from '@/lib/line';

export const runtime = 'nodejs';

// POST /api/uptimerobot/webhook
// UptimeRobot Alert Contact（Webhook）打過來 → 轉成 LINE 通知（送到 STAFF_LINE_USER_ID(S)）
// 支援 UptimeRobot 預設的 form-encoded，也支援「Send as JSON」。
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

    const name = payload.monitorFriendlyName || payload.monitorURL || '未知站點';
    const alertType = String(payload.alertType ?? '');
    const friendly = String(payload.alertTypeFriendlyName ?? '');
    const details = (payload.alertDetails || '').trim();

    // alertType: 1=down, 2=up, 其他(SSL 等)也照發
    const isDown = alertType === '1' || /down/i.test(friendly);
    const isUp = alertType === '2' || /up/i.test(friendly);
    const icon = isDown ? '🔴' : isUp ? '🟢' : '⚠️';
    const state = isDown ? '掛了' : isUp ? '恢復' : '警報';
    const text = `${icon} UptimeRobot｜${name} ${state}${details ? `\n${details}` : ''}`.trim();

    const raw = process.env.STAFF_LINE_USER_ID || process.env.STAFF_LINE_USER_IDS || '';
    const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);

    if (ids.length === 0) {
      console.warn('[UptimeRobot webhook] 無 STAFF_LINE_USER_ID，略過推播');
      return NextResponse.json({ ok: true, skipped: true });
    }
    for (const id of ids) {
      await pushMessage(id, [{ type: 'text', text }]);
    }
    return NextResponse.json({ ok: true, sent: ids.length });
  } catch (e: any) {
    console.error('[UptimeRobot webhook] 錯誤:', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

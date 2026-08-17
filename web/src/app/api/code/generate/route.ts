import { NextRequest, NextResponse } from 'next/server';
import { generateCode } from '@/lib/pickup-code';
import { getVenueBySlug, getVenueById } from '@/lib/venues';
import { pushMessage } from '@/lib/line';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const cell = body.cell as number;
    const lineUserId = body.lineUserId || '';
    const lineName = body.lineName || '';
    const venue = body.venue || '';
    const venueSlug = body.venueSlug || '';
    const bookingDate = body.bookingDate || '';
    const timeSlot = body.timeSlot || '';
    const ttlDays = body.ttlDays || 3;

    let venueId = body.venueId as number | undefined;
    if (!venueId && venueSlug) {
      const v = await getVenueBySlug(venueSlug);
      if (!v) return NextResponse.json({ ok: false, error: 'venue_not_found' }, { status: 400 });
      venueId = v.id;
    }
    if (!venueId) {
      const { listVenues } = await import('@/lib/venues');
      const venues = await listVenues(true);
      if (venues.length === 0) return NextResponse.json({ ok: false, error: 'no_venues' }, { status: 400 });
      venueId = venues[0].id;
    }

    const v = await getVenueById(venueId);
    if (!v) return NextResponse.json({ ok: false, error: 'venue_not_found' }, { status: 400 });

    if (!cell || cell < 1 || cell > v.cellCount) {
      return NextResponse.json({ ok: false, error: 'invalid_cell' }, { status: 400 });
    }

    const price = Number(body.price ?? v.price ?? 0);
    const pickup = await generateCode(venueId, cell, lineUserId, lineName, venue, bookingDate, timeSlot, ttlDays, price);

    // LINE 推播
    if (lineUserId) {
      const text = `🔑 取件碼已產生！\n\n${v.name}\n取件碼：${pickup.code}\n格號：第 ${cell} 格\n有效期限：${new Date(pickup.expiryAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}\n\n請至 ${v.name} 智慧拍櫃輸入取件碼取件。`;
      const ok = await pushMessage(lineUserId, [{ type: 'text', text }]);
      console.log(`[推播] ${ok ? '成功' : '失敗'} ${lineUserId}`);
    }

    return NextResponse.json({
      ok: true,
      code: pickup.code,
      cell: pickup.cell,
      venue: v.name,
      venueSlug: v.slug,
      expiry: pickup.expiryAt,
    });
  } catch (err: any) {
    console.error('[Generate] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

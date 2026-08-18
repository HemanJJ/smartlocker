import { NextResponse } from 'next/server';
import { listSlots } from '@/lib/stringing';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const slots = await listSlots();
    const empty = slots.filter((s) => s.status === 'empty').length;
    const occupied = slots.filter((s) => s.status === 'occupied').length;
    return NextResponse.json({ ok: true, slots, summary: { total: slots.length, empty, occupied } });
  } catch (err: any) {
    console.error('[Slots] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

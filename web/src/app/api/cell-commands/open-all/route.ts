import { NextResponse } from 'next/server';
import { queueOpenAllSlots } from '@/lib/stringing';

export const runtime = 'nodejs';

// POST /api/cell-commands/open-all → 一鍵全開（把「所有格口」排入開格指令，kiosk poller 依序 E2 開鎖）
export async function POST() {
  try {
    const queued = await queueOpenAllSlots();
    return NextResponse.json({ ok: true, queued });
  } catch (err: any) {
    console.error('[CellCommands] 一鍵全開失敗:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

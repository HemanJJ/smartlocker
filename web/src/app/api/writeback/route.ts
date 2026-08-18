import { NextRequest, NextResponse } from 'next/server';
import { getVenueBySlug } from '@/lib/venues';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';

// SheetSync.cs 會 POST 這個格式：
//   { "token": "...", "items": [{ "ts": "...", "code": "123456", "cell": "7" }] }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = body.token as string;
    const items = body.items as Array<{ ts: string; code: string; cell: string }> | undefined;

    if (!items || !items.length) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    // 用 token 反查分店
    const sql = getDb();
    const venueRows = await sql`
      SELECT id, slug, name FROM venues WHERE writeback_token = ${token} AND is_active = TRUE
    `;
    if (venueRows.length === 0) {
      return NextResponse.json({ ok: false, error: 'bad_token' });
    }
    const venueId = Number(venueRows[0].id);

    let updated = 0;
    for (const item of items) {
      const code = (item.code || '').trim();
      if (!code) continue;
      const result = await sql`
        UPDATE pickup_codes SET status = 'used', used_at = NOW()
        WHERE venue_id = ${venueId} AND code = ${code} AND status = 'ready'
        RETURNING id
      `;
      if (result.length > 0) updated++;
    }

    return NextResponse.json({ ok: true, updated, received: items.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getVenueBySlug } from '@/lib/venues';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;
    const venue = await getVenueBySlug(slug);
    if (!venue) {
      return new NextResponse('venue not found', { status: 404 });
    }

    const sql = getDb();
    const rows = await sql`
      SELECT code, cell, status
      FROM pickup_codes
      WHERE venue_id = ${venue.id}
        AND status IN ('ready', 'used')
        AND expiry_at > NOW()
      ORDER BY cell, created_at
    `;

    // BOM + 標題列（跟 Google Sheet CSV 發布格式完全一致）
    const lines = ['\uFEFF取件碼,格號,狀態,備註'];
    for (const r of rows) {
      const status = r.status === 'used' ? '已取' : '待取';
      lines.push(`${r.code},${r.cell},${status},`);
    }

    return new NextResponse(lines.join('\r\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    return new NextResponse('internal error: ' + err.message, { status: 500 });
  }
}

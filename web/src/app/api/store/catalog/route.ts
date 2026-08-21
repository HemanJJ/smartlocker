import { NextResponse } from 'next/server';
import { listCatalog } from '@/lib/vending';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 公開：kiosk／前台讀商品目錄
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const venueId = Number(url.searchParams.get('venue') ?? 1);
    const items = await listCatalog(venueId);
    return NextResponse.json({ ok: true, items });
  } catch (err: any) {
    console.error('[StoreCatalog] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

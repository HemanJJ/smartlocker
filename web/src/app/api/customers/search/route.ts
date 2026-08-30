import { NextRequest, NextResponse } from 'next/server';
import { searchCustomers } from '@/lib/stringing';

export const runtime = 'nodejs';

// GET /api/customers/search?q=關鍵字 → 歷史客人（名字或電話模糊比對，去重）
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get('q') || '';
    const customers = await searchCustomers(q);
    return NextResponse.json({ ok: true, customers });
  } catch (err: any) {
    console.error('[Customers] 搜尋失敗:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

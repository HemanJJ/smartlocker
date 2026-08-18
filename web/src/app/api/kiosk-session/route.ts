import { NextRequest, NextResponse } from 'next/server';
import { createKioskSession, getKioskSession } from '@/lib/stringing';

export const runtime = 'nodejs';

// POST：建立一個 kiosk 認證 session，回傳 4 位認證碼
export async function POST() {
  try {
    const code = await createKioskSession();
    return NextResponse.json({ ok: true, code });
  } catch (err: any) {
    console.error('[KioskSession] 建立失敗:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

// GET：輪詢認證狀態 ?code=XXXX
export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get('code') || '';
    const session = await getKioskSession(code);
    return NextResponse.json({ ok: true, session });
  } catch (err: any) {
    console.error('[KioskSession] 查詢失敗:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

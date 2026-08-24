import { NextResponse } from 'next/server';
import { listStrings, upsertString } from '@/lib/stringing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 後台：線種管理（middleware 已擋未登入）

// 列出全部線種（含停用，供管理）
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const activeOnly = url.searchParams.get('include_disabled') === '1' ? false : true;
    const strings = await listStrings(activeOnly);
    return NextResponse.json({ ok: true, strings });
  } catch (err: any) {
    console.error('[AdminStrings GET] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

// 新增（或已存在則更新）線種：品牌自動推導或自填
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const s = await upsertString(body || {});
    return NextResponse.json({ ok: true, string: s });
  } catch (err: any) {
    console.error('[AdminStrings POST] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}

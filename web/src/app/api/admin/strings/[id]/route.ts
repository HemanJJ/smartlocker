import { NextResponse } from 'next/server';
import { updateString, disableString } from '@/lib/stringing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 編輯線種（店長後台，middleware 已擋未登入）
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const s = await updateString(Number(id), body || {});
    if (!s) return NextResponse.json({ ok: false, error: '線種不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, string: s });
  } catch (err: any) {
    console.error('[AdminStrings PUT] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}

// 停用線種（保留歷史訂單）
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ok = await disableString(Number(id));
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: '線種不存在' }, { status: 404 });
  } catch (err: any) {
    console.error('[AdminStrings DELETE] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}

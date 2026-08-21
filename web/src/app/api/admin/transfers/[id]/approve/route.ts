import { NextResponse } from 'next/server';
import { approveTransfer } from '@/lib/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await approveTransfer(Number(id));
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}

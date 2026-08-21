import { NextResponse } from 'next/server';
import { updateTransferItems } from '@/lib/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    await updateTransferItems(
      Number(id),
      (body.items ?? []).map((i: any) => ({ id: Number(i.id), qty: Number(i.qty) }))
    );
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}

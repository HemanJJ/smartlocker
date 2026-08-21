import { NextResponse } from 'next/server';
import { receivePurchaseOrder } from '@/lib/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await receivePurchaseOrder(Number(id));
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}

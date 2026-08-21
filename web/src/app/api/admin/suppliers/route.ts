import { NextResponse } from 'next/server';
import { listSuppliers, upsertSupplier } from '@/lib/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const suppliers = await listSuppliers();
    return NextResponse.json({ ok: true, suppliers });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await upsertSupplier({
      id: body.id ? Number(body.id) : undefined,
      name: String(body.name ?? ''),
      lineId: String(body.lineId ?? ''),
      phone: String(body.phone ?? ''),
      note: String(body.note ?? ''),
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}

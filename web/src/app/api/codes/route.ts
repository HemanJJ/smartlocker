import { NextResponse } from 'next/server';
import { getStats } from '@/lib/pickup-code';

export const runtime = 'nodejs';

export async function GET() {
  const stats = await getStats();
  return NextResponse.json({ ok: true, ...stats });
}

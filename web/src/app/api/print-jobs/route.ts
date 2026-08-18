import { NextRequest, NextResponse } from 'next/server';
import { listPrintJobs } from '@/lib/stringing';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get('status');
    const jobs = await listPrintJobs(status === 'done' ? 'done' : 'pending');
    return NextResponse.json({ ok: true, jobs });
  } catch (err: any) {
    console.error('[PrintJobs] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

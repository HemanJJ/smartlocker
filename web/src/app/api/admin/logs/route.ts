import { NextResponse } from 'next/server';
import { listAdminLogs } from '@/lib/stringing';

export const runtime = 'nodejs';

// GET /api/admin/logs → 最近後台操作紀錄（登入/一鍵全開/清空…，責任追蹤）
export async function GET() {
  try {
    const logs = await listAdminLogs(100);
    return NextResponse.json({ ok: true, logs });
  } catch (err: any) {
    console.error('[AdminLogs] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

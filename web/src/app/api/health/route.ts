import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const runtime = 'edge';

/**
 * 健康檢查：測資料庫連線。
 * 供 UptimeRobot 打（https://smartlocker-alpha.vercel.app/api/health）。
 * 正常 200 { ok:true }；DB 掛了 500 { ok:false }。
 */
export async function GET() {
  try {
    const sql = getDb();
    await sql`SELECT 1`;
    return NextResponse.json({ ok: true, t: Date.now() });
  } catch {
    return NextResponse.json({ ok: false, error: 'db' }, { status: 500 });
  }
}

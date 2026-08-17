import { NextResponse } from 'next/server';
import { getVenueReport } from '@/lib/pickup-code';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const rows = await getVenueReport();
    const report = rows.map((r: any) => ({
      id: Number(r.id),
      slug: r.slug,
      name: r.name,
      defaultPrice: Number(r.default_price),
      totalRentals: Number(r.total_rentals),
      completedRentals: Number(r.completed_rentals),
      revenue: Number(r.revenue),
    }));
    const summary = {
      totalRevenue: report.reduce((s: number, r: any) => s + r.revenue, 0),
      totalRentals: report.reduce((s: number, r: any) => s + r.totalRentals, 0),
      totalCompleted: report.reduce((s: number, r: any) => s + r.completedRentals, 0),
    };
    return NextResponse.json({ ok: true, report, summary });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

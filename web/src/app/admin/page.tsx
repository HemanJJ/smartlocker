import { getVenueReport } from '@/lib/pickup-code';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminReportPage() {
  const rows = await getVenueReport();
  const report = rows.map((r: any) => ({
    name: r.name,
    slug: r.slug,
    defaultPrice: Number(r.default_price),
    totalRentals: Number(r.total_rentals),
    completedRentals: Number(r.completed_rentals),
    revenue: Number(r.revenue),
  }));
  const totalRevenue = report.reduce((s, r) => s + r.revenue, 0);
  const totalRentals = report.reduce((s, r) => s + r.totalRentals, 0);
  const totalCompleted = report.reduce((s, r) => s + r.completedRentals, 0);

  const cell: React.CSSProperties = {
    border: '1px solid #e5e7eb',
    padding: '10px 14px',
    textAlign: 'left',
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 16px', fontFamily: '-apple-system, sans-serif', color: '#333' }}>
      <h1 style={{ fontSize: '1.6rem', fontWeight: 700 }}>🏸 分店營收報表</h1>
      <p style={{ color: '#666', marginTop: 4 }}>羽拍有約 · 租拍系統（5 家分店）</p>

      <div style={{ display: 'flex', gap: 16, margin: '24px 0' }}>
        <Stat label="總營收" value={`NT$${totalRevenue.toLocaleString()}`} />
        <Stat label="總租借數" value={String(totalRentals)} />
        <Stat label="已完成取件" value={String(totalCompleted)} />
      </div>

      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
        <thead>
          <tr style={{ background: '#f5f5f5' }}>
            <th style={cell}>分店</th>
            <th style={cell}>預設租金</th>
            <th style={cell}>租借數</th>
            <th style={cell}>已完成</th>
            <th style={cell}>營收（已完成）</th>
          </tr>
        </thead>
        <tbody>
          {report.map((r) => (
            <tr key={r.slug}>
              <td style={cell}>{r.name}<div style={{ color: '#999', fontSize: 12 }}>{r.slug}</div></td>
              <td style={cell}>NT${r.defaultPrice}</td>
              <td style={cell}>{r.totalRentals}</td>
              <td style={cell}>{r.completedRentals}</td>
              <td style={{ ...cell, fontWeight: 700, color: '#06C755' }}>NT${r.revenue.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ marginTop: 16, color: '#999', fontSize: 12 }}>
        營收以「已取件（used）」的租借計價；預設租金可在 venues 表調整。
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ color: '#999', fontSize: 13 }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}

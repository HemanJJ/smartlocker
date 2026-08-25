'use client';

import Link from 'next/link';

export default function AdminNav({ current }: { current?: string }) {
  const items: [string, string, string][] = [
    ['/', '🏠 首頁', 'home'],
    ['/admin', '🧵 穿線', 'orders'],
    ['/admin/inventory', '📦 庫存', 'inventory'],
    ['/admin/transfers', '📤 配貨', 'transfers'],
    ['/admin/purchase-orders', '📥 進貨', 'purchase'],
    ['/admin/stocktakes', '🔢 盤點', 'stocktakes'],
    ['/admin/reports', '📊 報表', 'reports'],
    ['/admin/suppliers', '🚚 供應商', 'suppliers'],
    ['/admin/password', '🔑 改密碼', 'password'],
  ];
  return (
    <nav style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14, fontSize: 13 }}>
      {items.map(([href, label, key]) => (
        <Link
          key={key}
          href={href}
          style={{
            padding: '6px 12px', borderRadius: 8, textDecoration: 'none',
            background: current === key ? '#06C755' : '#fff',
            color: current === key ? '#fff' : '#555',
            border: '1px solid #ddd',
          }}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

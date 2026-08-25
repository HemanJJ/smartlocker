'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminNav from '@/components/AdminNav';
import VenueSwitcher from '@/components/VenueSwitcher';

interface Item {
  sku: string; name: string; category: string; price: number;
  cost_price: number; qty: number; min_qty: number; expiry_date: string | null;
}

export default function AdminReportsPage() {
  const [data, setData] = useState<{
    items: Item[]; totals: { stockValue: number; potentialProfit: number };
    lowStock: { sku: string; name: string; qty: number; minQty: number }[];
    expiringSoon: { sku: string; name: string; expiryDate: string; days: number }[];
  } | null>(null);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [venueId, setVenueId] = useState(1);

  const load = useCallback(async (vid: number) => {
    const res = await fetch(`/api/admin/reports?venue=${vid}`);
    if (res.status === 401) { window.location.href = '/admin/login'; return; }
    const j = await res.json();
    setData(j);
    setLoading(false);
  }, []);

  useEffect(() => {
    const v = Number(localStorage.getItem('skb_venue') || 1);
    setVenueId(v);
    load(v);
  }, [load]);

  async function checkStock() {
    const res = await fetch('/api/admin/stock-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ venueId }) });
    const j = await res.json();
    setMsg(j.notified > 0 ? `✅ 已推 LINE 給老闆（${j.notified} 項低庫存）` : 'ℹ️ 沒有低於安全存量的商品');
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px 64px', fontFamily: '-apple-system, sans-serif', color: '#333', background: '#f5f5f5' }}>
      <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: '#06C755' }}>📊 進銷存報表</h1>
      <div style={{ marginTop: 10 }}>
        <VenueSwitcher onVenueChange={(v) => { setVenueId(v); load(v); }} />
      </div>
      <AdminNav current="reports" />
      {msg && <p style={{ marginTop: 10, fontSize: 14 }}>{msg}</p>}

      <button onClick={checkStock} style={{ marginTop: 16, padding: '10px 16px', borderRadius: 10, border: 'none', background: '#06C755', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
        📲 檢查安全存量並 LINE 通知老闆
      </button>

      {loading && <p style={{ marginTop: 20, color: '#999' }}>載入中…</p>}

      {data && (
        <>
          <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Stat label="庫存成本（進價×數量）" value={`NT$${data.totals.stockValue}`} color="#3b82f6" />
            <Stat label="潛在毛利（賣光的話）" value={`NT$${data.totals.potentialProfit}`} color="#06C755" />
            <Stat label="低於安全存量" value={data.lowStock.length} color="#f59e0b" />
            <Stat label="14 天內過期" value={data.expiringSoon.length} color="#e5484d" />
          </div>

          {data.lowStock.length > 0 && (
            <div style={{ marginTop: 16, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: 12, fontSize: 13 }}>
              ⚠️ 低庫存：{data.lowStock.map((l) => `${l.name}(${l.qty}/${l.minQty})`).join('、')} → 去「進貨」一鍵補
            </div>
          )}
          {data.expiringSoon.length > 0 && (
            <div style={{ marginTop: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 12, fontSize: 13 }}>
              ⏰ 快過期：{data.expiringSoon.map((e) => `${e.name}(${e.expiryDate}，剩${e.days}天)`).join('、')}
            </div>
          )}

          <div style={{ marginTop: 16, background: '#fff', borderRadius: 16, padding: 14, boxShadow: '0 2px 8px rgba(0,0,0,.05)' }}>
            {data.items.map((i) => (
              <div key={i.sku} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f0f0f0', fontSize: 14 }}>
                <span style={{ flex: 1 }}>{i.name}</span>
                <span style={{ color: '#888', fontSize: 12 }}>進 {i.cost_price}</span>
                <span>售 {i.price}</span>
                <span style={{ color: '#06C755', fontWeight: 700 }}>毛利 {i.price - i.cost_price}/件</span>
                <span style={{ color: i.qty <= i.min_qty && i.min_qty > 0 ? '#f59e0b' : '#555', fontWeight: i.qty <= i.min_qty && i.min_qty > 0 ? 700 : 400 }}>
                  {i.qty}{i.min_qty > 0 ? ` / 安全 ${i.min_qty}` : ''}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{ flex: '1 1 140px', minWidth: 130, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ color: '#999', fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: '1.3rem', fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

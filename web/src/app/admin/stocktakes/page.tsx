'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminNav from '@/components/AdminNav';
import VenueSwitcher from '@/components/VenueSwitcher';

interface Item { sku: string; name: string; qty: number; }

export default function AdminStocktakesPage() {
  const [catalog, setCatalog] = useState<Item[]>([]);
  const [actuals, setActuals] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [venueId, setVenueId] = useState(1);

  const load = useCallback(async (vid: number) => {
    const res = await fetch(`/api/admin/stocktakes?venue=${vid}`);
    if (res.status === 401) { window.location.href = '/admin/login'; return; }
    const j = await res.json();
    const cat = (j.catalog ?? []) as Item[];
    setCatalog(cat);
    const init: Record<string, number> = {};
    cat.forEach((i) => { init[i.sku] = i.qty; });
    setActuals(init);
    setLoading(false);
  }, []);

  useEffect(() => {
    const v = Number(localStorage.getItem('skb_venue') || 1);
    setVenueId(v);
    load(v);
  }, [load]);

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    const items = catalog.map((c) => ({ sku: c.sku, name: c.name, actualQty: actuals[c.sku] ?? 0 }));
    const res = await fetch('/api/admin/stocktakes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venueId, note, items }),
    });
    const j = await res.json();
    setMsg(res.ok ? `✅ 盤點完成，已套用 ${j.applied} 項（差異即調整庫存）` : `❌ ${j.error || '失敗'}`);
    load(venueId);
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px 64px', fontFamily: '-apple-system, sans-serif', color: '#333', background: '#f5f5f5' }}>
      <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: '#06C755' }}>🔢 盤點</h1>
      <div style={{ marginTop: 10 }}>
        <VenueSwitcher onVenueChange={(v) => { setVenueId(v); load(v); }} />
      </div>
      <AdminNav current="stocktakes" />
      {msg && <p style={{ marginTop: 10, fontSize: 14 }}>{msg}</p>}

      <form onSubmit={apply} style={{ marginTop: 16, background: '#fff', borderRadius: 16, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,.05)' }}>
        <input placeholder="盤點備註（選填）" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inp, width: '100%' }} />
        {loading && <p style={{ marginTop: 12, color: '#999' }}>載入中…</p>}
        {!loading && catalog.map((c) => (
          <div key={c.sku} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <span style={{ flex: 1, fontSize: 14 }}>{c.name}</span>
            <span style={{ fontSize: 12, color: '#999' }}>系統 {c.qty}</span>
            <input type="number" value={actuals[c.sku] ?? 0}
              onChange={(e) => setActuals({ ...actuals, [c.sku]: Number(e.target.value) })}
              style={{ ...inp, width: 80 }} />
          </div>
        ))}
        <button type="submit" style={{ ...btn, background: '#06C755', marginTop: 16, width: '100%' }}>
          套用盤點（差異即調整庫存）
        </button>
      </form>
    </div>
  );
}

const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 14, borderRadius: 8, border: '1px solid #ddd', boxSizing: 'border-box' };
const btn: React.CSSProperties = { padding: '10px 14px', fontSize: 15, fontWeight: 700, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' };

'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminNav from '@/components/AdminNav';

interface Item { sku: string; name: string; price: number; qty: number; }
interface Line { sku: string; name: string; qty: number; }
interface Transfer {
  id: number; fromName: string; toName: string; note: string; created_at: string;
  items: { sku: string; name: string; qty: number }[];
}

export default function AdminTransfersPage() {
  const [venues, setVenues] = useState<{ id: number; name: string }[]>([]);
  const [warehouse, setWarehouse] = useState<Item[]>([]);
  const [history, setHistory] = useState<Transfer[]>([]);
  const [fromVenueId, setFromVenueId] = useState(1);
  const [toVenueId, setToVenueId] = useState(0);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const [vRes, wRes, hRes] = await Promise.all([
      fetch('/api/venues'),
      fetch('/api/admin/inventory?venue=1'),
      fetch('/api/admin/transfers'),
    ]);
    const vJ = await vRes.json();
    const wJ = await wRes.json();
    const hJ = await hRes.json();
    setVenues(vJ.venues ?? []);
    setWarehouse(wJ.items ?? []);
    setHistory(hJ.transfers ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  function addLine() {
    setLines([...lines, { sku: '', name: '', qty: 0 }]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!toVenueId) { setMsg('請選要配到哪家店'); return; }
    const res = await fetch('/api/admin/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromVenueId, toVenueId, note, items: lines }),
    });
    const j = await res.json();
    setMsg(res.ok ? `✅ 已配貨 ${j.moved} 項（庫存已移動）` : `❌ ${j.error || '失敗'}`);
    setLines([]); setNote('');
    load();
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px 64px', fontFamily: '-apple-system, sans-serif', color: '#333' }}>
      <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: '#06C755' }}>📤 配貨到店</h1>
      <AdminNav current="transfers" />
      {msg && <p style={{ marginTop: 10, fontSize: 14 }}>{msg}</p>}

      <form onSubmit={submit} style={{ marginTop: 16, background: '#fff', borderRadius: 16, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,.05)' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 14 }}>從</span>
          <select value={fromVenueId} onChange={(e) => setFromVenueId(Number(e.target.value))} style={inp}>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <span style={{ fontSize: 14 }}>配到</span>
          <select value={toVenueId} onChange={(e) => setToVenueId(Number(e.target.value))} style={inp}>
            <option value={0}>— 選店家 * —</option>
            {venues.filter((v) => v.id !== fromVenueId).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <input placeholder="備註（選填）" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inp, width: 160 }} />
          <button type="button" onClick={addLine} style={{ ...btn, background: '#9ca3af' }}>＋ 加一行</button>
          <button type="submit" style={{ ...btn, background: '#06C755' }}>📤 配貨</button>
        </div>

        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <select value={l.sku} onChange={(e) => {
              const it = warehouse.find((w) => w.sku === e.target.value);
              l.sku = e.target.value; l.name = it?.name ?? '';
              setLines([...lines]);
            }} style={{ ...inp, width: 240 }}>
              <option value="">— 選商品（總倉現有）—</option>
              {warehouse.filter((w) => w.qty > 0).map((w) => (
                <option key={w.sku} value={w.sku}>{w.name}（庫存 {w.qty}）</option>
              ))}
            </select>
            <input type="number" placeholder="數量" value={l.qty} onChange={(e) => { l.qty = Number(e.target.value); setLines([...lines]); }} style={{ ...inp, width: 90 }} />
            <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))} style={{ ...btn, background: '#e5484d' }}>✕</button>
          </div>
        ))}
        <p style={{ marginTop: 10, fontSize: 12, color: '#999' }}>配貨＝總倉庫存減少、店家庫存增加（內部移動，不是買賣）</p>
      </form>

      {history.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>📋 配貨紀錄</h2>
          {history.map((t) => (
            <div key={t.id} style={{ marginTop: 10, background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 2px 8px rgba(0,0,0,.05)', fontSize: 14 }}>
              <div style={{ fontWeight: 700 }}>{t.fromName} → {t.toName} <span style={{ fontWeight: 400, color: '#999' }}>{t.created_at?.slice(0, 16)}</span></div>
              <div style={{ color: '#555', marginTop: 4 }}>{t.items.map((i) => `${i.name} ×${i.qty}`).join('、')}</div>
              {t.note && <div style={{ color: '#888', fontSize: 13, marginTop: 2 }}>備註：{t.note}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 14, borderRadius: 8, border: '1px solid #ddd', boxSizing: 'border-box' };
const btn: React.CSSProperties = { padding: '8px 14px', fontSize: 14, fontWeight: 700, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' };

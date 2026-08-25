'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminNav from '@/components/AdminNav';
import VenueSwitcher from '@/components/VenueSwitcher';

interface Item { sku: string; name: string; price: number; qty: number; }
interface Line { sku: string; name: string; qty: number; }
interface Need { sku: string; name: string; qty: number; minQty: number; suggestQty: number; }
interface TItem { id: number; sku: string; name: string; qty: number; }
interface Transfer {
  id: number; fromName: string; toName: string; note: string; status: string; created_at: string;
  items: TItem[];
}

const STATUS_LABEL: Record<string, string> = {
  draft: '📝 待審核', approved: '✅ 已配送', rejected: '❌ 已退回',
};

export default function AdminTransfersPage() {
  const [venues, setVenues] = useState<{ id: number; name: string }[]>([]);
  const [warehouse, setWarehouse] = useState<Item[]>([]);
  const [history, setHistory] = useState<Transfer[]>([]);
  const [needs, setNeeds] = useState<Need[]>([]);
  const [demandVenue, setDemandVenue] = useState(1);
  const [fromVenueId, setFromVenueId] = useState(1);
  const [toVenueId, setToVenueId] = useState(0);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async (vid: number) => {
    const [vRes, wRes, hRes, nRes] = await Promise.all([
      fetch('/api/venues'),
      fetch('/api/admin/inventory?venue=1'),
      fetch('/api/admin/transfers'),
      fetch(`/api/admin/replenish?venue=${vid}`),
    ]);
    const vJ = await vRes.json();
    const wJ = await wRes.json();
    const hJ = await hRes.json();
    const nJ = await nRes.json();
    setVenues(vJ.venues ?? []);
    setWarehouse(wJ.items ?? []);
    setHistory(hJ.transfers ?? []);
    setNeeds(nJ.needs ?? []);
  }, []);

  useEffect(() => {
    const v = Number(localStorage.getItem('skb_venue') || 1);
    setDemandVenue(v);
    load(v);
  }, [load]);

  function addLine() {
    setLines([...lines, { sku: '', name: '', qty: 0 }]);
  }

  async function createDraft(payload: any, okMsg: string) {
    const res = await fetch('/api/admin/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await res.json();
    setMsg(res.ok ? okMsg : `❌ ${j.error || '失敗'}`);
    return res.ok;
  }

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    if (!toVenueId) { setMsg('請選要配到哪家店'); return; }
    const ok = await createDraft(
      { fromVenueId, toVenueId, note, items: lines },
      `✅ 已建立配貨草稿（需人工審核後才配送）`
    );
    if (ok) { setLines([]); setNote(''); load(demandVenue); }
  }

  /** 需求單 → 一鍵轉配貨草稿（總倉 → 目前分店） */
  async function needsToDraft() {
    if (needs.length === 0) { setMsg('目前沒有低於安全存量的商品'); return; }
    const ok = await createDraft(
      { fromVenueId: 1, toVenueId: demandVenue, note: '需求單自動', items: needs.map((n) => ({ sku: n.sku, name: n.name, qty: n.suggestQty })) },
      `✅ 已把 ${needs.length} 項需求轉成配貨草稿（待審核）`
    );
    if (ok) load(demandVenue);
  }

  async function approve(t: Transfer) {
    setBusy(t.id);
    const res = await fetch(`/api/admin/transfers/${t.id}/approve`, { method: 'POST' });
    const j = await res.json();
    setMsg(res.ok ? '✅ 已核准・完成配送（庫存已移動＋LINE 通知）' : `❌ ${j.error || '失敗'}`);
    setBusy(null);
    load(demandVenue);
  }

  async function reject(t: Transfer) {
    setBusy(t.id);
    const res = await fetch(`/api/admin/transfers/${t.id}/reject`, { method: 'POST' });
    const j = await res.json();
    setMsg(res.ok ? '❌ 已退回' : `❌ ${j.error || '失敗'}`);
    setBusy(null);
    load(demandVenue);
  }

  async function saveQty(t: Transfer) {
    setBusy(t.id);
    const res = await fetch(`/api/admin/transfers/${t.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: t.items.map((i) => ({ id: i.id, qty: i.qty })) }),
    });
    setMsg(res.ok ? '✅ 數量已更新' : `❌ ${(await res.json()).error || '失敗'}`);
    setBusy(null);
    load(demandVenue);
  }

  const drafts = history.filter((t) => t.status === 'draft');
  const others = history.filter((t) => t.status !== 'draft');

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px 64px', fontFamily: '-apple-system, sans-serif', color: '#333', background: '#f5f5f5' }}>
      <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: '#06C755' }}>📤 配貨到店</h1>
      <div style={{ marginTop: 10 }}>
        <VenueSwitcher onVenueChange={(v) => { setDemandVenue(v); load(v); }} />
      </div>
      <AdminNav current="transfers" />
      {msg && <p style={{ marginTop: 10, fontSize: 14 }}>{msg}</p>}

      {/* 需求單（自動補貨建議） */}
      <div style={{ marginTop: 16, background: needs.length ? '#fff7ed' : '#fff', border: needs.length ? '1px solid #fed7aa' : '1px solid #e5e7eb', borderRadius: 16, padding: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>📋 需求單（安全存量 → 缺貨 → 建議補貨）</h2>
        {needs.length === 0 ? (
          <p style={{ fontSize: 13, color: '#999', marginTop: 8 }}>目前沒有低於安全存量的商品 ✅</p>
        ) : (
          <>
            {needs.map((n) => (
              <div key={n.sku} style={{ display: 'flex', gap: 10, fontSize: 14, padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span style={{ flex: 1 }}>{n.name}</span>
                <span style={{ color: '#888' }}>庫存 {n.qty} / 安全 {n.minQty}</span>
                <span style={{ color: '#f59e0b', fontWeight: 700 }}>建議補 {n.suggestQty}</span>
              </div>
            ))}
            <button onClick={needsToDraft} style={{ marginTop: 10, padding: '10px 18px', borderRadius: 10, border: 'none', background: '#f59e0b', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
              🔄 一鍵轉配貨單（草稿，待審核）
            </button>
          </>
        )}
      </div>

      {/* 手動建配貨草稿 */}
      <form onSubmit={submitManual} style={{ marginTop: 16, background: '#fff', borderRadius: 16, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,.05)' }}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>手動配貨（建草稿，審核後才配送）</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
          <span style={{ fontSize: 14 }}>從</span>
          <select value={fromVenueId} onChange={(e) => setFromVenueId(Number(e.target.value))} style={inp}>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <span style={{ fontSize: 14 }}>配到</span>
          <select value={toVenueId} onChange={(e) => setToVenueId(Number(e.target.value))} style={inp}>
            <option value={0}>— 選店家 * —</option>
            {venues.filter((v) => v.id !== fromVenueId).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <input placeholder="備註（選填）" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inp, width: 150 }} />
          <button type="button" onClick={addLine} style={{ ...btn, background: '#9ca3af' }}>＋ 加一行</button>
          <button type="submit" style={{ ...btn, background: '#06C755' }}>建配貨草稿</button>
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
      </form>

      {/* 待審核 */}
      {drafts.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>⏳ 待審核（{drafts.length}）</h2>
          {drafts.map((t) => (
            <div key={t.id} style={{ marginTop: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 14, padding: 14, fontSize: 14 }}>
              <div style={{ fontWeight: 700 }}>{t.fromName} → {t.toName} <span style={{ fontWeight: 400, color: '#999' }}>{t.created_at?.slice(0, 16)}</span></div>
              {t.items.map((i) => (
                <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <span style={{ flex: 1 }}>{i.name}</span>
                  <span style={{ color: '#999', fontSize: 12 }}>數量</span>
                  <input type="number" min={1} value={i.qty}
                    onChange={(e) => { i.qty = Number(e.target.value); setHistory([...history]); }}
                    style={{ ...inp, width: 70 }} />
                </div>
              ))}
              {t.note && <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>備註：{t.note}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={() => saveQty(t)} disabled={busy === t.id} style={{ ...btn, background: '#9ca3af' }}>存數量</button>
                <button onClick={() => reject(t)} disabled={busy === t.id} style={{ ...btn, background: '#e5484d' }}>退回</button>
                <button onClick={() => approve(t)} disabled={busy === t.id} style={{ ...btn, background: '#06C755' }}>✅ 核准・配送</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 歷史 */}
      {others.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>📋 配貨紀錄</h2>
          {others.map((t) => (
            <div key={t.id} style={{ marginTop: 10, background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 2px 8px rgba(0,0,0,.05)', fontSize: 14 }}>
              <div style={{ fontWeight: 700 }}>{t.fromName} → {t.toName} <span style={{ fontWeight: 400, color: '#999' }}>{STATUS_LABEL[t.status] || t.status} · {t.created_at?.slice(0, 16)}</span></div>
              <div style={{ color: '#555', marginTop: 4 }}>{t.items.map((i) => `${i.name} ×${i.qty}`).join('、')}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 14, borderRadius: 8, border: '1px solid #ddd', boxSizing: 'border-box' };
const btn: React.CSSProperties = { padding: '8px 14px', fontSize: 14, fontWeight: 700, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' };

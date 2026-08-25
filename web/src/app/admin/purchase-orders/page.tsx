'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminNav from '@/components/AdminNav';
import VenueSwitcher from '@/components/VenueSwitcher';

interface Supplier { id: number; name: string; lineId: string; }
interface LowStock { sku: string; name: string; qty: number; minQty: number; }
interface OrderItem { sku: string; name: string; qty: number; unitCost: number; }
interface Order {
  id: number; orderNo: string; supplierName: string; status: string;
  totalCost: number; note: string; created_at: string;
  items: { sku: string; name: string; qty: number; unit_cost: number }[];
}

export default function AdminPurchaseOrdersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [lowStock, setLowStock] = useState<LowStock[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [supplierId, setSupplierId] = useState(0);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [venueId, setVenueId] = useState(1);

  const load = useCallback(async (vid: number) => {
    const [sRes, oRes] = await Promise.all([
      fetch('/api/admin/suppliers'),
      fetch(`/api/admin/purchase-orders?venue=${vid}`),
    ]);
    if (oRes.status === 401) { window.location.href = '/admin/login'; return; }
    const sJ = await sRes.json();
    const oJ = await oRes.json();
    setSuppliers(sJ.suppliers ?? []);
    setOrders(oJ.orders ?? []);
    setLowStock(oJ.lowStock ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const v = Number(localStorage.getItem('skb_venue') || 1);
    setVenueId(v);
    load(v);
  }, [load]);

  function addRow() {
    setItems([...items, { sku: '', name: '', qty: 1, unitCost: 0 }]);
  }

  /** 需求轉訂：低庫存商品一鍵帶入，建議量 = 安全存量×2 − 目前 */
  function loadLowStock() {
    setItems(lowStock.map((l) => ({
      sku: l.sku, name: l.name,
      qty: Math.max(1, l.minQty * 2 - l.qty),
      unitCost: 0,
    })));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) { setMsg('請選供應商'); return; }
    const res = await fetch('/api/admin/purchase-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supplierId, venueId, note, items }),
    });
    const j = await res.json();
    setMsg(res.ok ? `✅ 已建立 ${j.orderNo}（草稿，貨到按入庫）` : `❌ ${j.error || '失敗'}`);
    setItems([]); setNote('');
    load(venueId);
  }

  async function receive(id: number) {
    const res = await fetch(`/api/admin/purchase-orders/${id}/receive`, { method: 'POST' });
    const j = await res.json();
    setMsg(res.ok ? '✅ 已入庫（庫存＋成本已更新）' : `❌ ${j.error || '失敗'}`);
    load(venueId);
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px 64px', fontFamily: '-apple-system, sans-serif', color: '#333', background: '#f5f5f5' }}>
      <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: '#06C755' }}>📥 進貨單</h1>
      <div style={{ marginTop: 10 }}>
        <VenueSwitcher onVenueChange={(v) => { setVenueId(v); load(v); }} />
      </div>
      <AdminNav current="purchase" />
      {msg && <p style={{ marginTop: 10, fontSize: 14 }}>{msg}</p>}

      {lowStock.length > 0 && (
        <div style={{ marginTop: 14, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: 12, fontSize: 13 }}>
          ⚠️ 低於安全存量：{lowStock.map((l) => `${l.name}(${l.qty}/${l.minQty})`).join('、')}
          <button onClick={loadLowStock} style={{ marginLeft: 10, padding: '6px 12px', borderRadius: 8, border: 'none', background: '#f59e0b', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            一鍵帶入補貨
          </button>
        </div>
      )}

      <form onSubmit={create} style={{ marginTop: 16, background: '#fff', borderRadius: 16, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,.05)' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={supplierId} onChange={(e) => setSupplierId(Number(e.target.value))} style={inp}>
            <option value={0}>— 選供應商 * —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.lineId ? `（LINE:${s.lineId}）` : ''}</option>)}
          </select>
          <input placeholder="備註（選填）" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inp, width: 200 }} />
          <button type="button" onClick={addRow} style={{ ...btn, background: '#9ca3af' }}>＋ 加一行</button>
          <button type="submit" style={{ ...btn, background: '#06C755' }}>建立進貨單</button>
        </div>

        {items.map((it, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <input placeholder="SKU" value={it.sku} onChange={(e) => { it.sku = e.target.value; setItems([...items]); }} style={{ ...inp, width: 110 }} />
            <input placeholder="名稱" value={it.name} onChange={(e) => { it.name = e.target.value; setItems([...items]); }} style={{ ...inp, width: 180 }} />
            <input type="number" placeholder="數量" value={it.qty} onChange={(e) => { it.qty = Number(e.target.value); setItems([...items]); }} style={{ ...inp, width: 70 }} />
            <input type="number" placeholder="進價" value={it.unitCost} onChange={(e) => { it.unitCost = Number(e.target.value); setItems([...items]); }} style={{ ...inp, width: 80 }} />
            <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))} style={{ ...btn, background: '#e5484d' }}>✕</button>
          </div>
        ))}
      </form>

      {loading && <p style={{ marginTop: 20, color: '#999' }}>載入中…</p>}
      {!loading && orders.map((o) => (
        <div key={o.id} style={{ marginTop: 12, background: '#fff', borderRadius: 16, padding: 14, boxShadow: '0 2px 8px rgba(0,0,0,.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontWeight: 700 }}>{o.orderNo}</span>
            <span style={{ fontSize: 13, color: '#666' }}>{o.supplierName} · {o.status === 'received' ? '✅ 已入庫' : o.status === 'draft' ? '📝 草稿' : o.status}</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: '#555' }}>
            {o.items.map((i) => `${i.name} ×${i.qty}（@${i.unit_cost}）`).join('、')}
            <span style={{ fontWeight: 700 }}>　合計 NT${o.totalCost}</span>
          </div>
          {o.status !== 'received' && (
            <button onClick={() => receive(o.id)} style={{ ...btn, background: '#06C755', marginTop: 8 }}>📦 入庫</button>
          )}
        </div>
      ))}
    </div>
  );
}

const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 14, borderRadius: 8, border: '1px solid #ddd', boxSizing: 'border-box' };
const btn: React.CSSProperties = { padding: '8px 14px', fontSize: 14, fontWeight: 700, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' };

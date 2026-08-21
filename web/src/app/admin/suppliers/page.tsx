'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminNav from '@/components/AdminNav';

interface Supplier {
  id: number;
  name: string;
  lineId: string;
  phone: string;
  note: string;
}

export default function AdminSuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ name: '', lineId: '', phone: '', note: '' });

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/suppliers');
    if (res.status === 401) { window.location.href = '/admin/login'; return; }
    const j = await res.json();
    setSuppliers(j.suppliers ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setMsg('名稱必填'); return; }
    const res = await fetch('/api/admin/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setMsg(res.ok ? `✅ 已新增 ${form.name}` : '❌ 新增失敗');
    setForm({ name: '', lineId: '', phone: '', note: '' });
    load();
  }

  async function saveRow(s: Supplier) {
    const res = await fetch('/api/admin/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    });
    setMsg(res.ok ? `✅ ${s.name} 已更新` : '❌ 儲存失敗');
    load();
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px 64px', fontFamily: '-apple-system, sans-serif', color: '#333' }}>
      <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: '#06C755' }}>🚚 供應商</h1>
      <AdminNav current="suppliers" />
      {msg && <p style={{ marginTop: 10, fontSize: 14 }}>{msg}</p>}

      <form onSubmit={add} style={{ marginTop: 20, background: '#fff', borderRadius: 16, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,.05)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input placeholder="供應商名稱 *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inp} />
        <input placeholder="LINE ID（以後可一鍵轉訂單）" value={form.lineId} onChange={(e) => setForm({ ...form, lineId: e.target.value })} style={{ ...inp, width: 200 }} />
        <input placeholder="電話" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={{ ...inp, width: 130 }} />
        <input placeholder="備註" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={{ ...inp, width: 130 }} />
        <button type="submit" style={{ ...btn, background: '#06C755' }}>＋ 新增</button>
      </form>

      {loading && <p style={{ marginTop: 20, color: '#999' }}>載入中…</p>}
      {!loading && suppliers.map((s) => (
        <div key={s.id} style={{ marginTop: 12, background: '#fff', borderRadius: 16, padding: 14, boxShadow: '0 2px 8px rgba(0,0,0,.05)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={s.name} onChange={(e) => { s.name = e.target.value; setSuppliers([...suppliers]); }} style={inp} />
          <input value={s.lineId} onChange={(e) => { s.lineId = e.target.value; setSuppliers([...suppliers]); }} placeholder="LINE ID" style={{ ...inp, width: 180 }} />
          <input value={s.phone} onChange={(e) => { s.phone = e.target.value; setSuppliers([...suppliers]); }} style={{ ...inp, width: 120 }} />
          <input value={s.note} onChange={(e) => { s.note = e.target.value; setSuppliers([...suppliers]); }} style={{ ...inp, width: 120 }} />
          <button onClick={() => saveRow(s)} style={{ ...btn, background: '#3b82f6' }}>儲存</button>
        </div>
      ))}

      <p style={{ marginTop: 20, fontSize: 12, color: '#999' }}>
        💡 LINE ID 填好後，以後進貨單可「一鍵轉訂單」直接傳給供應商（功能 Phase 2 開放）
      </p>
    </div>
  );
}

const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 14, borderRadius: 8, border: '1px solid #ddd', boxSizing: 'border-box' };
const btn: React.CSSProperties = { padding: '8px 14px', fontSize: 14, fontWeight: 700, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' };

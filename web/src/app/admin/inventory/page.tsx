'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminNav from '@/components/AdminNav';
import VenueSwitcher from '@/components/VenueSwitcher';

interface Item {
  sku: string;
  name: string;
  category: string;
  price: number;
  costPrice: number;
  minQty: number;
  qty: number;
  status: string;
  cabinetId: string;
  slotNo: number;
}

interface Tier {
  id: number;
  sku: string;
  minQty: number;
  tierType: string;
  percent: number | null;
  unitPrice: number | null;
}

const CATS = ['badminton', 'ramen', 'other'];

export default function AdminInventoryPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const [newItem, setNewItem] = useState({ sku: '', name: '', category: 'badminton', price: 0, qty: 0 });
  const [venueId, setVenueId] = useState(1);
  // 量價階梯
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [tierForm, setTierForm] = useState({ applyTo: 'single', category: 'badminton', sku: '', minQty: 50, tierType: 'percent', percent: 80, unitPrice: 0 });

  const load = useCallback(async (vid: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/inventory?venue=${vid}`);
      if (res.status === 401) { window.location.href = '/admin/login'; return; }
      const j = await res.json();
      setItems(j.items ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTiers = useCallback(async () => {
    const res = await fetch('/api/admin/price-tiers');
    if (res.status === 401) return;
    const j = await res.json();
    setTiers(j.tiers ?? []);
  }, []);

  useEffect(() => { loadTiers(); }, [loadTiers]);

  useEffect(() => {
    const v = Number(localStorage.getItem('skb_venue') || 1);
    setVenueId(v);
    load(v);
  }, [load]);

  async function save(it: Item) {
    setMsg('');
    const res = await fetch('/api/admin/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...it, venueId }),
    });
    setMsg(res.ok ? `✅ ${it.sku} 已存（${it.name}）` : '❌ 儲存失敗');
    load(venueId);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!newItem.sku.trim() || !newItem.name.trim()) { setMsg('SKU 與名稱必填'); return; }
    const res = await fetch('/api/admin/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newItem, status: 'on_shelf', cabinetId: 'df-f', slotNo: 0, venueId }),
    });
    setMsg(res.ok ? `✅ 已新增 ${newItem.sku}` : '❌ 新增失敗');
    setNewItem({ sku: '', name: '', category: 'badminton', price: 0, qty: 0 });
    load(venueId);
  }

  async function saveTier(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/admin/price-tiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: tierForm.applyTo === 'single' ? tierForm.sku : '',
        minQty: tierForm.minQty,
        tierType: tierForm.tierType,
        percent: tierForm.tierType === 'percent' ? tierForm.percent : undefined,
        unitPrice: tierForm.tierType === 'unit_price' ? tierForm.unitPrice : undefined,
        applyTo: tierForm.applyTo,
        category: tierForm.applyTo === 'category' ? tierForm.category : undefined,
      }),
    });
    const j = await res.json();
    setMsg(res.ok ? `✅ 階梯已設定（套用 ${j.applied ?? 1} 個商品）` : `❌ ${j.error || '失敗'}`);
    loadTiers();
  }

  async function removeTier(id: number) {
    const res = await fetch('/api/admin/price-tiers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setMsg(res.ok ? '✅ 階梯已刪除' : '❌ 刪除失敗');
    loadTiers();
  }

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  }

  return (
    <div style={{
      minHeight: '100vh', fontFamily: '-apple-system, sans-serif',
      background: '#f5f5f5', color: '#333', padding: '32px 16px 60px',
    }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: '#06C755' }}>📦 販售庫存</h1>          <div style={{ display: 'flex', gap: 10 }}>
            <a href="/admin" style={{ color: '#06C755', fontSize: 14, textDecoration: 'none' }}>穿線後台 →</a>
            <a href="/admin/password" style={{ color: '#666', fontSize: 13, textDecoration: 'none' }}>🔑 改密碼</a>
            <button onClick={logout} style={{ border: 'none', background: 'none', color: '#999', fontSize: 13, cursor: 'pointer' }}>登出</button>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <VenueSwitcher onVenueChange={(v) => { setVenueId(v); load(v); }} />
        </div>
        <AdminNav current="inventory" />

        {msg && <p style={{ marginTop: 10, fontSize: 14, color: '#333' }}>{msg}</p>}

        {/* 量價階梯（批發折扣，後台動態設定） */}
        <div style={{ marginTop: 20, background: '#fff', borderRadius: 16, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,.05)' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>🏷️ 量價階梯（批發折扣）</h2>
          <form onSubmit={saveTier} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
            <select value={tierForm.applyTo} onChange={(e) => setTierForm({ ...tierForm, applyTo: e.target.value })}
              style={inputStyle}>
              <option value="single">單一商品</option>
              <option value="category">整個分類</option>
              <option value="all">全部商品</option>
            </select>
            {tierForm.applyTo === 'single' && (
              <input placeholder="SKU" value={tierForm.sku} onChange={(e) => setTierForm({ ...tierForm, sku: e.target.value })} style={{ ...inputStyle, width: 110 }} />
            )}
            {tierForm.applyTo === 'category' && (
              <select value={tierForm.category} onChange={(e) => setTierForm({ ...tierForm, category: e.target.value })} style={{ ...inputStyle, width: 110 }}>
                {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <input type="number" placeholder="滿幾件" value={tierForm.minQty} onChange={(e) => setTierForm({ ...tierForm, minQty: Number(e.target.value) })} style={{ ...inputStyle, width: 80 }} />
            <select value={tierForm.tierType} onChange={(e) => setTierForm({ ...tierForm, tierType: e.target.value })}
              style={{ ...inputStyle, width: 110 }}>
              <option value="percent">打幾折(%)</option>
              <option value="unit_price">直接單價</option>
            </select>
            {tierForm.tierType === 'percent' ? (
              <input type="number" placeholder="如 80 = 8折" value={tierForm.percent} onChange={(e) => setTierForm({ ...tierForm, percent: Number(e.target.value) })} style={{ ...inputStyle, width: 90 }} />
            ) : (
              <input type="number" placeholder="單價" value={tierForm.unitPrice} onChange={(e) => setTierForm({ ...tierForm, unitPrice: Number(e.target.value) })} style={{ ...inputStyle, width: 90 }} />
            )}
            <button type="submit" style={{ ...btnStyle, background: '#f59e0b' }}>＋ 設定</button>
          </form>

          {(() => {
            // 只顯示「目前分店有在賣」的商品的階梯，依商品分組濃縮
            const skus = new Set(items.map((i) => i.sku));
            const visible = tiers.filter((t) => skus.has(t.sku));
            const groups: Record<string, Tier[]> = {};
            visible.forEach((t) => { (groups[t.sku] = groups[t.sku] || []).push(t); });
            const names: Record<string, string> = {};
            items.forEach((i) => { names[i.sku] = i.name; });
            return (
              <div style={{ marginTop: 12 }}>
                {Object.entries(groups).map(([sku, ts]) => (
                  <div key={sku} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0', fontSize: 14 }}>
                    <span style={{ fontWeight: 700 }}>{names[sku] || sku}</span>
                    <span style={{ marginLeft: 8, color: '#06C755', fontWeight: 700 }}>
                      {ts.map((t) => t.tierType === 'percent' ? `滿${t.minQty}件→${(t.percent ?? 0) / 10}折` : `滿${t.minQty}件→NT$${t.unitPrice}`).join(' ｜ ')}
                    </span>
                    <button onClick={() => ts.forEach((t) => removeTier(t.id))} style={{ marginLeft: 10, border: 'none', background: 'none', color: '#e5484d', cursor: 'pointer', fontSize: 12 }}>清空此商品階梯</button>
                  </div>
                ))}
                {Object.keys(groups).length === 0 && (
                  <p style={{ fontSize: 13, color: '#999', marginTop: 8 }}>這家店目前沒有設定批發階梯</p>
                )}
              </div>
            );
          })()}
        </div>

        {/* 新增 */}
        <form onSubmit={add} style={{
          marginTop: 20, background: '#fff', borderRadius: 16, padding: 16,
          display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,.05)',
        }}>
          <input placeholder="SKU" value={newItem.sku} onChange={(e) => setNewItem({ ...newItem, sku: e.target.value })}
            style={inputStyle} />
          <input placeholder="名稱" value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
            style={inputStyle} />
          <select value={newItem.category} onChange={(e) => setNewItem({ ...newItem, category: e.target.value })} style={inputStyle}>
            {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="number" placeholder="價格" value={newItem.price} onChange={(e) => setNewItem({ ...newItem, price: Number(e.target.value) })}
            style={{ ...inputStyle, width: 80 }} />
          <input type="number" placeholder="數量" value={newItem.qty} onChange={(e) => setNewItem({ ...newItem, qty: Number(e.target.value) })}
            style={{ ...inputStyle, width: 80 }} />
          <button type="submit" style={{ ...btnStyle, background: '#06C755' }}>＋ 新增</button>
        </form>

        {/* 列表 */}
        {loading && <p style={{ marginTop: 20, color: '#999' }}>載入中…</p>}
        {!loading && items.map((it) => (
          <div key={it.sku} style={{
            marginTop: 12, background: '#fff', borderRadius: 16, padding: 14,
            display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,.05)', opacity: it.status === 'on_shelf' ? 1 : 0.55,
          }}>
            <span style={{ fontWeight: 700, width: 130, fontSize: 14 }}>{it.name}</span>
            <span style={{ color: '#999', fontSize: 12, width: 100 }}>{it.sku}</span>
            <select value={it.category}
              onChange={(e) => { it.category = e.target.value; setItems([...items]); }}
              style={{ ...inputStyle, width: 110 }}>
              {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="number" value={it.price} title="售價"
              onChange={(e) => { it.price = Number(e.target.value); setItems([...items]); }}
              style={{ ...inputStyle, width: 70 }} />
            <input type="number" value={it.costPrice} title="進價（成本）"
              onChange={(e) => { it.costPrice = Number(e.target.value); setItems([...items]); }}
              style={{ ...inputStyle, width: 70 }} />
            <input type="number" value={it.qty} title="庫存"
              onChange={(e) => { it.qty = Number(e.target.value); setItems([...items]); }}
              style={{ ...inputStyle, width: 70 }} />
            <input type="number" value={it.minQty} title="安全存量（低於此值 LINE 通知）"
              onChange={(e) => { it.minQty = Number(e.target.value); setItems([...items]); }}
              style={{ ...inputStyle, width: 70 }} />
            <select value={it.status}
              onChange={(e) => { it.status = e.target.value; setItems([...items]); }}
              style={{ ...inputStyle, width: 90 }}>
              <option value="on_shelf">上架中</option>
              <option value="off_shelf">下架</option>
            </select>
            <button onClick={() => save(it)} style={{ ...btnStyle, background: '#3b82f6' }}>儲存</button>
          </div>
        ))}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: 14, borderRadius: 8, border: '1px solid #ddd', boxSizing: 'border-box',
};
const btnStyle: React.CSSProperties = {
  padding: '8px 14px', fontSize: 14, fontWeight: 700, color: '#fff',
  border: 'none', borderRadius: 8, cursor: 'pointer',
};

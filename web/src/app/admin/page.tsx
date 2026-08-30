'use client';

import { useCallback, useEffect, useState } from 'react';

interface OrderItem {
  id: number;
  orderNo: string;
  stringModel: string;
  tension: number;
  price: number;
  pickupCode: string;
  status: 'pending' | 'stringing' | 'ready' | 'done';
  paid: boolean;
  customerName: string;
  lineUserId: string;
  lineName: string;
  note: string;
  currentSlot: number | null;
  createdAt: string;
  completedAt: string | null;
}

const STATUS_LABEL: Record<OrderItem['status'], string> = {
  pending: '待收件',
  stringing: '穿線中',
  ready: '待取件',
  done: '已完成',
};

const STATUS_COLOR: Record<OrderItem['status'], string> = {
  pending: '#f59e0b',
  stringing: '#3b82f6',
  ready: '#06C755',
  done: '#9ca3af',
};

export default function AdminPage() {
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [summary, setSummary] = useState({ total: 0, empty: 0, occupied: 0 });
  const [filter, setFilter] = useState<'' | OrderItem['status']>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [strings, setStrings] = useState<{ id: number; model: string; maxTension: number; colors: string[] }[]>([]);
  const [emptySlots, setEmptySlots] = useState<number[]>([]);
  const [showManual, setShowManual] = useState(false);
  const [manual, setManual] = useState({ stringId: 0, tension: 24, color: '', note: '', slotNo: 0, name: '', contact: '' });
  const [customerMatches, setCustomerMatches] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  }

  const refresh = useCallback(async () => {
    try {
      const [oRes, sRes] = await Promise.all([fetch('/api/orders'), fetch('/api/slots')]);
      const oData = await oRes.json();
      const sData = await sRes.json();
      if (!oData.ok) throw new Error(oData.error || '讀取訂單失敗');
      setOrders(oData.orders);
      if (sData.ok) {
        setSummary(sData.summary);
        setEmptySlots(sData.slots.filter((s: any) => s.status === 'empty').map((s: any) => s.slotNo));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 線種下拉（人工單用）
  useEffect(() => {
    fetch('/api/strings').then((r) => r.json()).then((d) => { if (d.ok) setStrings(d.strings); }).catch(() => {});
  }, []);

  async function act(order: OrderItem, action: string) {
    if (action === 'complete' && !window.confirm(`確認客人已取件、完成訂單 ${order.orderNo}？`)) return;
    if (action === 'cancel' && !window.confirm(`確定取消訂單 ${order.orderNo}？（會釋放格口並刪除，不可復原）`)) return;
    setBusyId(order.id);
    setError('');
    try {
      const res = await fetch(`/api/orders/${order.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '操作失敗');
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function openCell(order: OrderItem) {
    if (order.currentSlot == null) return;
    setBusyId(order.id);
    setError('');
    try {
      const res = await fetch('/api/cell-commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotNo: order.currentSlot }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '開格失敗');
      alert(`已排入「開第 ${order.currentSlot} 格」指令，kiosk 輪詢後會開鎖。`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function resetAll() {
    if (!window.confirm('確定清空「全部訂單＋格口」？此動作不可復原（測試用）。')) return;
    setError('');
    try {
      const res = await fetch('/api/admin/reset', { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '清空失敗');
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function searchCustomer(q: string) {
    const t = q.trim();
    if (!t) { setCustomerMatches([]); return; }
    try {
      const r = await fetch(`/api/customers/search?q=${encodeURIComponent(t)}`);
      const d = await r.json();
      if (d.ok) setCustomerMatches(d.customers || []);
      else setCustomerMatches([]);
    } catch {
      setCustomerMatches([]);
    }
  }

  function pickCustomer(merged: string) {
    const idx = merged.indexOf(' · ');
    const name = idx >= 0 ? merged.slice(0, idx) : '';
    const contact = idx >= 0 ? merged.slice(idx + 3) : merged;
    setManual((m) => ({ ...m, name, contact }));
    setCustomerMatches([]);
  }

  async function createManual(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stringId: manual.stringId,
          tension: manual.tension,
          color: manual.color,
          note: manual.note,
          slotNo: manual.slotNo,
          customerName: [manual.name.trim(), manual.contact.trim()].filter(Boolean).join(' · '),
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '建立失敗');
      setShowManual(false);
      setManual({ stringId: 0, tension: 24, color: '', note: '', slotNo: 0, name: '', contact: '' });
      setCustomerMatches([]);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const filtered = filter ? orders.filter((o) => o.status === filter) : orders;
  const counts = {
    pending: orders.filter((o) => o.status === 'pending').length,
    stringing: orders.filter((o) => o.status === 'stringing').length,
    ready: orders.filter((o) => o.status === 'ready').length,
    done: orders.filter((o) => o.status === 'done').length,
  };

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '24px 16px 64px', fontFamily: '-apple-system, sans-serif', color: '#333' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700 }}>🧵 穿線訂單後台</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/" style={{ padding: '8px 16px', background: '#eee', color: '#333', borderRadius: 10, fontSize: 14, textDecoration: 'none' }}>
            🏠 首頁
          </a>
          <a href="/admin/strings" style={{ padding: '8px 16px', background: '#06C755', color: '#fff', borderRadius: 10, fontSize: 14, textDecoration: 'none' }}>
            🎾 線種管理
          </a>
          <a href="/admin/inventory" style={{ padding: '8px 16px', background: '#06C755', color: '#fff', borderRadius: 10, fontSize: 14, textDecoration: 'none' }}>
            📦 販售庫存
          </a>
          <button onClick={() => setShowManual((v) => !v)} style={{ padding: '8px 16px', background: '#06C755', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
            ＋ 人工單
          </button>
          <button onClick={refresh} style={{ padding: '8px 16px', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: 10, cursor: 'pointer', fontSize: 14 }}>
            ↻ 重新整理
          </button>
          <button onClick={resetAll} style={{ padding: '8px 16px', background: '#e5484d', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14 }}>
            🗑️ 清空測試資料
          </button>
          <a href="/admin/password" style={{ padding: '8px 16px', background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 13, textDecoration: 'none' }}>
            🔑 改密碼
          </a>
          <button onClick={logout} style={{ padding: '8px 16px', background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: 13 }}>
            登出
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <Stat label="待收件" value={counts.pending} color="#f59e0b" />
        <Stat label="穿線中" value={counts.stringing} color="#3b82f6" />
        <Stat label="待取件" value={counts.ready} color="#06C755" />
        <Stat label="已完成" value={counts.done} color="#9ca3af" />
        <Stat label="空置格口" value={`${summary.empty} / ${summary.total}`} color="#06C755" />
      </div>

      {showManual && (
        <form onSubmit={createManual} style={{ marginTop: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>＋ 人工單（臨櫃／寄物：自選格子＋備註）</div>
          <div style={{ fontSize: 12, color: '#999', marginBottom: 10 }}>💡 除「自選格子」外皆為選填：只選格子即可直接開櫃（寄物／快速收件）；穿線單請補線種＋磅數。</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={manual.stringId} onChange={(e) => setManual({ ...manual, stringId: Number(e.target.value) })} style={inp}>
              <option value={0}>線種（不選＝寄物／快速開櫃）</option>
              {strings.map((s) => <option key={s.id} value={s.id}>{s.model}</option>)}
            </select>
            <input type="number" value={manual.tension} onChange={(e) => setManual({ ...manual, tension: Number(e.target.value) })} style={{ ...inp, width: 70 }} title="磅數" placeholder="磅" />
            <input placeholder="名字" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} style={{ ...inp, width: 110 }} />
            <div style={{ position: 'relative' }}>
              <input placeholder="會員ID／電話（可搜尋）" value={manual.contact} onChange={(e) => { setManual({ ...manual, contact: e.target.value }); searchCustomer(e.target.value); }} style={{ ...inp, width: 180 }} />
              {customerMatches.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, background: '#fff', border: '1px solid #ddd', borderRadius: 8, width: 260, maxHeight: 200, overflow: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,.12)' }}>
                  {customerMatches.map((c) => (
                    <button key={c} type="button" onClick={() => pickCustomer(c)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', background: 'none', border: 'none', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', fontSize: 13, color: '#333' }}>
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input placeholder="備註（鞋／包裹／臨時寄放…）" value={manual.note} onChange={(e) => setManual({ ...manual, note: e.target.value })} style={{ ...inp, width: 210 }} />
            <select value={manual.slotNo} onChange={(e) => setManual({ ...manual, slotNo: Number(e.target.value) })} style={inp}>
              <option value={0}>自選格子</option>
              {emptySlots.map((n) => <option key={n} value={n}>第 {n} 格</option>)}
            </select>
            <button type="submit" disabled={saving || !manual.slotNo} style={{ padding: '8px 16px', background: '#06C755', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: manual.slotNo ? 'pointer' : 'default', opacity: manual.slotNo ? 1 : 0.5 }}>
              {saving ? '建立中…' : manual.stringId ? '建立＋印貼紙＋開格' : '寄物／快速開格'}
            </button>
            <button type="button" onClick={() => setShowManual(false)} style={{ padding: '8px 12px', background: '#eee', color: '#666', border: 'none', borderRadius: 10, fontSize: 14, cursor: 'pointer' }}>取消</button>
          </div>
        </form>
      )}

      {error && (
        <div style={{ marginTop: 16, background: '#fee', border: '1px solid #fcc', borderRadius: 12, padding: 12, color: '#c33' }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        {(['', 'pending', 'stringing', 'ready', 'done'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '6px 14px',
              borderRadius: 20,
              border: filter === f ? '2px solid #06C755' : '1px solid #ddd',
              background: filter === f ? '#e8f8ee' : '#fff',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {f === '' ? '全部' : STATUS_LABEL[f]}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ marginTop: 24, color: '#999' }}>載入中…</p>
      ) : filtered.length === 0 ? (
        <p style={{ marginTop: 24, color: '#999' }}>目前沒有訂單。</p>
      ) : (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((o) => (
            <div key={o.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 16 }}>{o.orderNo}</span>
                  <span style={{ marginLeft: 8, fontSize: 14, color: '#666' }}>{o.stringModel} · {o.tension} lbs</span>
                </div>
                <span style={{ padding: '4px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, background: STATUS_COLOR[o.status] + '22', color: STATUS_COLOR[o.status] }}>
                  {STATUS_LABEL[o.status]}{o.paid ? ' · 已付款' : ''}
                </span>
              </div>

              <div style={{ marginTop: 8, fontSize: 14, color: '#666', lineHeight: 1.7 }}>
                取件碼 <b style={{ color: '#06C755', letterSpacing: 2 }}>{o.pickupCode}</b>
                {o.currentSlot != null && <> · 格號 <b>第 {o.currentSlot} 格</b></>}
                {' · '}NT${o.price}
                {o.customerName && <> · {o.customerName}</>}
                {o.lineName && <span style={{ color: '#06C755' }}> · LINE：{o.lineName}</span>}
                {o.lineUserId ? (
                  <span style={{ color: '#06C755' }}> · 已綁定</span>
                ) : (
                  <span style={{ color: '#999' }}> · 未綁定 LINE</span>
                )}
                {o.note && <div>備註：{o.note}</div>}
              </div>

              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {o.status === 'pending' && (
                  <ActionBtn onClick={() => act(o, 'take')} disabled={busyId === o.id} color="#3b82f6" label="取件（開始穿線）" />
                )}
                {o.status === 'stringing' && (
                  <ActionBtn onClick={() => act(o, 'return')} disabled={busyId === o.id} color="#06C755" label="穿好送回（分派格口）" />
                )}
                {o.status === 'ready' && !o.paid && (
                  <ActionBtn onClick={() => act(o, 'pay')} disabled={busyId === o.id} color="#f59e0b" label="標記已付款" />
                )}
                {o.status === 'ready' && o.paid && (
                  <ActionBtn onClick={() => act(o, 'complete')} disabled={busyId === o.id} color="#333" label="完成取件" />
                )}
                {o.status === 'done' && <span style={{ fontSize: 13, color: '#999' }}>已完成</span>}
                {o.currentSlot != null && (
                  <ActionBtn onClick={() => openCell(o)} disabled={busyId === o.id} color="#06C755" label={`開格（第 ${o.currentSlot} 格）`} />
                )}
                {o.status !== 'done' && (
                  <ActionBtn onClick={() => act(o, 'cancel')} disabled={busyId === o.id} color="#e5484d" label="取消訂單" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{ flex: '1 1 120px', minWidth: 110, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ color: '#999', fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function ActionBtn({ onClick, disabled, color, label }: { onClick: () => void; disabled: boolean; color: string; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ padding: '8px 14px', background: color, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}
    >
      {label}
    </button>
  );
}

const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 14, borderRadius: 8, border: '1px solid #ddd', boxSizing: 'border-box' };

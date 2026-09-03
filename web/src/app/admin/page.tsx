'use client';

import { useCallback, useEffect, useState } from 'react';

interface OrderItem {
  id: number;
  orderNo: string;
  stringId: number;
  stringModel: string;
  tension: number;
  price: number;
  budget: number | null;
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

interface CustomerHit {
  name: string;
  phone: string;
  lineUserId: string;
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
  const [strings, setStrings] = useState<{ id: number; model: string; maxTension: number; price: number; colors: string[] }[]>([]);
  const [emptySlots, setEmptySlots] = useState<number[]>([]);
  const [showManual, setShowManual] = useState(false);
  const [manual, setManual] = useState({ stringId: 0, tension: 24, color: '', note: '', slotNo: 0, name: '', contact: '', paid: false });
  const [customerMatches, setCustomerMatches] = useState<CustomerHit[]>([]);
  const [recentOrders, setRecentOrders] = useState<OrderItem[]>([]);
  const [historyFor, setHistoryFor] = useState('');
  const [saving, setSaving] = useState(false);
  // 預算單 → 指派線種+磅數
  const [assignTarget, setAssignTarget] = useState<OrderItem | null>(null);
  const [assignStringId, setAssignStringId] = useState(0);
  const [assignTension, setAssignTension] = useState(24);
  const [showOpenAll, setShowOpenAll] = useState(false);
  const [openAllForm, setOpenAllForm] = useState({ operator: '', password: '' });
  const [showLogs, setShowLogs] = useState(false);
  const [adminLogs, setAdminLogs] = useState<{ id: number; action: string; operator: string; detail: string; createdAt: string }[]>([]);

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

  // 指派預算單 → 具體線種+磅數
  async function assignSubmit() {
    if (!assignTarget) return;
    if (!assignStringId) { setError('請選線種'); return; }
    setBusyId(assignTarget.id);
    setError('');
    try {
      const res = await fetch(`/api/orders/${assignTarget.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stringId: assignStringId, tension: assignTension }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '指派失敗');
      setAssignTarget(null);
      await refresh();
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

  async function submitOpenAll(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/cell-commands/open-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operator: openAllForm.operator, password: openAllForm.password }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '一鍵全開失敗');
      window.alert(`✅ 已排入 ${data.queued} 格開格指令，kiosk poller 將依序開鎖`);
      setShowOpenAll(false);
      setOpenAllForm({ operator: '', password: '' });
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function toggleLogs() {
    if (!showLogs) {
      try {
        const r = await fetch('/api/admin/logs');
        const d = await r.json();
        if (d.ok) setAdminLogs(d.logs || []);
      } catch {}
    }
    setShowLogs((v) => !v);
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

  async function pickCustomer(hit: CustomerHit) {
    setManual((m) => ({ ...m, name: hit.name, contact: hit.phone }));
    setCustomerMatches([]);
    // 帶入該會員最近消費紀錄（依電話或 LINE 身份）
    const params = hit.lineUserId
      ? `lineUserId=${encodeURIComponent(hit.lineUserId)}`
      : `phone=${encodeURIComponent(hit.phone)}`;
    setHistoryFor(hit.lineUserId ? `${hit.name}（LINE）` : `${hit.name}${hit.phone ? ` · ${hit.phone}` : ''}`);
    try {
      const r = await fetch(`/api/customers/orders?${params}`);
      const d = await r.json();
      if (d.ok) setRecentOrders(d.orders || []);
      else setRecentOrders([]);
    } catch {
      setRecentOrders([]);
    }
  }

  function fillFromOrder(o: OrderItem) {
    // 點消費紀錄 → 帶入線種＋磅數（寄物單跳過線種；已停售線種不帶）
    const validString = o.stringId && o.tension > 0 && strings.some((s) => s.id === o.stringId);
    setManual((m) => ({
      ...m,
      stringId: validString ? o.stringId : m.stringId,
      tension: validString ? o.tension : m.tension,
    }));
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
          paid: manual.paid,
          customerName: [manual.name.trim(), manual.contact.trim()].filter(Boolean).join(' · '),
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '建立失敗');
      setShowManual(false);
      setManual({ stringId: 0, tension: 24, color: '', note: '', slotNo: 0, name: '', contact: '', paid: false });
      setCustomerMatches([]);
      setRecentOrders([]);
      setHistoryFor('');
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
          <button onClick={() => setShowOpenAll((v) => !v)} style={{ padding: '8px 16px', background: '#d97706', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
            🔓 一鍵全開
          </button>
          <button onClick={toggleLogs} style={{ padding: '8px 16px', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: 10, cursor: 'pointer', fontSize: 13 }}>
            📋 操作紀錄
          </button>
          <a href="/admin/password" style={{ padding: '8px 16px', background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 13, textDecoration: 'none' }}>
            🔑 改密碼
          </a>
          <button onClick={logout} style={{ padding: '8px 16px', background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: 13 }}>
            登出
          </button>
        </div>
      </div>

      {showOpenAll && (
        <form onSubmit={submitOpenAll} style={{ marginTop: 16, background: '#fff7ed', border: '1px solid #fcd34d', borderRadius: 14, padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 4, color: '#b45309' }}>🔓 一鍵全開（所有格口）</div>
          <div style={{ fontSize: 12, color: '#b45309', marginBottom: 10 }}>⚠️ 會把所有格子排入開格指令。請填員工姓名＋今日日期 4 碼（如 0903），動作會寫入操作紀錄。</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input placeholder="員工姓名（誰開的）" value={openAllForm.operator} onChange={(e) => setOpenAllForm({ ...openAllForm, operator: e.target.value })} style={{ ...inp, width: 160 }} />
            <input placeholder="密碼＝今日 4 碼（如 0903）" value={openAllForm.password} onChange={(e) => setOpenAllForm({ ...openAllForm, password: e.target.value })} style={{ ...inp, width: 180 }} inputMode="numeric" maxLength={4} />
            <button type="submit" disabled={!openAllForm.operator.trim() || !/^\d{4}$/.test(openAllForm.password)} style={{ padding: '8px 16px', background: '#d97706', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: (openAllForm.operator.trim() && /^\d{4}$/.test(openAllForm.password)) ? 'pointer' : 'default', opacity: (openAllForm.operator.trim() && /^\d{4}$/.test(openAllForm.password)) ? 1 : 0.5 }}>
              確認全開
            </button>
            <button type="button" onClick={() => { setShowOpenAll(false); setOpenAllForm({ operator: '', password: '' }); }} style={{ padding: '8px 12px', background: '#eee', color: '#666', border: 'none', borderRadius: 10, fontSize: 14, cursor: 'pointer' }}>取消</button>
          </div>
        </form>
      )}

      {showLogs && (
        <div style={{ marginTop: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>📋 操作紀錄（責任追蹤，最新在前）</div>
          {adminLogs.length === 0 ? (
            <div style={{ fontSize: 13, color: '#999' }}>尚無操作紀錄。</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflow: 'auto' }}>
              {adminLogs.map((l) => (
                <div key={l.id} style={{ display: 'flex', gap: 10, fontSize: 12, color: '#555', padding: '5px 8px', background: '#fafafa', borderRadius: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'monospace' }}>{l.createdAt.replace('T', ' ').slice(0, 16)}</span>
                  <span style={{ fontWeight: 600, color: '#333' }}>{l.action}</span>
                  <span>{l.operator || '（系統）'}</span>
                  {l.detail && <span style={{ color: '#999' }}>{l.detail}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
              <input placeholder="名字／電話／LINE 搜尋" value={manual.contact} onChange={(e) => { setManual({ ...manual, contact: e.target.value }); searchCustomer(e.target.value); }} style={{ ...inp, width: 190 }} />
              {customerMatches.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, background: '#fff', border: '1px solid #ddd', borderRadius: 8, width: 280, maxHeight: 220, overflow: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,.12)' }}>
                  {customerMatches.map((c) => (
                    <button key={c.lineUserId || c.phone || c.name} type="button" onClick={() => pickCustomer(c)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', background: 'none', border: 'none', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', fontSize: 13, color: '#333' }}>
                      {c.name}{c.phone ? ` · ${c.phone}` : ''}{c.lineUserId ? ' · LINE' : ''}
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
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={manual.paid} onChange={(e) => setManual({ ...manual, paid: e.target.checked })} style={{ width: 18, height: 18, cursor: 'pointer' }} />
              ✅ 已收款
            </label>
            <button type="submit" disabled={saving || !manual.slotNo} style={{ padding: '8px 16px', background: '#06C755', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: manual.slotNo ? 'pointer' : 'default', opacity: manual.slotNo ? 1 : 0.5 }}>
              {saving ? '建立中…' : manual.stringId ? '建立＋印貼紙＋開格' : '寄物／快速開格'}
            </button>
            <button type="button" onClick={() => setShowManual(false)} style={{ padding: '8px 12px', background: '#eee', color: '#666', border: 'none', borderRadius: 10, fontSize: 14, cursor: 'pointer' }}>取消</button>
          </div>
          {historyFor && (
            <div style={{ marginTop: 12, background: '#f7f9f8', border: '1px solid #e5e7eb', borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>📋 {historyFor} 最近消費紀錄</div>
              <div style={{ fontSize: 11, color: '#999', marginBottom: 6 }}>點任一筆 → 自動帶入線種＋磅數</div>
              {recentOrders.length === 0 ? (
                <div style={{ fontSize: 12, color: '#999' }}>沒有歷史消費紀錄。</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {recentOrders.map((o) => (
                    <button key={o.id} type="button" onClick={() => fillFromOrder(o)} style={{ display: 'flex', gap: 10, fontSize: 12, color: '#555', flexWrap: 'wrap', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '4px 6px', borderRadius: 6, alignItems: 'center' }}>
                      <span style={{ fontFamily: 'monospace' }}>{o.createdAt.slice(0, 10)}</span>
                      <span style={{ fontWeight: 600, color: '#333' }}>{o.stringModel}</span>
                      <span>{o.tension > 0 ? `${o.tension} lbs` : '寄物'}</span>
                      <span>NT${o.price}</span>
                      <span style={{ color: STATUS_COLOR[o.status] }}>{STATUS_LABEL[o.status]}</span>
                      <span style={{ fontFamily: 'monospace', color: '#06C755' }}>{o.pickupCode}</span>
                      <span style={{ color: '#06C755', fontWeight: 600 }}>＋帶入</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
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
                  <span style={{ marginLeft: 8, fontSize: 14, color: '#666' }}>{o.budget != null ? `${o.stringModel} · 預算 NT$${o.budget}` : `${o.stringModel} · ${o.tension} lbs`}</span>
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
                {o.budget != null && (
                  <ActionBtn onClick={() => { setAssignTarget(o); setAssignStringId(strings[0]?.id || 0); setAssignTension(24); }} disabled={busyId === o.id} color="#7c3aed" label="指派線種" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 指派預算單彈窗 */}
      {assignTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '24px 28px', width: 'min(420px, 92vw)', maxHeight: '86vh', overflow: 'auto' }}>
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>指派線種 · {assignTarget.orderNo}</div>
            <div style={{ fontSize: 14, color: '#666', marginBottom: 14 }}>預算 NT${assignTarget.budget}，選好線種與磅數後即變為一般單。</div>

            <div style={{ fontSize: 14, fontWeight: 700, color: '#666', marginBottom: 4 }}>線種</div>
            <select value={assignStringId} onChange={(e) => setAssignStringId(Number(e.target.value))} style={{ width: '100%', padding: 12, border: '2px solid #ddd', borderRadius: 10, fontSize: 16, background: '#fff' }}>
              {strings.map((s) => (
                <option key={s.id} value={s.id}>{s.model}（NT${s.price}，上限 {s.maxTension} 磅）</option>
              ))}
            </select>

            <div style={{ fontSize: 14, fontWeight: 700, color: '#666', margin: '14px 0 4px' }}>磅數</div>
            <input type="number" value={assignTension} onChange={(e) => setAssignTension(Number(e.target.value))} min={1} style={{ width: '100%', padding: 12, border: '2px solid #ddd', borderRadius: 10, fontSize: 16, boxSizing: 'border-box' }} />

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={() => setAssignTarget(null)} style={{ flex: 1, padding: '14px 0', borderRadius: 12, border: 'none', background: '#f0f0f0', color: '#666', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>取消</button>
              <button onClick={assignSubmit} disabled={busyId === assignTarget.id || !assignStringId} style={{ flex: 2, padding: '14px 0', borderRadius: 12, border: 'none', background: (busyId === assignTarget.id || !assignStringId) ? '#ccc' : '#7c3aed', color: '#fff', fontSize: 16, fontWeight: 700, cursor: (busyId === assignTarget.id || !assignStringId) ? 'default' : 'pointer' }}>
                {busyId === assignTarget.id ? '指派中…' : '確認指派'}
              </button>
            </div>
          </div>
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

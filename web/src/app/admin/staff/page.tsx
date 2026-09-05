'use client';

import { useEffect, useState } from 'react';

interface StaffRow { id: number; name: string; role: 'admin' | 'staff' }

export default function AdminStaffPage() {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<'staff' | 'admin'>('staff');
  const [msg, setMsg] = useState<string>('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch('/api/admin/staff');
    const d = await r.json();
    if (d.ok) setStaff(d.staff);
    else setMsg(d.error || '讀取失敗(需管理員)');
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!newName.trim()) return;
    setBusy(true); setMsg('');
    const r = await fetch('/api/admin/staff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', name: newName.trim(), role: newRole }),
    });
    const d = await r.json();
    setMsg(d.ok ? '✅ 已新增(預設 PIN 1234)' : (d.error || '失敗'));
    setBusy(false);
    if (d.ok) { setNewName(''); load(); }
  }

  async function reset(name: string) {
    if (!confirm(`把「${name}」的 PIN 重置為 1234？`)) return;
    setBusy(true); setMsg('');
    const r = await fetch('/api/admin/staff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset', name }),
    });
    const d = await r.json();
    setMsg(d.ok ? `✅ 已把「${name}」PIN 重置為 1234` : (d.error || '失敗'));
    setBusy(false);
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', fontFamily: '-apple-system, sans-serif', color: '#333' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
        <a href="/admin" style={{ color: '#06C755', fontSize: 14, textDecoration: 'none' }}>← 回後台</a>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#06C755', marginTop: 8 }}>👥 員工管理</h1>

        <div style={{ background: '#fff', borderRadius: 14, padding: 18, marginTop: 16, border: '1px solid #e5e7eb' }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>＋ 新增員工（預設 PIN 1234）</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="姓名" style={{ flex: 1, padding: 10, border: '1px solid #ddd', borderRadius: 8, fontSize: 15 }} />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as any)} style={{ padding: 10, border: '1px solid #ddd', borderRadius: 8, fontSize: 15 }}>
              <option value="staff">員工</option>
              <option value="admin">管理員</option>
            </select>
            <button onClick={add} disabled={busy} style={{ padding: '10px 18px', background: '#06C755', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>新增</button>
          </div>
        </div>

        {msg && <p style={{ marginTop: 12, fontSize: 14, color: '#06C755' }}>{msg}</p>}

        <div style={{ marginTop: 18 }}>
          {staff.map((s) => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '12px 16px', marginTop: 8 }}>
              <div>
                <b>{s.name}</b>
                <span style={{ marginLeft: 8, fontSize: 12, color: s.role === 'admin' ? '#b45309' : '#666', background: s.role === 'admin' ? '#fef3c7' : '#f0f0f0', padding: '2px 8px', borderRadius: 20 }}>
                  {s.role === 'admin' ? '管理員' : '員工'}
                </span>
              </div>
              <button onClick={() => reset(s.name)} disabled={busy} style={{ padding: '6px 12px', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>重置 PIN 1234</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

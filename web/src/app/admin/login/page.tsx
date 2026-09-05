'use client';

import { useEffect, useState } from 'react';

export default function AdminLoginPage() {
  const [names, setNames] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    fetch('/api/staff/names')
      .then((r) => r.json())
      .then((d) => { if (d.ok) setNames(d.names); })
      .catch(() => {});
  }, []);

  function tap(d: string) {
    if (pin.length >= 4) return;
    setPin(pin + d);
  }
  function backspace() {
    setPin(pin.slice(0, -1));
  }

  async function submit() {
    if (!name || pin.length !== 4) return;
    setPending(true);
    setError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, pin }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || '登入失敗');
        setPin('');
        return;
      }
      window.location.href = '/admin';
    } finally {
      setPending(false);
    }
  }

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'];

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', fontFamily: '-apple-system, sans-serif', background: '#f5f5f5', color: '#333',
    }}>
      <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: '#06C755' }}>🔐 員工登入</h1>
      <div style={{
        marginTop: 20, background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 360,
        boxShadow: '0 2px 10px rgba(0,0,0,.06)',
      }}>
        <label style={{ fontSize: 14, color: '#666' }}>選擇您的名字</label>
        <select
          value={name}
          onChange={(e) => { setName(e.target.value); setPin(''); setError(''); }}
          style={{
            marginTop: 8, width: '100%', padding: '14px 12px', fontSize: 20, borderRadius: 10,
            border: '1px solid #ddd', background: '#fff', color: '#333', boxSizing: 'border-box',
          }}
        >
          <option value="">請選擇…</option>
          {names.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>

        {/* PIN 顯示（保險箱式圓點） */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 14, margin: '22px 0 18px' }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{
              width: 22, height: 22, borderRadius: '50%',
              background: i < pin.length ? '#06C755' : '#e5e7eb',
            }} />
          ))}
        </div>

        {/* 數字鍵盤 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {keys.map((k) => {
            if (k === 'OK') {
              return (
                <button key="OK" onClick={submit} disabled={pending || !name || pin.length !== 4}
                  style={{ ...keyBtn, background: (!name || pin.length !== 4) ? '#c9c9c9' : '#06C755', color: '#fff', fontWeight: 800 }}>
                  {pending ? '…' : '登入'}
                </button>
              );
            }
            if (k === '⌫') {
              return <button key="⌫" onClick={backspace} style={{ ...keyBtn, background: '#f0f0f0', color: '#555' }}>⌫</button>;
            }
            return <button key={k} onClick={() => tap(k)} style={keyBtn}>{k}</button>;
          })}
        </div>

        {error && <p style={{ marginTop: 12, color: '#dc2626', fontSize: 14, textAlign: 'center' }}>{error}</p>}
      </div>
      <a href="/" style={{ marginTop: 20, color: '#999', fontSize: 13, textDecoration: 'none' }}>← 回主選單</a>
    </div>
  );
}

const keyBtn: React.CSSProperties = {
  padding: '18px 0', fontSize: 24, fontWeight: 700,
  border: '1px solid #ddd', borderRadius: 14, background: '#fff', color: '#333',
  cursor: 'pointer', fontFamily: 'inherit',
};

'use client';

import { useState } from 'react';

export default function AdminLoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setPending(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || '登入失敗');
        return;
      }
      window.location.href = '/admin';
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', fontFamily: '-apple-system, sans-serif', background: '#f5f5f5', color: '#333',
    }}>
      <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: '#06C755' }}>🔐 員工後台</h1>
      <form onSubmit={submit} style={{
        marginTop: 24, background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 340,
        boxShadow: '0 2px 10px rgba(0,0,0,.06)',
      }}>
        <label style={{ fontSize: 14, color: '#666' }}>管理密碼</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          autoFocus
          style={{
            marginTop: 8, width: '100%', padding: '12px 14px', fontSize: 16, borderRadius: 10,
            border: '1px solid #ddd', boxSizing: 'border-box',
          }}
        />
        {error && <p style={{ marginTop: 10, color: '#dc2626', fontSize: 14 }}>{error}</p>}
        <button
          type="submit"
          disabled={pending || !password}
          style={{
            marginTop: 16, width: '100%', padding: '12px 0', fontSize: 16, fontWeight: 700,
            background: pending ? '#9ca3af' : '#06C755', color: '#fff', border: 'none',
            borderRadius: 10, cursor: 'pointer',
          }}
        >
          {pending ? '登入中…' : '登入'}
        </button>
      </form>
      <a href="/" style={{ marginTop: 20, color: '#999', fontSize: 13, textDecoration: 'none' }}>← 回主選單</a>
    </div>
  );
}

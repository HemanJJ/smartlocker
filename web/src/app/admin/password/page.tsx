'use client';

import { useState } from 'react';

export default function AdminPasswordPage() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next !== confirm) {
      setMsg({ ok: false, text: '兩次新密碼不一致' });
      return;
    }
    if (next.length < 6) {
      setMsg({ ok: false, text: '新密碼至少 6 碼' });
      return;
    }
    setPending(true);
    try {
      const res = await fetch('/api/admin/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current, next }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg({ ok: true, text: '✅ 密碼已更新，下次登入用新密碼' });
        setCurrent(''); setNext(''); setConfirm('');
      } else {
        setMsg({ ok: false, text: j.error || '修改失敗' });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', fontFamily: '-apple-system, sans-serif', background: '#f5f5f5', color: '#333',
    }}>
      <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: '#06C755' }}>🔑 修改後台密碼</h1>
      <form onSubmit={submit} style={{
        marginTop: 24, background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 360,
        boxShadow: '0 2px 10px rgba(0,0,0,.06)',
      }}>
        <Field label="目前密碼" value={current} onChange={setCurrent} type="password" autoFocus />
        <Field label="新密碼（至少 6 碼）" value={next} onChange={setNext} type="password" />
        <Field label="確認新密碼" value={confirm} onChange={setConfirm} type="password" />

        {msg && (
          <p style={{ marginTop: 12, fontSize: 14, color: msg.ok ? '#06C755' : '#dc2626' }}>{msg.text}</p>
        )}

        <button
          type="submit"
          disabled={pending || !current || !next || !confirm}
          style={{
            marginTop: 16, width: '100%', padding: '12px 0', fontSize: 16, fontWeight: 700,
            background: pending ? '#9ca3af' : '#06C755', color: '#fff', border: 'none',
            borderRadius: 10, cursor: 'pointer',
          }}
        >
          {pending ? '儲存中…' : '更新密碼'}
        </button>
      </form>
      <a href="/admin" style={{ marginTop: 20, color: '#999', fontSize: 13, textDecoration: 'none' }}>← 回後台</a>
    </div>
  );
}

function Field({ label, value, onChange, type, autoFocus }: {
  label: string; value: string; onChange: (v: string) => void; type: string; autoFocus?: boolean;
}) {
  return (
    <label style={{ display: 'block', marginTop: 12, fontSize: 14, color: '#666' }}>
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        style={{
          marginTop: 6, width: '100%', padding: '12px 14px', fontSize: 16, borderRadius: 10,
          border: '1px solid #ddd', boxSizing: 'border-box',
        }}
      />
    </label>
  );
}

'use client';

import { useState } from 'react';

export default function AdminPasswordPage() {
  // 三步驟：0=目前PIN, 1=新PIN, 2=確認新PIN
  const [step, setStep] = useState(0);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  const value = step === 0 ? current : step === 1 ? next : confirm;
  const label = step === 0 ? '請輸入「目前 PIN」' : step === 1 ? '設定「新 PIN」（4 碼）' : '再輸入一次「新 PIN」';

  function tap(d: string) {
    const v = (step === 0 ? current : step === 1 ? next : confirm);
    if (v.length >= 4) return;
    const nv = v + d;
    if (step === 0) { setCurrent(nv); if (nv.length === 4) setTimeout(() => setStep(1), 350); }
    else if (step === 1) { setNext(nv); if (nv.length === 4) setTimeout(() => setStep(2), 350); }
    else { setConfirm(nv); if (nv.length === 4) setTimeout(() => doSubmit(nv), 350); }
  }
  function backspace() {
    if (step === 0) setCurrent(current.slice(0, -1));
    else if (step === 1) setNext(next.slice(0, -1));
    else setConfirm(confirm.slice(0, -1));
  }

  async function doSubmit(confirmVal?: string) {
    const c = confirmVal ?? confirm;
    if (next !== c) { setMsg({ ok: false, text: '兩次新 PIN 不一致' }); setStep(1); setNext(''); setConfirm(''); return; }
    setPending(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current, next }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg({ ok: true, text: '✅ PIN 已更新，下次登入用新 PIN' });
        setStep(0); setCurrent(''); setNext(''); setConfirm('');
      } else {
        setMsg({ ok: false, text: j.error || '修改失敗' });
        setStep(0); setCurrent('');
      }
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
      <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: '#06C755' }}>🔑 修改我的 PIN</h1>
      <div style={{
        marginTop: 20, background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 360,
        boxShadow: '0 2px 10px rgba(0,0,0,.06)',
      }}>
        {/* 步驟指示 */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 8 }}>
          {['目前', '新', '確認'].map((t, i) => (
            <span key={t} style={{
              padding: '4px 12px', borderRadius: 20, fontSize: 13,
              background: step === i ? '#06C755' : '#f0f0f0', color: step === i ? '#fff' : '#999',
            }}>
              {t}
            </span>
          ))}
        </div>

        <div style={{ textAlign: 'center', fontSize: 16, color: '#555', marginTop: 6 }}>{label}</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 14, margin: '18px 0' }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{
              width: 22, height: 22, borderRadius: '50%',
              background: i < value.length ? '#06C755' : '#e5e7eb',
            }} />
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {keys.map((k) => {
            if (k === 'OK') {
              return (
                <button key="OK" onClick={() => doSubmit()} disabled={pending || current.length !== 4 || next.length !== 4 || confirm.length !== 4}
                  style={{ ...keyBtn, background: (current.length !== 4 || next.length !== 4 || confirm.length !== 4) ? '#c9c9c9' : '#06C755', color: '#fff', fontWeight: 800 }}>
                  {pending ? '…' : '確定'}
                </button>
              );
            }
            if (k === '⌫') return <button key="⌫" onClick={backspace} style={{ ...keyBtn, background: '#f0f0f0', color: '#555' }}>⌫</button>;
            return <button key={k} onClick={() => tap(k)} style={keyBtn}>{k}</button>;
          })}
        </div>

        {msg && <p style={{ marginTop: 12, fontSize: 14, color: msg.ok ? '#06C755' : '#dc2626', textAlign: 'center' }}>{msg.text}</p>}
      </div>
      <a href="/admin" style={{ marginTop: 20, color: '#999', fontSize: 13, textDecoration: 'none' }}>← 回後台</a>
    </div>
  );
}

const keyBtn: React.CSSProperties = {
  padding: '18px 0', fontSize: 24, fontWeight: 700,
  border: '1px solid #ddd', borderRadius: 14, background: '#fff', color: '#333',
  cursor: 'pointer', fontFamily: 'inherit',
};

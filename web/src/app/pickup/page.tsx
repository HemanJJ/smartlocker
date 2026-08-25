'use client';

import { useEffect, useRef, useState } from 'react';
import KioskShell from '@/components/KioskShell';

interface OrderItem {
  id: number;
  orderNo: string;
  stringModel: string;
  tension: number;
  pickupCode: string;
  currentSlot: number | null;
  status: string;
}

export default function PickupPage() {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle');
  const [result, setResult] = useState<OrderItem | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 達 6 位自動送件（掃碼槍 = 鍵盤輸入，打滿 6 碼即觸發）
  useEffect(() => {
    if (code.length === 6 && status === 'idle') {
      doPickup(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // 頁面載入即對焦，讓掃碼槍直接可掃
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function doPickup(c: string) {
    setStatus('busy');
    setError('');
    try {
      const res = await fetch('/api/pickup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: c }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '取件失敗');
      setResult(data.order);
      setStatus('ok');
    } catch (e: any) {
      setError(e.message);
      setStatus('err');
    }
  }

  function pressDigit(d: string) {
    if (status === 'busy' || status === 'ok') return;
    setStatus('idle');
    setError('');
    if (code.length < 6) setCode(code + d);
  }

  function backspace() {
    if (status === 'busy' || status === 'ok') return;
    setStatus('idle');
    setError('');
    setCode(code.slice(0, -1));
  }

  function reset() {
    setCode('');
    setResult(null);
    setError('');
    setStatus('idle');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  // ── 成功畫面 ──
  if (status === 'ok' && result) {
    return (
      <KioskShell>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 16px', fontFamily: '-apple-system, sans-serif', color: '#333', textAlign: 'center' }}>
        <div style={{ textAlign: 'left' }}><a href="/" style={{ display: 'inline-block', marginBottom: 14, fontSize: 17, fontWeight: 700, color: '#06C755', textDecoration: 'none' }}>🏠 主選單</a></div>
        <div style={{ fontSize: 64 }}>🔓</div>
        <h1 style={{ fontSize: '1.7rem', fontWeight: 700, marginTop: 8, color: '#06C755' }}>取件成功</h1>
        <p style={{ color: '#666', marginTop: 8 }}>第 <b style={{ fontSize: '1.4rem', color: '#06C755' }}>{result.currentSlot}</b> 格已開啟</p>

        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 18, marginTop: 20 }}>
          <div style={{ color: '#999', fontSize: 13 }}>{result.orderNo}</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{result.stringModel} · {result.tension} lbs</div>
        </div>

        <p style={{ color: '#999', fontSize: 14, marginTop: 16 }}>請取出球拍後關上格門。謝謝！</p>

        <button onClick={reset} style={{ display: 'block', width: '100%', marginTop: 20, padding: 14, background: '#333', color: '#fff', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: 'pointer' }}>
          下一筆
        </button>
      </div>
      </KioskShell>
    );
  }

  // ── 輸入畫面 ──
  return (
    <KioskShell>
    <div style={{ maxWidth: 460, margin: '0 auto', padding: '32px 16px 48px', fontFamily: '-apple-system, sans-serif', color: '#333' }}>
      <a href="/" style={{ display: 'inline-block', marginBottom: 14, fontSize: 17, fontWeight: 700, color: '#06C755', textDecoration: 'none' }}>🏠 主選單</a>
      <h1 style={{ fontSize: '1.7rem', fontWeight: 700, color: '#06C755', textAlign: 'center' }}>📦 取件</h1>
      <p style={{ color: '#666', marginTop: 4, textAlign: 'center' }}>輸入 6 位取件碼（或掃描貼紙 QR）</p>

      {/* 藏一個 input 接掃碼槍／實體鍵盤，on-screen 也同步 */}
      <input
        ref={inputRef}
        value={code}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
          setCode(digits);
        }}
        inputMode="numeric"
        pattern="[0-9]*"
        autoFocus
        aria-label="取件碼"
        style={{
          display: 'block', width: '100%', marginTop: 20, padding: '18px 8px',
          fontSize: 34, fontWeight: 800, letterSpacing: 10, textAlign: 'center',
          border: '2px solid #06C755', borderRadius: 14, boxSizing: 'border-box',
          color: '#06C755', outline: 'none',
        }}
      />

      {error && (
        <div style={{ marginTop: 16, background: '#fee', border: '1px solid #fcc', borderRadius: 12, padding: 14, color: '#c33', textAlign: 'center' }}>
          <div style={{ fontWeight: 600 }}>{error}</div>
          <button onClick={reset} style={{ marginTop: 8, padding: '6px 16px', background: '#c33', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            ↻ 重新輸入
          </button>
        </div>
      )}

      <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <KeyButton key={d} label={d} onClick={() => pressDigit(d)} disabled={status === 'busy' || code.length >= 6} />
        ))}
        <button onClick={reset} style={keyStyle('#e5e7eb', '#333', status === 'busy')}>清</button>
        <KeyButton label="0" onClick={() => pressDigit('0')} disabled={status === 'busy' || code.length >= 6} />
        <button onClick={backspace} style={keyStyle('#e5e7eb', '#333', status === 'busy')}>⌫</button>
      </div>

      {status === 'busy' && <p style={{ marginTop: 16, color: '#999', textAlign: 'center' }}>處理中…</p>}

      <p style={{ marginTop: 24, color: '#aaa', fontSize: 13, textAlign: 'center' }}>
        尚未付款或球拍未送回，會顯示提示訊息。
      </p>
    </div>
    </KioskShell>
  );
}

function KeyButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={keyStyle('#fff', '#333', disabled)}>
      {label}
    </button>
  );
}

function keyStyle(bg: string, color: string, disabled: boolean): React.CSSProperties {
  return {
    height: 68,
    fontSize: 26,
    fontWeight: 700,
    background: bg,
    color,
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    boxShadow: '0 2px 8px rgba(0,0,0,.06)',
  };
}

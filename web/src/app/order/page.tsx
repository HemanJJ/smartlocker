'use client';

import { useEffect, useMemo, useState } from 'react';

interface StringItem {
  id: number;
  model: string;
  gauge: string;
  feature: string;
  maxTension: number;
  price: number;
}

interface OrderItem {
  orderNo: string;
  stringModel: string;
  tension: number;
  price: number;
  pickupCode: string;
  currentSlot: number | null;
  status: string;
}

const LINE_BOT_ID = process.env.NEXT_PUBLIC_LINE_BOT_ID || '@014uppgb';

export default function OrderPage() {
  const [strings, setStrings] = useState<StringItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tension, setTension] = useState(24);
  const [customerName, setCustomerName] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<OrderItem | null>(null);
  const [sessionCode, setSessionCode] = useState('');
  const [lineUserId, setLineUserId] = useState('');
  const [lineName, setLineName] = useState('');
  const [steps, setSteps] = useState<string[]>([]);

  function pushStep(msg: string) {
    setSteps((prev) => [...prev.slice(-19), msg]);
  }

  useEffect(() => {
    fetch('/api/strings')
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || '讀取線種失敗');
        setStrings(data.strings);
        if (data.strings.length) {
          setSelectedId(data.strings[0].id);
          setTension(Math.min(24, data.strings[0].maxTension));
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

    // 建立 kiosk 認證 session
    fetch('/api/kiosk-session', { method: 'POST' })
      .then((r) => r.json())
      .then((d) => { if (d.ok) { setSessionCode(d.code); pushStep('建立認證 session：' + d.code); } })
      .catch(() => {});
  }, []);

  // 輪詢認證狀態（客人加好友後點「認證」→ 綁定 LINE）
  useEffect(() => {
    if (!sessionCode) return;
    pushStep('等待客人加好友並點「✅ 認證」…');
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/kiosk-session?code=${sessionCode}`);
        const d = await r.json();
        if (d.ok && d.session?.linked) {
          setLineUserId(d.session.lineUserId);
          setLineName(d.session.lineName);
          pushStep('✅ 已認證：' + (d.session.lineName || d.session.lineUserId));
          clearInterval(timer);
        }
      } catch {}
    }, 1500);
    return () => clearInterval(timer);
  }, [sessionCode]);

  const selected = useMemo(
    () => strings.find((s) => s.id === selectedId) || null,
    [strings, selectedId]
  );

  function selectString(id: number) {
    setSelectedId(id);
    const s = strings.find((x) => x.id === id);
    if (s) setTension((t) => Math.min(t, s.maxTension));
  }

  async function submit() {
    if (!selected) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stringId: selected.id,
          tension,
          customerName,
          note,
          lineUserId,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '下單失敗');
      setResult(data.order);
      pushStep('下單成功 ' + data.order.orderNo + (lineUserId ? ' → 小票已推 LINE' : '（未認證，小票僅貼紙）'));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setResult(null);
    setCustomerName('');
    setNote('');
  }

  if (result) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '32px 16px', fontFamily: '-apple-system, sans-serif', color: '#333', textAlign: 'center' }}>
        <div style={{ fontSize: 48 }}>✅</div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: 4 }}>下單成功</h1>

        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 20, marginTop: 20 }}>
          <div style={{ color: '#999', fontSize: 14 }}>取件碼</div>
          <div style={{ fontSize: 42, fontWeight: 800, letterSpacing: 6, color: '#06C755' }}>{result.pickupCode}</div>
          <div style={{ color: '#999', fontSize: 14, marginTop: 8 }}>放進第 {result.currentSlot} 格</div>
          <div style={{ color: '#999', fontSize: 14, marginTop: 4 }}>{result.stringModel} · {result.tension} lbs · NT${result.price}</div>
        </div>

        <div style={{ background: '#e8f8ee', border: '1px solid #bfeccd', borderRadius: 16, padding: 16, marginTop: 16 }}>
          <div style={{ fontWeight: 700, color: '#06C755', fontSize: 15 }}>📱 加 LINE 傳此碼，收取件通知</div>
          <a
            href={`https://line.me/R/ti/p/${LINE_BOT_ID}`}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'block', marginTop: 10, padding: '12px 20px', background: '#06C755', color: '#fff', borderRadius: 10, textDecoration: 'none', fontWeight: 700, fontSize: 16 }}
          >
            開啟 LINE 綁定
          </a>
          <div style={{ color: '#888', fontSize: 13, marginTop: 8 }}>
            加好友後，把取件碼 {result.pickupCode} 傳給我們，就會留在對話中。
          </div>
        </div>

        <button onClick={reset} style={{ display: 'block', width: '100%', marginTop: 16, padding: 14, background: '#333', color: '#fff', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: 'pointer' }}>
          下一筆訂單
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '32px 16px', fontFamily: '-apple-system, sans-serif', color: '#333' }}>
      <h1 style={{ fontSize: '1.7rem', fontWeight: 700, color: '#06C755' }}>🏸 羽拍穿線下單</h1>
      <p style={{ color: '#666', marginTop: 4 }}>選線種 → 選磅數 → 下單</p>

      {loading && <p style={{ marginTop: 24, color: '#999' }}>載入線種中…</p>}

      {error && (
        <div style={{ marginTop: 16, background: '#fee', border: '1px solid #fcc', borderRadius: 12, padding: 14, color: '#c33' }}>
          {error}
        </div>
      )}

      {!loading && strings.length === 0 && (
        <div style={{ marginTop: 24, color: '#999' }}>尚無可用線種。</div>
      )}

      {!loading && strings.length > 0 && selected && (
        <div style={{ marginTop: 20 }}>
          <div style={{ background: lineUserId ? '#e8f8ee' : '#fff7e0', border: `1px solid ${lineUserId ? '#bfeccd' : '#f0d48a'}`, borderRadius: 16, padding: 16, fontSize: 15, lineHeight: 1.6 }}>
            {lineUserId ? (
              <div style={{ fontWeight: 700, color: '#06C755' }}>
                ✅ LINE 已認證{lineName ? `：${lineName}` : ''}
                <span style={{ fontWeight: 400, color: '#555', marginLeft: 4 }}>— 寄件後電子收據會直接送到你的 LINE</span>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <img
                  src={`/api/qr?text=${encodeURIComponent(`https://line.me/R/ti/p/${LINE_BOT_ID}`)}&w=200`}
                  alt="加好友 QR"
                  style={{ width: 110, height: 110, borderRadius: 8, border: '1px solid #ddd', background: '#fff' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>0️⃣ LINE 認證（選填）</div>
                  <div style={{ color: '#555', fontSize: 14, marginTop: 4 }}>
                    ① 掃左邊 QR 加好友 <b>{LINE_BOT_ID}</b>（已是好友可略過）
                    <br />② 在 LINE 對話<b>輸入「認證」兩字送出</b>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div style={{ fontWeight: 600, margin: '16px 0 8px' }}>1️⃣ 選擇線種</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {strings.map((s) => (
              <button
                key={s.id}
                onClick={() => selectString(s.id)}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: s.id === selected.id ? '2px solid #06C755' : '1px solid #e5e7eb',
                  background: s.id === selected.id ? '#e8f8ee' : '#fff',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ fontWeight: 700 }}>{s.model}</div>
                <div style={{ fontSize: 13, color: '#888' }}>{s.gauge}{s.feature && s.feature !== '—' ? ` · ${s.feature}` : ''}</div>
                <div style={{ fontSize: 13, color: '#06C755', fontWeight: 600, marginTop: 2 }}>NT${s.price}</div>
              </button>
            ))}
          </div>

          <div style={{ fontWeight: 600, margin: '24px 0 8px' }}>2️⃣ 選擇磅數</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => setTension((t) => Math.max(1, t - 1))} style={stepperStyle}>−</button>
            <input
              type="number"
              value={tension}
              min={1}
              max={selected.maxTension}
              onChange={(e) => setTension(Number(e.target.value))}
              style={{ width: 90, fontSize: 28, fontWeight: 700, textAlign: 'center', padding: '8px 0', border: '1px solid #ddd', borderRadius: 10 }}
            />
            <button onClick={() => setTension((t) => Math.min(selected.maxTension, t + 1))} style={stepperStyle}>＋</button>
            <span style={{ color: '#999', fontSize: 14 }}>上限 {selected.maxTension} lbs</span>
          </div>

          <div style={{ fontWeight: 600, margin: '24px 0 8px' }}>3️⃣ 選填（可不填）</div>
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="客人稱呼（選填）"
            style={{ width: '100%', padding: 12, border: '1px solid #ddd', borderRadius: 10, fontSize: 16, boxSizing: 'border-box' }}
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="備註（選填）"
            style={{ width: '100%', padding: 12, border: '1px solid #ddd', borderRadius: 10, fontSize: 16, boxSizing: 'border-box', marginTop: 10 }}
          />

          <button
            onClick={submit}
            disabled={submitting || !selected || tension < 1 || tension > selected.maxTension}
            style={{
              display: 'block', width: '100%', marginTop: 24, padding: 16,
              background: (submitting || tension < 1 || tension > selected.maxTension) ? '#ccc' : '#06C755',
              color: '#fff', border: 'none', borderRadius: 14, fontSize: 18, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {submitting ? '處理中…' : `確認下單 · NT$${selected.price}`}
          </button>

          {/* 除錯監聽：狀態框 + 步驟 */}
          <div style={{ marginTop: 20, background: '#1a1f2b', color: '#cfe3d2', borderRadius: 14, padding: 14, fontFamily: 'ui-monospace, monospace', fontSize: 13, lineHeight: 1.7 }}>
            <div style={{ fontWeight: 700, color: '#fff', marginBottom: 6 }}>🛠 除錯監聽</div>
            <div>session：{sessionCode || '…'}</div>
            <div>認證：{lineUserId ? `✅ ${lineName || '已綁定'}` : '未認證'}</div>
            <div style={{ marginTop: 6, color: '#9ab' }}>
              {steps.length ? steps.map((s, i) => <div key={i}>· {s}</div>) : '—'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const stepperStyle: React.CSSProperties = {
  width: 48,
  height: 48,
  fontSize: 24,
  fontWeight: 700,
  background: '#f0f0f0',
  border: '1px solid #ddd',
  borderRadius: 10,
  cursor: 'pointer',
};

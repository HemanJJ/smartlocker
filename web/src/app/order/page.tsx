'use client';

import { useEffect, useMemo, useState } from 'react';

// Kiosk 版穿線下單：流程/邏輯/欄位與原版完全相同（不增不減）
// 只把畫面打散成 3 步大卡：① 選線種 → ② 選磅數 → ③ 選填＋下單
// 原版測通過的：LINE 綁定輪詢、60 秒未綁定作廢、綁定後 4 秒自動返回——全部保留。

interface StringItem {
  id: number;
  model: string;
  gauge: string;
  feature: string;
  maxTension: number;
  price: number;
}

interface OrderItem {
  id: number;
  orderNo: string;
  stringModel: string;
  tension: number;
  price: number;
  pickupCode: string;
  currentSlot: number | null;
  status: string;
  lineUserId: string;
  lineName: string;
}

const LINE_BOT_ID = process.env.NEXT_PUBLIC_LINE_BOT_ID || '@014uppgb';
const WAIT_BIND_SECONDS = 60; // 會員未綁定 LINE 的等待秒數，逾時作廢訂單並回下單頁
const DONE_SECONDS = 4;       // 綁定成功後顯示確認的秒數，自動回下單頁

export default function OrderPage() {
  const [strings, setStrings] = useState<StringItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tension, setTension] = useState(24);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<OrderItem | null>(null);
  const [waitSeconds, setWaitSeconds] = useState(WAIT_BIND_SECONDS);
  const [doneSeconds, setDoneSeconds] = useState(DONE_SECONDS);
  const [step, setStep] = useState(1); // 1 選線種 / 2 選磅數 / 3 選填＋下單
  const [tensionFocus, setTensionFocus] = useState(false); // 磅數框選中時亮框

  function reset() {
    setResult(null);
    setNote('');
    setWaitSeconds(WAIT_BIND_SECONDS);
    setDoneSeconds(DONE_SECONDS);
    setStep(1);
  }

  async function voidOrder(id: number) {
    try {
      await fetch(`/api/orders/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'void' }),
      });
    } catch {}
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
  }, []);

  // 下單後輪詢綁定狀態：客人掃 QR 加好友／點「綁定」→ 這筆訂單的 lineUserId 被填上
  useEffect(() => {
    if (!result || result.lineUserId) return;
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/orders/${result.id}`);
        const d = await r.json();
        if (d.ok && d.order?.lineUserId) {
          setResult(d.order);
          clearInterval(timer);
        }
      } catch {}
    }, 1500);
    return () => clearInterval(timer);
  }, [result]);

  // 未綁定：WAIT_BIND_SECONDS 秒倒數，逾時作廢訂單並回下單頁
  useEffect(() => {
    if (!result || result.lineUserId) return;
    let remaining = WAIT_BIND_SECONDS;
    const timer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(timer);
        voidOrder(result.id);
        reset();
      } else {
        setWaitSeconds(remaining);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [result]);

  // 綁定成功：顯示確認 DONE_SECONDS 秒後自動回下單頁
  useEffect(() => {
    if (!result || !result.lineUserId) return;
    let remaining = DONE_SECONDS;
    const timer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(timer);
        reset();
      } else {
        setDoneSeconds(remaining);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [result]);

  const selected = useMemo(
    () => strings.find((s) => s.id === selectedId) || null,
    [strings, selectedId]
  );

  function selectString(id: number) {
    setSelectedId(id);
    const s = strings.find((x) => x.id === id);
    if (s) setTension((t) => Math.min(t, s.maxTension));
    setStep(2);
  }

  async function submit() {
    if (!selected) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stringId: selected.id, tension, customerName: '', note }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '下單失敗');
      setResult(data.order);
      setWaitSeconds(WAIT_BIND_SECONDS);
      setDoneSeconds(DONE_SECONDS);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  // ── 結果畫面（原版內容不增不減，字級放大） ──
  if (result) {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '32px 16px', fontFamily: '-apple-system, sans-serif', color: '#333', textAlign: 'center' }}>
        <div style={{ textAlign: 'left' }}><a href="/" style={{ display: 'inline-block', marginBottom: 12, fontSize: 17, fontWeight: 700, color: '#06C755', textDecoration: 'none' }}>🏠 主選單</a></div>
        <div style={{ fontSize: 64 }}>✅</div>
        <h1 style={{ fontSize: '1.8rem', fontWeight: 700, marginTop: 4 }}>下單完成</h1>

        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 20, padding: 24, marginTop: 20 }}>
          <div style={{ color: '#999', fontSize: 15 }}>取件碼</div>
          <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: 8, color: '#06C755' }}>{result.pickupCode}</div>
          {result.currentSlot != null ? (
            <div style={{ color: '#999', fontSize: 15, marginTop: 8 }}>放進第 <b style={{ color: '#06C755', fontSize: 20 }}>{result.currentSlot}</b> 格</div>
          ) : (
            <div style={{ color: '#c90', fontSize: 15, marginTop: 8 }}>綁定 LINE 後自動分配格口</div>
          )}
          <div style={{ color: '#999', fontSize: 15, marginTop: 4 }}>{result.stringModel} · {result.tension} lbs · NT${result.price}</div>
        </div>

        {result.lineUserId ? (
          <div style={{ background: '#e8f8ee', border: '1px solid #bfeccd', borderRadius: 16, padding: 18, marginTop: 16 }}>
            <div style={{ fontWeight: 700, color: '#06C755', fontSize: 17 }}>
              ✅ 已綁定 LINE{result.lineName ? `：${result.lineName}` : ''}
            </div>
            <div style={{ color: '#555', fontSize: 14, marginTop: 6 }}>電子收據已送到你的 LINE 對話。</div>
            <div style={{ color: '#999', fontSize: 14, marginTop: 6 }}>{doneSeconds} 秒後自動回到下單頁</div>
          </div>
        ) : (
          <div style={{ background: '#fff7e0', border: '1px solid #f0d48a', borderRadius: 16, padding: 18, marginTop: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>📱 掃 QR 加好友，收電子收據</div>
            <img
              src={`/api/qr?text=${encodeURIComponent(`https://line.me/R/ti/p/${LINE_BOT_ID}`)}&w=220`}
              alt="加好友 QR"
              style={{ width: 180, height: 180, marginTop: 10, borderRadius: 8, border: '1px solid #ddd', background: '#fff' }}
            />
            <div style={{ color: '#777', fontSize: 14, marginTop: 8, lineHeight: 1.7 }}>
              ① 拿手機掃 QR 打開 LINE 對話
              <br />② 把上方的 6 位取件碼直接傳過去
            </div>
            <div style={{ color: '#c33', fontWeight: 700, fontSize: 15, marginTop: 10 }}>
              ⏱ {waitSeconds} 秒內未綁定，本單將自動作廢
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── 三步流程畫面（內容與原版相同，只打散成大卡） ──
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 16px', fontFamily: '-apple-system, sans-serif', color: '#333' }}>
      <a href="/" style={{ display: 'inline-block', marginBottom: 12, fontSize: 17, fontWeight: 700, color: '#06C755', textDecoration: 'none' }}>🏠 主選單</a>
      <h1 style={{ fontSize: '1.9rem', fontWeight: 700, color: '#06C755' }}>🏸 羽拍穿線下單</h1>
      <p style={{ color: '#666', marginTop: 4 }}>選線種 → 選磅數 → 下單</p>

      {loading && <p style={{ marginTop: 24, color: '#999' }}>載入線種中…</p>}

      {error && (
        <div style={{ marginTop: 16, background: '#fee', border: '1px solid #fcc', borderRadius: 12, padding: 14, color: '#c33' }}>
          <div>{error}</div>
          <button onClick={() => window.location.reload()} style={{ marginTop: 8, padding: '8px 18px', background: '#c33', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            ↻ 重新整理
          </button>
        </div>
      )}

      {!loading && strings.length === 0 && (
        <div style={{ marginTop: 24, color: '#999' }}>尚無可用線種。</div>
      )}

      {/* 步驟 1：選線種（原版卡片，放大） */}
      {!loading && strings.length > 0 && selected && step === 1 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>1️⃣ 選擇線種</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {strings.map((s) => (
              <button
                key={s.id}
                onClick={() => selectString(s.id)}
                style={{
                  textAlign: 'left',
                  padding: '20px 18px',
                  borderRadius: 18,
                  border: s.id === selected.id ? '3px solid #06C755' : '2px solid #e5e7eb',
                  background: s.id === selected.id ? '#e8f8ee' : '#fff',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  boxShadow: '0 2px 8px rgba(0,0,0,.05)',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 22 }}>{s.model}</div>
                <div style={{ fontSize: 15, color: '#888' }}>{s.gauge}{s.feature && s.feature !== '—' ? ` · ${s.feature}` : ''}</div>
                <div style={{ fontSize: 16, color: '#06C755', fontWeight: 700, marginTop: 4 }}>NT${s.price}</div>
                <div style={{ fontSize: 13, color: '#aaa', marginTop: 2 }}>最高 {s.maxTension} lbs</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 步驟 2：選磅數（原版 −/＋ 與數字框，放大） */}
      {!loading && strings.length > 0 && selected && step === 2 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>2️⃣ 選擇磅數 · {selected.model}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button onClick={() => setTension((t) => Math.max(1, t - 1))} style={{ ...stepperStyle, width: 76, height: 76, fontSize: 36 }}>−</button>
            {/* 唯讀數字框：kiosk 不跳鍵盤；選中時亮綠框 */}
            <div
              onFocus={() => setTensionFocus(true)}
              onBlur={() => setTensionFocus(false)}
              tabIndex={0}
              style={{
                width: 130, textAlign: 'center', padding: '10px 0', borderRadius: 14,
                border: `3px solid ${tensionFocus ? '#06C755' : '#ddd'}`,
                background: tensionFocus ? '#e8f8ee' : '#fff',
                boxShadow: tensionFocus ? '0 0 0 6px rgba(6,199,85,.15)' : 'none',
                outline: 'none', cursor: 'pointer', transition: 'border-color .15s, box-shadow .15s',
              }}
            >
              <div style={{ fontSize: 44, fontWeight: 900, lineHeight: 1.1 }}>{tension}</div>
              <div style={{ fontSize: 15, color: '#888' }}>磅</div>
            </div>
            <button onClick={() => setTension((t) => Math.min(selected.maxTension, t + 1))} style={{ ...stepperStyle, width: 76, height: 76, fontSize: 36 }}>＋</button>
            <span style={{ color: '#999', fontSize: 16 }}>上限 {selected.maxTension} lbs</span>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
            <button onClick={() => setStep(1)} style={{ ...navBtn, background: '#f0f0f0', color: '#666' }}>← 上一步</button>
            <button onClick={() => setStep(3)} style={{ ...navBtn, background: '#06C755', color: '#fff' }}>下一步 ▶</button>
          </div>
        </div>
      )}

      {/* 步驟 3：選填＋下單（原版兩個輸入框，不增不減） */}
      {!loading && strings.length > 0 && selected && step === 3 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>3️⃣ 選填（可不填）</div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例：拆舊線 / 加厚握把 / 兩支拍（選填）"
            style={{ width: '100%', padding: 16, border: '2px solid #ddd', borderRadius: 14, fontSize: 20, boxSizing: 'border-box' }}
          />

          <div style={{ marginTop: 18, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 16, fontSize: 18 }}>
            <div>{selected.model}（{selected.gauge}）· <b>{tension}</b> lbs · NT$<b>{selected.price}</b></div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            <button onClick={() => setStep(2)} style={{ ...navBtn, background: '#f0f0f0', color: '#666' }}>← 上一步</button>
            <button
              onClick={submit}
              disabled={submitting || !selected || tension < 1 || tension > selected.maxTension}
              style={{
                ...navBtn, flex: 2,
                background: (submitting || tension < 1 || tension > selected.maxTension) ? '#ccc' : '#06C755',
                color: '#fff', cursor: (submitting || tension < 1 || tension > selected.maxTension) ? 'default' : 'pointer',
              }}
            >
              {submitting ? '處理中…' : `確認下單 · NT$${selected.price}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const stepperStyle: React.CSSProperties = {
  width: 56,
  height: 56,
  fontSize: 28,
  fontWeight: 700,
  background: '#f0f0f0',
  border: '2px solid #ddd',
  borderRadius: 14,
  cursor: 'pointer',
};

const navBtn: React.CSSProperties = {
  flex: 1,
  padding: '18px 0',
  fontSize: 20,
  fontWeight: 700,
  border: 'none',
  borderRadius: 14,
  cursor: 'pointer',
};

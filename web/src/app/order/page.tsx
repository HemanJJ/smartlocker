'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import KioskShell from '@/components/KioskShell';

// Kiosk 版穿線下單：流程/邏輯/欄位與原版完全相同（不增不減）
// 畫面改為「品牌分組、一框無滑」drill-down（照 kiosk-mockup 打樣）：
//   ① 選品牌 → ② 選線種（該品牌 grid）→ ③ 選磅數＋顏色 → ④ 選填＋下單
// 原版測通過的：LINE 綁定輪詢、60 秒未綁定作廢、綁定後 4 秒自動返回——全部保留。

interface StringItem {
  id: number;
  model: string;
  gauge: string;
  feature: string;
  maxTension: number;
  price: number;
  colors: string[];
  brand: string;
}

interface OrderItem {
  id: number;
  orderNo: string;
  stringModel: string;
  color: string;
  tension: number;
  price: number;
  pickupCode: string;
  currentSlot: number | null;
  status: string;
  lineUserId: string;
  lineName: string;
}

type Screen = 'brand' | 'line' | 'tension' | 'confirm';

const LINE_BOT_ID = process.env.NEXT_PUBLIC_LINE_BOT_ID || '@014uppgb';
const WAIT_BIND_SECONDS = 120; // 會員未綁定 LINE 的等待秒數，逾時作廢訂單並回下單頁
const DONE_SECONDS = 20;       // 綁定成功後顯示確認的秒數（含放拍時間），自動回下單頁；語音 ~5s 播完，留 ~15s 放拍

export default function OrderPage() {
  const [strings, setStrings] = useState<StringItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [screen, setScreen] = useState<Screen>('brand');
  const [brand, setBrand] = useState('ALL'); // 選中的品牌；'ALL'＝全部
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tension, setTension] = useState(24);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<OrderItem | null>(null);
  const [waitSeconds, setWaitSeconds] = useState(WAIT_BIND_SECONDS);
  const [doneSeconds, setDoneSeconds] = useState(DONE_SECONDS);
  const [tensionFocus, setTensionFocus] = useState(false); // 磅數框選中時亮框
  const [color, setColor] = useState(''); // 顏色（''＝不指定）
  const [confirmingAbandon, setConfirmingAbandon] = useState(false); // 放棄此單 二次確認

  function reset() {
    setResult(null);
    setNote('');
    setColor('');
    setSelectedId(null);
    setBrand('ALL');
    setWaitSeconds(WAIT_BIND_SECONDS);
    setDoneSeconds(DONE_SECONDS);
    setConfirmingAbandon(false);
    setScreen('brand');
  }

  // kiosk 語音（走網頁 <audio>，任何裝置都能播；wav 在 /kiosk-voice/）
  const audioRef = useRef<HTMLAudioElement | null>(null);
  function playVoice(name: string) {
    try {
      // 先停掉上一段音訊，避免新一輪語音與上一輪重疊
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current = null;
      }
      const a = new Audio(`/kiosk-voice/${name}.wav`);
      audioRef.current = a;
      void a.play().catch(() => {});
    } catch {}
  }

  // 引導用語：選線種（品牌/線種）→ 選磅數 → 確認下單
  useEffect(() => {
    if (screen === 'brand' || screen === 'line') playVoice('guide-step1');
    else if (screen === 'tension') playVoice('guide-step2');
    else if (screen === 'confirm') playVoice('guide-step3');
  }, [screen]);

  // 綁定完成 → 放拍語音（此時已有櫃號）＋ 請等待櫃門開啟
  const bound = result?.lineUserId;
  useEffect(() => {
    if (bound) {
      playVoice('anon-order'); // 請依櫃號，將球拍放入櫃中
      setTimeout(() => playVoice('wait-open'), 2950); // anon-order(2.85s)播完後再播「請等待五秒櫃門開啟」
    }
  }, [bound]);

  async function voidOrder(id: number) {
    try {
      await fetch(`/api/orders/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'void' }),
      });
    } catch {}
  }

  // 客人放棄這張未綁定的單（下次穿線／重新選線用）→ 作廢＋回主選單
  async function abandonOrder() {
    if (!result) return;
    await voidOrder(result.id);
    reset();
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

  // 品牌去重（照資料裡的 brand 分組；48+ 線種照樣擴充＝加品牌/分類）
  const brands = useMemo(() => {
    const set = new Set<string>();
    strings.forEach((s) => s.brand && set.add(s.brand));
    return Array.from(set);
  }, [strings]);

  // 該品牌（或全部）的線種
  const brandStrings = useMemo(
    () => (brand === 'ALL' ? strings : strings.filter((s) => s.brand === brand)),
    [brand, strings]
  );

  function pickBrand(b: string) {
    setBrand(b);
    setScreen('line');
  }

  function selectString(id: number) {
    setSelectedId(id);
    const s = strings.find((x) => x.id === id);
    if (s) setTension((t) => Math.min(t, s.maxTension));
    setColor(''); // 換線種就清掉顏色（色綁線種）
    setScreen('tension');
  }

  async function submit() {
    if (!selected) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stringId: selected.id, tension, color, customerName: '', note }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '下單失敗');
      setResult(data.order);
      setWaitSeconds(WAIT_BIND_SECONDS);
      setDoneSeconds(DONE_SECONDS);
      playVoice('anon-bind'); // 綁定提醒：訂單已建立，請掃 QR 完成綁定（此時還未配格）
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  // ── 結果畫面（原版內容不增不減，字級放大） ──
  if (result) {
    return (
      <KioskShell>
      <div style={{ minHeight: '100vh', background: '#f4f6f8', fontFamily: '-apple-system, sans-serif', color: '#333', textAlign: 'center' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 16px 32px' }}>
        <div style={{ textAlign: 'left' }}><a href="/" style={{ display: 'inline-block', marginBottom: 8, fontSize: 17, fontWeight: 700, color: '#06C755', textDecoration: 'none' }}>🏠 主選單</a></div>
        <div style={{ fontSize: 44, lineHeight: 1.1 }}>✅</div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: 2 }}>下單完成</h1>

        {/* 取件碼＋綁定 QR：一卡並排，矮視窗也能看到 QR */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 20, padding: '16px 20px', marginTop: 12 }}>
          <div style={{ color: '#999', fontSize: 14 }}>取件碼</div>
          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: 8, color: '#06C755', lineHeight: 1.2 }}>{result.pickupCode}</div>
          {result.currentSlot != null ? (
            <div style={{ color: '#999', fontSize: 14, marginTop: 4 }}>放進第 <b style={{ color: '#06C755', fontSize: 18 }}>{result.currentSlot}</b> 格</div>
          ) : (
            <div style={{ color: '#c90', fontSize: 14, marginTop: 4 }}>綁定 LINE 後自動分配格口</div>
          )}
          <div style={{ color: '#999', fontSize: 14, marginTop: 2 }}>{result.stringModel}{result.color ? ` · ${result.color}` : ''} · {result.tension} lbs · NT${result.price}</div>
        </div>

        {result.lineUserId ? (
          <div style={{ background: '#e8f8ee', border: '1px solid #bfeccd', borderRadius: 16, padding: 16, marginTop: 12 }}>
            <div style={{ fontWeight: 700, color: '#06C755', fontSize: 17 }}>
              ✅ 已綁定 LINE{result.lineName ? `：${result.lineName}` : ''}
            </div>
            <div style={{ color: '#555', fontSize: 14, marginTop: 6 }}>電子收據已送到你的 LINE 對話。</div>
            <div style={{ color: '#999', fontSize: 14, marginTop: 6 }}>{doneSeconds} 秒後自動回到下單頁</div>
          </div>
        ) : (
          <div style={{ background: '#fff7e0', border: '1px solid #f0d48a', borderRadius: 16, padding: 16, marginTop: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>📱 掃 QR 加好友，收電子收據</div>
            {/* QR 與說明並排：QR 永遠在視窗內可見 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <img
                src={`/api/qr?text=${encodeURIComponent(`https://line.me/R/ti/p/${LINE_BOT_ID}`)}&w=220`}
                alt="加好友 QR"
                style={{ width: 160, height: 160, borderRadius: 8, border: '1px solid #ddd', background: '#fff', flexShrink: 0 }}
              />
              <div style={{ textAlign: 'left', color: '#777', fontSize: 14, lineHeight: 1.7, minWidth: 150 }}>
                ① 拿手機掃 QR 打開 LINE 對話
                <br />② 把上方取件碼直接傳過去
                <div style={{ color: '#c33', fontWeight: 700, marginTop: 6 }}>
                  ⏱ {waitSeconds} 秒內未綁定，本單作廢
                </div>
              </div>
            </div>
            {confirmingAbandon ? (
              <div style={{ display: 'flex', gap: 10, marginTop: 12, justifyContent: 'center' }}>
                <button onClick={() => setConfirmingAbandon(false)} style={{ ...navBtn, flex: 1, background: '#f0f0f0', color: '#666' }}>再想想</button>
                <button onClick={abandonOrder} style={{ ...navBtn, flex: 1, background: '#e5484d', color: '#fff' }}>確定放棄此單</button>
              </div>
            ) : (
              <button onClick={() => setConfirmingAbandon(true)} style={{ display: 'block', margin: '14px auto 0', padding: '12px 24px', background: 'transparent', border: '2px solid #d9a05b', color: '#b8860b', borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>✕ 放棄此單（下次穿線／重選線）</button>
            )}
          </div>
        )}
        </div>
      </div>
      </KioskShell>
    );
  }

  // ── 品牌分組、一框無滑 drill-down ──
  const stepNum = { brand: 1, line: 2, tension: 3, confirm: 4 }[screen];

  return (
    <KioskShell>
    <div style={{ minHeight: '100vh', background: '#f4f6f8', fontFamily: '-apple-system, sans-serif', color: '#333' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <a href="/" style={{ display: 'inline-block', fontSize: 17, fontWeight: 700, color: '#06C755', textDecoration: 'none' }}>🏠 主選單</a>
      </div>
      <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#06C755' }}>🏸 羽拍穿線下單</h1>
      <StepTracker step={stepNum} />

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

      {!loading && strings.length > 0 && !result && (
        <div style={{ marginTop: 20 }}>

          {/* ① 選品牌 */}
          {screen === 'brand' && (
            <div>
              <h2 style={{ fontSize: 26, fontWeight: 800, marginBottom: 18 }}>請選擇線種品牌</h2>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <button onClick={() => pickBrand('ALL')} style={{ ...brandChip }}>
                  全部線種
                </button>
                {brands.map((b) => (
                  <button key={b} onClick={() => pickBrand(b)} style={{ ...brandChip }}>
                    {b} 系列
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 14, color: '#aaa', marginTop: 18 }}>分組 drill-down → 每屏一框、大熱區、無 scroll。48+ 線種照樣擴充（加品牌/分類）</p>
            </div>
          )}

          {/* ② 選線種（該品牌 grid） */}
          {screen === 'line' && (
            <div>
              <h2 style={{ fontSize: 26, fontWeight: 800, marginBottom: 18 }}>請選擇線種 · {brand === 'ALL' ? '全部線種' : `${brand} 系列`}</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14 }}>
                {brandStrings.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => selectString(s.id)}
                    style={{
                      background: '#fff', border: '2px solid #e5e7eb', borderRadius: 18, padding: '22px 14px',
                      textAlign: 'center', cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    <div style={{ fontSize: 26, fontWeight: 800 }}>{s.model}</div>
                    <div style={{ fontSize: 17, color: '#888', marginTop: 4 }}>{s.gauge}{s.feature && s.feature !== '—' ? ` · ${s.feature}` : ''}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#06C755', marginTop: 10 }}>NT${s.price}</div>
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 22 }}>
                <button onClick={() => setScreen('brand')} style={{ ...navBtn, background: '#f0f0f0', color: '#666' }}>← 返回</button>
              </div>
            </div>
          )}

          {/* ③ 選磅數＋顏色 */}
          {screen === 'tension' && selected && (
            <div>
              <h2 style={{ fontSize: 26, fontWeight: 800, marginBottom: 18 }}>請選擇磅數 · {selected.model}</h2>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                <button onClick={() => setTension((t) => Math.max(1, t - 1))} style={{ ...stepperBig }}>−</button>
                <div
                  onFocus={() => setTensionFocus(true)}
                  onBlur={() => setTensionFocus(false)}
                  tabIndex={0}
                  style={{
                    minWidth: 140, textAlign: 'center', padding: '12px 0', borderRadius: 16,
                    border: `3px solid ${tensionFocus ? '#06C755' : '#ddd'}`,
                    background: tensionFocus ? '#e8f8ee' : '#fff',
                    boxShadow: tensionFocus ? '0 0 0 8px rgba(6,199,85,.15)' : 'none',
                    outline: 'none', cursor: 'pointer', transition: 'border-color .15s, box-shadow .15s',
                  }}
                >
                  <div style={{ fontSize: 64, fontWeight: 900, lineHeight: 1.05 }}>{tension}</div>
                  <div style={{ fontSize: 18, color: '#888' }}>磅</div>
                </div>
                <button onClick={() => setTension((t) => Math.min(selected.maxTension, t + 1))} style={{ ...stepperBig }}>＋</button>
              </div>
              <div style={{ textAlign: 'center', color: '#999', fontSize: 16, marginTop: 8 }}>上限 {selected.maxTension} lbs</div>

              {/* 選顏色（綁線種：只出現這條線有的色） */}
              <h2 style={{ fontSize: 22, fontWeight: 800, margin: '26px 0 14px' }}>🎨 選擇顏色（可不選）</h2>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button onClick={() => setColor('')} style={{ ...colorChip, background: color === '' ? '#06C755' : '#fff', color: color === '' ? '#fff' : '#333', borderColor: color === '' ? '#06C755' : '#ddd' }}>不指定</button>
                {selected.colors.map((c) => (
                  <button key={c} onClick={() => setColor(c)} style={{ ...colorChip, background: color === c ? '#06C755' : '#fff', color: color === c ? '#fff' : '#333', borderColor: color === c ? '#06C755' : '#ddd' }}>{c}</button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 26 }}>
                <button onClick={() => setScreen('line')} style={{ ...navBtn, background: '#f0f0f0', color: '#666' }}>← 上一步</button>
                <button onClick={() => setScreen('confirm')} style={{ ...navBtn, background: '#06C755', color: '#fff' }}>確認磅數 ▶</button>
              </div>
            </div>
          )}

          {/* ④ 選填＋確認下單 */}
          {screen === 'confirm' && selected && (
            <div>
              <h2 style={{ fontSize: 26, fontWeight: 800, marginBottom: 18 }}>請確認訂單</h2>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 18, padding: 24, fontSize: 22, lineHeight: 1.9 }}>
                <div><b style={{ fontSize: 28 }}>{selected.model}</b>（{selected.gauge}）</div>
                <div><b>{tension}</b> 磅{color ? ` · ${color}` : ''}</div>
                <div>NT$<b style={{ color: '#06C755', fontSize: 28 }}>{selected.price}</b></div>
              </div>

              <h2 style={{ fontSize: 18, fontWeight: 700, margin: '20px 0 8px' }}>選填（可不填）</h2>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例：拆舊線 / 加厚握把 / 兩支拍（選填）"
                style={{ width: '100%', padding: 16, border: '2px solid #ddd', borderRadius: 14, fontSize: 20, boxSizing: 'border-box', background: '#fff', color: '#333' }}
              />

              <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                <button onClick={() => setScreen('tension')} style={{ ...navBtn, background: '#f0f0f0', color: '#666' }}>← 上一步</button>
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
      )}
      </div>
    </div>
    </KioskShell>
  );
}

const stepperBig: React.CSSProperties = {
  width: 96, height: 96, fontSize: 44, fontWeight: 800,
  background: '#f0f0f0', border: '2px solid #ddd', borderRadius: 20, cursor: 'pointer',
};

const brandChip: React.CSSProperties = {
  background: '#fff', border: '2px solid #ddd', borderRadius: 20, fontSize: 24, fontWeight: 700,
  padding: '22px 38px', minWidth: 180, textAlign: 'center', cursor: 'pointer', fontFamily: 'inherit',
};

const colorChip: React.CSSProperties = {
  minWidth: 72, padding: '14px 22px', fontSize: 20, fontWeight: 700,
  border: '2px solid #ddd', borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
};

const navBtn: React.CSSProperties = {
  flex: 1, padding: '18px 0', fontSize: 20, fontWeight: 700,
  border: 'none', borderRadius: 14,
};

// 物流式步驟進度條：4 階段，已完成打勾、當前亮綠、後段灰
const STEPS = [
  { icon: '🏸', label: '選品牌' },
  { icon: '🧵', label: '選線種' },
  { icon: '⚖️', label: '選磅數' },
  { icon: '✅', label: '確認' },
];

function StepTracker({ step }: { step: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', margin: '14px 0 4px' }}>
      {STEPS.map((s, i) => {
        const n = i + 1;
        const done = step > n;
        const active = step === n;
        const bg = active ? '#06C755' : done ? '#e8f8ee' : '#fff';
        const border = done || active ? '#06C755' : '#d1d5db';
        const fg = active ? '#fff' : done ? '#06C755' : '#9ca3af';
        return (
          <div key={n} style={{ display: 'flex', alignItems: 'flex-start' }}>
            {/* 連線（左側，除第一段） */}
            {i > 0 && (
              <div style={{ width: 26, height: 3, borderRadius: 2, background: step > i ? '#06C755' : '#d1d5db', marginTop: 22 }} />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 60 }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: bg, border: `2px solid ${border}`, fontSize: 21, lineHeight: 1, fontWeight: 700,
              }}>
                {done ? '✓' : s.icon}
              </div>
              <div style={{ fontSize: 13, fontWeight: active ? 800 : 500, color: done || active ? '#06C755' : '#9ca3af', marginTop: 5 }}>
                {s.label}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';

type S = {
  id: number; model: string; brand: string; gauge: string; feature: string;
  maxTension: number; price: number; isActive: boolean; colors: string[];
};

export default function AdminStrings() {
  const [rows, setRows] = useState<S[]>([]);
  const [form, setForm] = useState<S>({ id: 0, model: '', brand: '', gauge: '', feature: '', maxTension: 28, price: 250, isActive: true, colors: [] });
  const [msg, setMsg] = useState('');

  async function load() {
    try {
      const r = await fetch('/api/admin/strings?include_disabled=1');
      const j = await r.json().catch(() => null);
      if (r.status === 401) { window.location.href = '/admin/login'; return; }
      if (j && j.ok) setRows(j.strings || []);
      else setMsg('❌ 載入失敗：' + ((j && j.error) || ('HTTP ' + r.status)));
    } catch (e: any) {
      setMsg('❌ 載入異常：' + (e?.message || e));
    }
  }
  useEffect(() => { load(); }, []);

  const up = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const colorsStr = (arr: string[]) => arr.join(',');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    const payload = {
      model: form.model.trim(), brand: form.brand.trim(), gauge: form.gauge.trim(),
      feature: form.feature.trim(), maxTension: Number(form.maxTension), price: Number(form.price),
      colors: form.colors,
      isActive: form.isActive, // 編輯時可切在售/停售；新增預設在售
    };
    const url = form.id ? `/api/admin/strings/${form.id}` : '/api/admin/strings';
    const method = form.id ? 'PUT' : 'POST';
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then((x) => x.json());
    if (r.ok) { setMsg('✅ 已儲存'); setForm({ id: 0, model: '', brand: '', gauge: '', feature: '', maxTension: 28, price: 250, isActive: true, colors: [] }); load(); }
    else setMsg('❌ ' + (r.error || '失敗'));
  }
  async function disable(id: number) {
    await fetch(`/api/admin/strings/${id}`, { method: 'DELETE' });
    load();
  }
  async function enable(id: number) {
    await fetch(`/api/admin/strings/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: true }) });
    load();
  }
  function edit(s: S) { setForm(s); setMsg(''); window.scrollTo(0, 0); }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', maxWidth: 900, margin: '0 auto', padding: 24, fontFamily: 'system-ui', color: '#333' }}>
      <a href="/admin" style={{ display: 'inline-block', marginBottom: 10, fontSize: 16, fontWeight: 700, color: '#06C755', textDecoration: 'none' }}>← 回後台</a>
      <h1 style={{ fontSize: 26 }}>線種管理（店長自己加線種）</h1>
      <p style={{ color: '#888' }}>新增/編輯線種，品牌留空會依型號自動推導（AL-/YOUNG/BG…）。48+ 線種就是多加幾筆。</p>

      <form onSubmit={save} style={{ background: '#f6f8fa', borderRadius: 14, padding: 16, marginTop: 12 }}>
        <h3 style={{ margin: '0 0 10px' }}>{form.id ? `編輯 #${form.id}` : '新增線種'}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
          <label>型號<input style={inp} value={form.model} onChange={(e) => up('model', e.target.value)} placeholder="AL-99" required /></label>
          <label>品牌<input style={inp} value={form.brand} onChange={(e) => up('brand', e.target.value)} placeholder="自動推導" /></label>
          <label>線徑<input style={inp} value={form.gauge} onChange={(e) => up('gauge', e.target.value)} placeholder="0.70mm" /></label>
          <label>特性<input style={inp} value={form.feature} onChange={(e) => up('feature', e.target.value)} placeholder="硬線" /></label>
          <label>磅數上限<input style={inp} type="number" value={form.maxTension} onChange={(e) => up('maxTension', e.target.value)} /></label>
          <label>價格<input style={inp} type="number" value={form.price} onChange={(e) => up('price', e.target.value)} /></label>
          <label style={{ gridColumn: 'span 2' }}>顏色(逗號分隔)<input style={inp} value={form.colors.join(',')} onChange={(e) => up('colors', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))} placeholder="白,黃,黑,藍,紅" /></label>
          <label style={{ gridColumn: 'span 2' }}>狀態
            <select style={inp} value={form.isActive ? '1' : '0'} onChange={(e) => up('isActive', e.target.value === '1')}>
              <option value="1">在售（上架，客人可選）</option>
              <option value="0">停售（下架，客人看不到）</option>
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button style={btn}>儲存</button>
          {form.id ? <button type="button" style={btnGrey} onClick={() => setForm({ id: 0, model: '', brand: '', gauge: '', feature: '', maxTension: 28, price: 250, isActive: true, colors: [] })}>取消</button> : null}
          <span style={{ alignSelf: 'center', color: '#06C755', fontWeight: 700 }}>{msg}</span>
        </div>
      </form>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 20, fontSize: 15 }}>
        <thead><tr>{['型號', '品牌', '線徑', '磅數上限', '價格', '顏色', '狀態', '操作'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#999' }}>尚無線種資料（若載入失敗，見上方提示）</td></tr>
          )}
          {rows.map((s) => (
            <tr key={s.id} style={{ background: s.isActive ? '#fff' : '#f0f0f0', color: s.isActive ? '#222' : '#999' }}>
              <td style={td}>{s.model}</td>
              <td style={td}>{s.brand || '—'}</td>
              <td style={td}>{s.gauge}</td>
              <td style={td}>{s.maxTension}</td>
              <td style={td}>NT${s.price}</td>
              <td style={td}>{colorsStr(s.colors)}</td>
              <td style={td}>{s.isActive ? '在售' : '停用'}</td>
              <td style={td}>
                <button style={btnSmall} onClick={() => edit(s)}>編輯</button>{' '}
                {s.isActive
                  ? <button style={btnSmallDanger} onClick={() => disable(s.id)}>停用</button>
                  : <button style={btnSmall} onClick={() => enable(s.id)}>上架</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const inp: React.CSSProperties = { width: '100%', padding: 8, borderRadius: 8, border: '1px solid #ccc', marginTop: 4, fontSize: 15 };
const btn: React.CSSProperties = { background: '#06C755', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const btnGrey: React.CSSProperties = { ...btn, background: '#e5e7eb', color: '#555' };
const btnSmall: React.CSSProperties = { padding: '4px 10px', borderRadius: 6, border: '1px solid #06C755', color: '#06C755', background: '#fff', cursor: 'pointer', fontSize: 13 };
const btnSmallDanger: React.CSSProperties = { padding: '4px 10px', borderRadius: 6, border: '1px solid #d33', color: '#d33', background: '#fff', cursor: 'pointer', fontSize: 13, marginLeft: 6 };
const th: React.CSSProperties = { textAlign: 'left', padding: 10, borderBottom: '1px solid #ccc' };
const td: React.CSSProperties = { padding: 10, borderBottom: '1px solid #eee' };

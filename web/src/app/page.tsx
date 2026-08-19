export default function Home() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', fontFamily: '-apple-system, sans-serif', background: '#f5f5f5', color: '#333'
    }}>
      <h1 style={{ fontSize: '2.2rem', fontWeight: 700, color: '#06C755' }}>🏸 羽拍有約</h1>
      <p style={{ marginTop: 8, color: '#666', fontSize: 18 }}>請選擇服務</p>

      <div style={{ marginTop: 40, display: 'flex', gap: 28, flexWrap: 'wrap', justifyContent: 'center' }}>
        <BigIcon href="/order" emoji="🏸" label="寄拍穿線" color="#06C755" />
        <BigIcon href="/admin" emoji="👤" label="員工後台" color="#3b82f6" />
        <BigIcon emoji="📦" label="取件" color="#f5b301" disabled />
      </div>

      <p style={{ marginTop: 40, color: '#999', fontSize: 13 }}>
        取件功能待格口硬體接上後開放（目前請洽櫃檯）
      </p>
    </div>
  );
}

function BigIcon({ href, emoji, label, color, disabled }: { href?: string; emoji: string; label: string; color: string; disabled?: boolean }) {
  const style: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    width: 180, height: 180, background: disabled ? '#e5e7eb' : color, color: disabled ? '#999' : '#fff',
    borderRadius: 24, textDecoration: 'none', boxShadow: '0 4px 14px rgba(0,0,0,.12)',
  };
  const inner = (
    <>
      <div style={{ fontSize: 64 }}>{emoji}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 10 }}>{label}</div>
      {disabled && <div style={{ fontSize: 12, marginTop: 4 }}>即將開放</div>}
    </>
  );
  if (disabled || !href) return <div style={style}>{inner}</div>;
  return <a href={href} style={style}>{inner}</a>;
}

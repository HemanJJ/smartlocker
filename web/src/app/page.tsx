export default function Home() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', fontFamily: '-apple-system, sans-serif', background: '#f5f5f5', color: '#333'
    }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 700, color: '#06C755' }}>🏸 迪飛羽球館 · 穿線服務</h1>
      <p style={{ marginTop: '1rem', color: '#666' }}>羽拍穿線 · kiosk 下單 / 員工後台</p>
      <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        <a href="/order" style={linkStyle}>🧵 kiosk 下單</a>
        <a href="/admin" style={linkStyle}>👤 員工後台</a>
        <a href="/api/health" style={linkStyle}>✅ Health Check</a>
      </div>
    </div>
  );
}

const linkStyle: React.CSSProperties = {
  padding: '12px 24px', background: '#06C755', color: 'white', borderRadius: '10px',
  textDecoration: 'none', fontSize: '18px', fontWeight: 600
};

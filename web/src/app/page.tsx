import StringMachineIcon from '@/components/StringMachineIcon';

export default function Home() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', fontFamily: '-apple-system, sans-serif', background: '#f5f5f5', color: '#333'
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/dearfly-logo.png" alt="Dearfly" style={{ height: 72, width: 'auto', marginBottom: 8 }} />
      <h1 style={{ fontSize: '2.2rem', fontWeight: 700, color: '#06C755' }}>Dearfly · 24h 無人店</h1>
      <p style={{ marginTop: 8, color: '#666', fontSize: 18 }}>訂場・穿線・補給，一條 LINE 全搞定</p>

      {/* 第一層：主服務（2×2） */}
      <div style={{ marginTop: 40, display: 'flex', gap: 28, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 640 }}>
        <BigIcon href="/order" icon={<StringMachineIcon />} label="寄拍穿線" color="#06C755" />
        <BigIcon href="/store?cat=badminton" icon={<Emoji emoji="🏸" />} label="羽球用品" color="#3b82f6" />
        <BigIcon href="/store?cat=ramen" icon={<Emoji emoji="🍜" />} label="泡麵" color="#f59e0b" />
        <BigIcon href="/pickup" icon={<Emoji emoji="📦" />} label="取件" color="#ec4899" />
      </div>

      {/* 第二層入口＋後台：細字不搶眼 */}
      <p style={{ marginTop: 40, color: '#999', fontSize: 13 }}>
        取件：輸入取件碼即可開格（模擬板可直接測試）
      </p>
      <p style={{ marginTop: 8, color: '#bbb', fontSize: 13 }}>
        <a href="/store" style={{ color: '#bbb', textDecoration: 'none' }}>其他用品</a>
        <span style={{ margin: '0 10px' }}>·</span>
        <a href="/admin" style={{ color: '#bbb', textDecoration: 'none' }}>員工後台</a>
      </p>
    </div>
  );
}

/** 給 BigIcon 用的 emoji 包裝（維持原 64px 大小） */
function Emoji({ emoji }: { emoji: string }) {
  return <span style={{ fontSize: 64, lineHeight: 1 }}>{emoji}</span>;
}

function BigIcon({ href, icon, label, color, disabled }: { href?: string; icon: React.ReactNode; label: string; color: string; disabled?: boolean }) {
  const style: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    width: 180, height: 180, background: disabled ? '#e5e7eb' : color, color: disabled ? '#999' : '#fff',
    borderRadius: 24, textDecoration: 'none', boxShadow: '0 4px 14px rgba(0,0,0,.12)',
  };
  const inner = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 64 }}>{icon}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 10 }}>{label}</div>
      {disabled && <div style={{ fontSize: 12, marginTop: 4 }}>即將開放</div>}
    </>
  );
  if (disabled || !href) return <div style={style}>{inner}</div>;
  return <a href={href} style={style}>{inner}</a>;
}

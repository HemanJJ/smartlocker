import { listCatalog, type VendingCategory } from '@/lib/vending';

export const dynamic = 'force-dynamic';

// Kiosk 版商店（瀏覽用）：① 分類大卡 → ② 商品大卡
// 不碰付款/購物車（Phase 2 金流才做）；資料照舊從庫存表來。

const CATS: Record<VendingCategory, { emoji: string; name: string; desc: string }> = {
  badminton: { emoji: '🏸', name: '羽球用品', desc: '球・拍線・握把布' },
  ramen: { emoji: '🍜', name: '泡麵', desc: '24h 熱呼呼' },
  other: { emoji: '🛒', name: '其他', desc: '零食・小物' },
};

export default async function StorePage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; venue?: string }>;
}) {
  const { cat, venue } = await searchParams;
  const venueId = Number(venue ?? 1);
  const items = await listCatalog(venueId);
  const showCat = cat && cat in CATS ? (cat as VendingCategory) : null;

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', color: '#333', fontFamily: '-apple-system, "PingFang TC", sans-serif', display: 'flex', flexDirection: 'column' }}>
      {/* 頂部：主選單＋狀態 */}
      <div style={{ maxWidth: 800, margin: '0 auto', width: '100%', padding: '14px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <a href="/" style={{ fontSize: 17, fontWeight: 700, color: '#06C755', textDecoration: 'none' }}>🏠 主選單</a>
        <span style={{ fontSize: 12, color: '#b45309', background: '#fff7ed', borderRadius: 99, padding: '4px 12px' }}>
          展示中：正式販售待金流開通（Phase 2）
        </span>
      </div>

      {/* ① 分類大卡 */}
      {!showCat && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 800, margin: '0 auto', width: '100%', padding: 24 }}>
          <h1 style={{ fontSize: 36, fontWeight: 900, color: '#06C755', textAlign: 'center' }}>🛍️ 用品與吃食</h1>
          <p style={{ textAlign: 'center', color: '#888', fontSize: 17, marginTop: 4 }}>請選擇分類</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18, marginTop: 28 }}>
            {(Object.keys(CATS) as VendingCategory[]).map((key) => (
              <a key={key} href={`/store?cat=${key}`}
                style={{ background: '#fff', border: '2px solid #e5e7eb', borderRadius: 26, padding: '40px 16px', textAlign: 'center', cursor: 'pointer', color: '#333', textDecoration: 'none', boxShadow: '0 2px 10px rgba(0,0,0,.05)' }}>
                <div style={{ fontSize: 76 }}>{CATS[key].emoji}</div>
                <div style={{ fontSize: 30, fontWeight: 800, marginTop: 12 }}>{CATS[key].name}</div>
                <div style={{ fontSize: 15, color: '#888', marginTop: 4 }}>{CATS[key].desc}</div>
              </a>
            ))}
          </div>
          <p style={{ textAlign: 'center', color: '#aaa', fontSize: 14, marginTop: 22 }}>點選分類瀏覽商品</p>
        </div>
      )}

      {/* ② 商品大卡 */}
      {showCat && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', maxWidth: 800, margin: '0 auto', width: '100%', padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 30, fontWeight: 900 }}>{CATS[showCat].emoji} {CATS[showCat].name}</h2>
            <a href="/store" style={{ fontSize: 18, fontWeight: 700, color: '#666', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: 12, padding: '10px 22px', textDecoration: 'none' }}>← 上一步</a>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginTop: 18 }}>
            {items.filter((i) => i.category === showCat).map((it) => {
              const out = it.qty <= 0;
              return (
                <div key={it.sku}
                  style={{ background: '#fff', border: '2px solid #e5e7eb', borderRadius: 22, padding: 24, display: 'flex', alignItems: 'center', gap: 16, opacity: out ? 0.5 : 1, boxShadow: '0 2px 10px rgba(0,0,0,.05)' }}>
                  <span style={{ fontSize: 52 }}>{CATS[showCat].emoji}</span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 22, fontWeight: 700 }}>{it.name}</span>
                    <span style={{ display: 'block', fontSize: 26, fontWeight: 900, color: '#06C755', marginTop: 4 }}>
                      {it.price > 0 ? `NT$ ${it.price}` : '待定價'}
                    </span>
                  </span>
                  <span style={{
                    fontSize: 14, padding: '4px 12px', borderRadius: 99, whiteSpace: 'nowrap',
                    color: out ? '#b45309' : '#fff', background: out ? '#fef3c7' : '#06C755',
                  }}>
                    {out ? '缺貨' : '有貨'}
                  </span>
                </div>
              );
            })}
          </div>
          <a href="/" style={{ marginTop: 24, textAlign: 'center', color: '#06C755', textDecoration: 'none', fontSize: 17, fontWeight: 700 }}>🏠 回主選單</a>
        </div>
      )}
    </div>
  );
}

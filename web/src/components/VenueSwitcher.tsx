'use client';

import { useEffect, useState } from 'react';

// 分店切換器：選分店 → 存 localStorage → 該頁重新載入該店資料
export default function VenueSwitcher({ onVenueChange }: { onVenueChange: (venueId: number) => void }) {
  const [venues, setVenues] = useState<{ id: number; name: string }[]>([]);
  const [venue, setVenue] = useState(1);

  useEffect(() => {
    const saved = Number(localStorage.getItem('skb_venue') || 1);
    setVenue(saved);
    fetch('/api/venues')
      .then((r) => r.json())
      .then((j) => {
        setVenues(j.venues ?? []);
        // 存的店不存在時回第 1 店
        if (j.venues?.length && !j.venues.some((v: any) => v.id === saved)) {
          setVenue(1);
          localStorage.setItem('skb_venue', '1');
          onVenueChange(1);
        }
      })
      .catch(() => {});
  }, [onVenueChange]);

  function change(id: number) {
    setVenue(id);
    localStorage.setItem('skb_venue', String(id));
    onVenueChange(id);
  }

  return (
    <label style={{ fontSize: 13, color: '#666', display: 'flex', alignItems: 'center', gap: 6 }}>
      🏟️ 分店：
      <select
        value={venue}
        onChange={(e) => change(Number(e.target.value))}
        style={{ padding: '6px 10px', fontSize: 13, borderRadius: 8, border: '1px solid #ddd' }}
      >
        {venues.length === 0 && <option value={1}>載入中…</option>}
        {venues.map((v) => (
          <option key={v.id} value={v.id}>{v.name}</option>
        ))}
      </select>
    </label>
  );
}

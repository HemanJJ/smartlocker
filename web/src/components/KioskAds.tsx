'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

// 智慧拍櫃「拍師傅」廣告輪播：
//   - 偵測使用者操作；閒置 2 分鐘後才開始推播（避免干擾正在下單的客人）
//   - 閒置期間每 10 分鐘輪播一條 ad-1..ad-5
//   - 後台 /admin、賣場 /store 不播
const IDLE_AFTER_MS = 120000;   // 無操作 2 分鐘 = 閒置，開始計算
const AD_INTERVAL_MS = 600000;  // 每 10 分鐘播一條
const ADS = ['ad-1', 'ad-2', 'ad-3', 'ad-4', 'ad-5'];

export default function KioskAds() {
  const pathname = usePathname();

  useEffect(() => {
    const isInternal = pathname.startsWith('/admin') || pathname.startsWith('/store');
    if (isInternal) return; // 後台/賣場頁不播廣告

    let lastActive = Date.now();
    let nextAt: number | null = null;
    let idx = 0;

    const markActive = () => { lastActive = Date.now(); };
    const evts = ['pointerdown', 'touchstart', 'keydown', 'scroll', 'wheel'];
    evts.forEach((e) => window.addEventListener(e, markActive, { passive: true }));

    const play = () => {
      const name = ADS[idx % ADS.length];
      idx = (idx + 1) % ADS.length; // 下一個換下一條，輪播
      try {
        const a = new Audio(`/kiosk-voice/${name}.wav`);
        void a.play().catch(() => {});
      } catch {}
    };

    const timer = setInterval(() => {
      const now = Date.now();
      const idle = now - lastActive > IDLE_AFTER_MS;
      if (idle) {
        if (nextAt == null) {
          nextAt = now + AD_INTERVAL_MS; // 開始閒置：10 分鐘後播第一條
        } else if (now >= nextAt) {
          play();
          nextAt = now + AD_INTERVAL_MS; // 之後每 10 分鐘一條
        }
      } else {
        nextAt = null; // 有互動：重置閒置，客人一走重新倒數
      }
    }, 5000);

    return () => {
      evts.forEach((e) => window.removeEventListener(e, markActive));
      clearInterval(timer);
    };
  }, [pathname]);

  return null; // 只做副作用（播語音），不渲染任何畫面
}

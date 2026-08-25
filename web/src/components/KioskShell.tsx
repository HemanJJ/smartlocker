"use client";

import { useEffect, useRef } from "react";

/**
 * KioskShell — 無人店 kiosk 的保護殼：
 * ① 閒置 60 秒自動回主選單（下一個客人看到乾淨首頁）
 * ② 鎖右鍵（防客人開選單亂按）
 * ③ 防文字選取／防拖放（防誤觸）
 *
 * 包住整個 kiosk 介面：<KioskShell>{children}</KioskShell>
 */
export default function KioskShell({
  children,
  idleSeconds = 60,
}: {
  children: React.ReactNode;
  idleSeconds?: number;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // ① 閒置計時：任何操作都重置 timer，逾時回主選單
    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (window.location.pathname !== "/") {
          window.location.href = "/";
        }
      }, idleSeconds * 1000);
    };

    const events: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "touchstart",
      "touchmove",
      "keydown",
      "wheel",
      "scroll",
    ];
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    reset();

    // ② 鎖右鍵
    const blockCtx = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", blockCtx);

    // ③ 防拖放（把檔案/文字拖進視窗）
    const blockDrop = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", blockDrop);
    window.addEventListener("drop", blockDrop);

    // 清理
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, reset));
      window.removeEventListener("contextmenu", blockCtx);
      window.removeEventListener("dragover", blockDrop);
      window.removeEventListener("drop", blockDrop);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [idleSeconds]);

  return <>{children}</>;
}

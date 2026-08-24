export default function StringMachineIcon({ size = 72 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 110" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
      {/* 底座（黑色梯形） */}
      <path d="M18 104 L102 104 L90 88 L30 88 Z" fill="#1b1b1b" />
      {/* 中柱（VICTOR 紫） */}
      <rect x="52" y="26" width="16" height="66" rx="7" fill="#5b2d8e" />
      {/* 中柱 logo 白條 */}
      <rect x="56" y="46" width="8" height="22" rx="4" fill="#fff" opacity=".92" />
      {/* 頂部橫樑（黑） */}
      <rect x="14" y="16" width="92" height="16" rx="7" fill="#1b1b1b" />
      {/* 左右夾具柱 */}
      <rect x="20" y="6" width="9" height="34" rx="4" fill="#3a3a3a" />
      <rect x="91" y="6" width="9" height="34" rx="4" fill="#3a3a3a" />
      {/* 張力旋鈕（紫） */}
      <circle cx="24" cy="24" r="8" fill="#5b2d8e" />
      <circle cx="96" cy="24" r="8" fill="#5b2d8e" />
      <circle cx="24" cy="24" r="3" fill="#fff" opacity=".6" />
      <circle cx="96" cy="24" r="3" fill="#fff" opacity=".6" />
      {/* 球拍框（白色，橫置） */}
      <ellipse cx="60" cy="24" rx="21" ry="13" fill="none" stroke="#fff" strokeWidth="4.5" />
      {/* 拍柄 */}
      <path d="M60 37 L60 58" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <path d="M55 58 L65 58" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      {/* 綠色穿線（示意網） */}
      <line x1="40" y1="15" x2="80" y2="33" stroke="#06C755" strokeWidth="2.4" />
      <line x1="40" y1="33" x2="80" y2="15" stroke="#06C755" strokeWidth="2.4" />
      <line x1="42" y1="24" x2="78" y2="24" stroke="#06C755" strokeWidth="2.4" />
    </svg>
  );
}

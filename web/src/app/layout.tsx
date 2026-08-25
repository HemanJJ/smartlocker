import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dearfly · 穿線服務",
  description: "Dearfly 穿線服務：kiosk 下單、員工後台、LINE 通知",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-TW"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <div
          style={{
            position: 'fixed',
            right: 12,
            bottom: 10,
            zIndex: 50,
            textAlign: 'right',
            fontSize: 11,
            lineHeight: 1.6,
            color: '#9ca3af',
            pointerEvents: 'none',
          }}
        >
          <div>© 2026 迪飛羽球館 All Rights Reserved.</div>
          <div>
            System by{' '}
            <a
              href="https://linebot.my.canva.site/ai-landing-page"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#9ca3af', textDecoration: 'none', pointerEvents: 'auto' }}
            >
              SEQO
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}

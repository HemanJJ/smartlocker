import { NextRequest } from 'next/server';
import QRCode from 'qrcode';

export const runtime = 'nodejs';

// GET /api/qr?text=123456&w=300 → PNG 圖片（QR 編碼文字）
export async function GET(request: NextRequest) {
  try {
    const text = request.nextUrl.searchParams.get('text') || '';
    const width = Math.min(1000, Math.max(100, Number(request.nextUrl.searchParams.get('w') || 300)));
    const dataUrl = await QRCode.toDataURL(text, { width, margin: 1 });
    const base64 = dataUrl.split(',')[1];
    const buf = Buffer.from(base64, 'base64');
    return new Response(buf, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    console.error('[QR] 錯誤:', err);
    return new Response('QR error', { status: 500 });
  }
}

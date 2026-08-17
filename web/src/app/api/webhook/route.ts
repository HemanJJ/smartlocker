import { NextRequest, NextResponse } from 'next/server';
import { verifySignature, replyMessage } from '@/lib/line';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const signature = request.headers.get('x-line-signature');
  const body = await request.text();

  if (!verifySignature(body, signature)) {
    console.warn('[Webhook] 簽章不符');
    return NextResponse.json({ status: 'ok' });
  }

  try {
    const events = JSON.parse(body).events;
    if (!events || events.length === 0) {
      return NextResponse.json({ status: 'ok' });
    }

    for (const event of events) {
      if (event.type !== 'message' || event.message?.type !== 'text') continue;
      if (!event.replyToken) continue;

      const text = (event.message.text || '').trim();
      const userId = (event.source as { userId?: string } | undefined)?.userId || '';
      console.log(`[Webhook] 處理: ${text} (userId=${userId})`);

      // 我的ID：回傳使用者 userId（供店家設定通知用）
      if (text === '我的ID' || text === '我的id' || text === 'id') {
        await replyMessage(event.replyToken, [
          { type: 'text', text: `你的 userId：${userId}` },
        ]);
        continue;
      }

      // 取件碼查詢
      const pickupReply = await handlePickupQuery(text);
      if (pickupReply) {
        console.log(`[取件碼] 回覆: ${pickupReply}`);
        await replyMessage(event.replyToken, [{ type: 'text', text: pickupReply }]);
        continue;
      }

      // 非取件碼 → 快速 Ollama 或 fallback
      const reply = await quickReply(text);
      await replyMessage(event.replyToken, [{ type: 'text', text: reply }]);
    }
  } catch (err) {
    console.error('[Webhook] 錯誤:', err);
  }

  return NextResponse.json({ status: 'ok' });
}

async function handlePickupQuery(text: string): Promise<string | null> {
  const trimmed = text.trim();
  if (trimmed.length !== 6 || !/^\d{6}$/.test(trimmed)) return null;

  const { validateCode } = await import('@/lib/pickup-code');
  const cell = await validateCode(trimmed);

  if (cell === -1) {
    return `您查詢的取件碼 ${trimmed} 不存在或已過期。請確認是否輸入正確，或聯繫櫃檯人員協助。`;
  }
  if (cell === -2) {
    return `取件碼 ${trimmed} 已經使用過了。若需要再次取件，請向櫃檯申請新的取件碼。`;
  }
  return `✅ 取件碼 ${trimmed} 有效！\n對應格號：第 ${cell} 格\n請至迪飛羽球館智慧拍櫃輸入取件碼取件。`;
}

async function quickReply(userMessage: string): Promise<string> {
  const ollamaBase = process.env.OLLAMA_URL || 'http://localhost:11434';

  try {
    const ping = await fetch(`${ollamaBase}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!ping.ok) return faqReply();
  } catch {
    return faqReply();
  }

  try {
    const res = await fetch(`${ollamaBase}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || 'qwen2.5:14b',
        messages: [
          {
            role: 'system',
            content:
              "你是「迪飛羽球館」的 LINE 客服助理，名字叫小羽。回答只使用繁體中文，1-3 句話就好，語氣親切自然。不確定的不要亂編，就說「我幫您確認一下」。",
          },
          { role: 'user', content: userMessage },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return faqReply();
    const data = await res.json();
    return data.message?.content?.trim() || faqReply();
  } catch {
    return faqReply();
  }
}

function faqReply(): string {
  return `您好！我是小羽 😊\n\n目前客服人員不在線上，您可以使用選單的「預約租拍」來產生取件碼，或來電詢問。`;
}

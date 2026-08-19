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
      // 加入好友：自動綁定「最近一筆未綁訂單」＋推電子收據
      if (event.type === 'follow' && event.replyToken) {
        const uid = (event.source as any)?.userId || '';
        console.log(`[Webhook] 加入好友事件 (userId=${uid})`);
        const { bindMostRecentUnboundOrder } = await import('@/lib/stringing');
        const { getProfile } = await import('@/lib/line');
        const profile = await getProfile(uid);
        const order = await bindMostRecentUnboundOrder(uid, profile?.displayName || '');
        await replyMessage(event.replyToken, [
          {
            type: 'text',
            text: order
              ? `✅ 已綁定！電子收據已送到這裡。\n\n單號：${order.orderNo}\n取件碼：${order.pickupCode}`
              : '歡迎加入羽拍有約！🏸\n\n請先在 kiosk 下單，再回來掃 QR 綁定，電子收據就會送到這裡。',
          },
        ]);
        continue;
      }

      if (event.type !== 'message' || event.message?.type !== 'text') continue;
      if (!event.replyToken) continue;

      const text = (event.message.text || '').trim();
      const userId = (event.source as { userId?: string } | undefined)?.userId || '';
      console.log(`[Webhook] 處理: ${text} (userId=${userId})`);

      // 我的ID：回傳使用者 userId（供店家設定員工通知用）
      if (text === '我的ID' || text === '我的id' || text === 'id') {
        await replyMessage(event.replyToken, [
          { type: 'text', text: `你的 userId：${userId}` },
        ]);
        continue;
      }

      // 客人點「綁定」/「認證」→ 綁「最近一筆未綁訂單」＋推電子收據
      if (text === '綁定' || text === '認證' || text === '登入') {
        const { bindMostRecentUnboundOrder } = await import('@/lib/stringing');
        const { getProfile } = await import('@/lib/line');
        const profile = await getProfile(userId);
        const order = await bindMostRecentUnboundOrder(userId, profile?.displayName || '');
        await replyMessage(event.replyToken, [
          {
            type: 'text',
            text: order
              ? `✅ 綁定成功！電子收據已送到這裡。\n\n單號：${order.orderNo}\n取件碼：${order.pickupCode}`
              : '⚠️ 找不到待綁定的訂單，請先在 kiosk 下單。',
          },
        ]);
        continue;
      }

      // 查詢訂單 → 自動帶出「最近一筆」訂單狀態（免輸碼）
      if (text === '查詢訂單' || text === '查詢') {
        const { getLatestOrderByLineUser, STATUS_LABEL } = await import('@/lib/stringing');
        const latest = await getLatestOrderByLineUser(userId);
        if (latest) {
          let reply = `🧾 您最近的訂單\n━━━━━━━━━━\n單號：${latest.orderNo}\n線種：${latest.stringModel}（${latest.tension} lbs）\n取件碼：${latest.pickupCode}\n狀態：${STATUS_LABEL[latest.status]}`;
          if (latest.currentSlot != null) reply += `\n格號：第 ${latest.currentSlot} 格`;
          await replyMessage(event.replyToken, [{ type: 'text', text: reply }]);
        } else {
          await replyMessage(event.replyToken, [{ type: 'text', text: '您目前沒有訂單。請先到 kiosk 下單寄拍。' }]);
        }
        continue;
      }

      // 價目表 → 回傳全部在售線種
      if (text === '價目表' || text === '價目' || text === '線種') {
        const { listStrings } = await import('@/lib/stringing');
        const strings = await listStrings(true);
        const rows = strings.map((s) => `${s.model}（${s.gauge}）NT$${s.price}`).join('\n');
        await replyMessage(event.replyToken, [
          { type: 'text', text: `💰 穿線價目表（含工帶料）\n━━━━━━━━━━\n${rows}` },
        ]);
        continue;
      }

      // 客人傳 4 位認證碼 → kiosk 身份認證（備援）
      const sessionReply = await handleSessionCode(text, userId);
      if (sessionReply) {
        await replyMessage(event.replyToken, [{ type: 'text', text: sessionReply }]);
        continue;
      }

      // 客人傳 6 位取件碼 → 綁定 LINE 並回報訂單狀態
      const orderReply = await handleOrderCode(text, userId);
      if (orderReply) {
        console.log(`[穿線單] 回覆: ${orderReply.slice(0, 60)}`);
        await replyMessage(event.replyToken, [{ type: 'text', text: orderReply }]);
        continue;
      }

      // Rich Menu 關鍵字
      const keywordReply = handleKeyword(text);
      if (keywordReply) {
        await replyMessage(event.replyToken, [{ type: 'text', text: keywordReply }]);
        continue;
      }

      // 其他訊息 → Ollama 客服或 fallback
      const reply = await quickReply(text);
      await replyMessage(event.replyToken, [{ type: 'text', text: reply }]);
    }
  } catch (err) {
    console.error('[Webhook] 錯誤:', err);
  }

  return NextResponse.json({ status: 'ok' });
}

async function handleSessionCode(text: string, userId: string): Promise<string | null> {
  const trimmed = text.trim();
  const m = trimmed.match(/^\d{4}$/);
  if (!m) return null;

  const code = m[0];
  const { linkKioskSession } = await import('@/lib/stringing');
  const { getProfile } = await import('@/lib/line');
  const profile = await getProfile(userId);
  const name = profile?.displayName || '';

  const ok = await linkKioskSession(code, userId, name);
  if (!ok) {
    return `認證碼 ${code} 無效或已使用，請回到 kiosk 重新整理取得新碼。`;
  }
  return `✅ 認證成功${name ? `（${name}）` : ''}！請回到 kiosk 繼續下單，寄件後電子收據會直接送到這裡。`;
}

async function handleOrderCode(text: string, userId: string): Promise<string | null> {
  const trimmed = text.trim();
  const m = trimmed.match(/\d{6}/);
  if (!m) return null;

  const code = m[0];
  const { getOrderByPickupCode, bindCustomer, STATUS_LABEL } = await import('@/lib/stringing');

  const order = await getOrderByPickupCode(code);
  if (!order) {
    return `您查詢的取件碼 ${code} 不存在，請確認是否輸入正確，或洽櫃檯人員。`;
  }

  const bound = await bindCustomer(code, userId);

  let reply = `🧾 羽拍有約 · 電子收據\n` +
    `━━━━━━━━━━━━\n` +
    `單號：${order.orderNo}\n` +
    `線種：${order.stringModel}（${order.tension} lbs）\n` +
    `費用：NT$${order.price}\n` +
    `取件碼：${code}\n` +
    (order.currentSlot != null ? `格號：第 ${order.currentSlot} 格\n` : '') +
    `狀態：${STATUS_LABEL[order.status]}\n` +
    `━━━━━━━━━━━━`;
  if (bound.boundNow) {
    reply += `\n✅ 已綁定！付款後將自動通知您取件。`;
  } else if (bound.alreadyBoundOther) {
    reply += `\n⚠️ 此單已綁定其他 LINE 帳號，如需協助請洽櫃檯。`;
  } else {
    reply += `\n（此 LINE 已綁定本單）`;
  }
  return reply;
}

function handleKeyword(text: string): string | null {
  const t = text.trim();
  if (t === '查詢訂單' || t === '綁定取件' || t.includes('查詢') || t.includes('綁定')) {
    return `請傳送您的 6 位取件碼，我會幫您查詢穿線訂單狀態並綁定 LINE。\n\n穿好且付款後，會自動通知您取件。`;
  }
  if (t === '客服' || t.includes('聯絡客服') || t.includes('聯絡')) {
    return `您好，客服相關問題歡迎來電或留言，我們會盡快回覆您。`;
  }
  return null;
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
              '你是「羽拍有約」的 LINE 客服助理，名字叫小羽。回答只使用繁體中文，1-3 句話就好，語氣親切自然。不確定的不要亂編，就說「我幫您確認一下」。',
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
  return `您好！我是小羽 😊\n\n您可以傳送您的 6 位取件碼，我會幫您查詢穿線訂單的狀態。其他問題歡迎來電詢問。`;
}

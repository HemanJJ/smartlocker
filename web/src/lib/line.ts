import * as crypto from 'crypto';

const LINE_API = 'https://api.line.me/v2/bot';

export function verifySignature(body: string, signature: string | null): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
  return expected === signature;
}

export interface QuickReplyAction {
  type: 'action';
  action: { type: 'message'; label: string; text: string };
}

/** 回覆 LINE 訊息（直接 HTTP call，不用 SDK）；可選帶 quickReply 快捷按鈕 */
export async function replyMessage(
  replyToken: string,
  messages: Array<{ type: string; text: string }>,
  quickReply?: { items: QuickReplyAction[] }
): Promise<boolean> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.error('[LINE] 無 token');
    return false;
  }
  try {
    const body: any = { replyToken, messages };
    if (quickReply && quickReply.items.length) body.quickReply = quickReply;
    const res = await fetch(`${LINE_API}/message/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[LINE] 回覆失敗 ${res.status}: ${text}`);
    }
    return res.ok;
  } catch (err: any) {
    console.error('[LINE] 回覆異常:', err.message);
    return false;
  }
}

/** 推播訊息 */
export async function pushMessage(
  to: string,
  messages: Array<{ type: string; text: string }>
): Promise<boolean> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.error('[LINE] 無 token');
    return false;
  }
  try {
    const res = await fetch(`${LINE_API}/message/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to, messages }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[LINE] 推播失敗 ${res.status}: ${body}`);
    }
    return res.ok;
  } catch (err: any) {
    console.error('[LINE] 推播異常:', err.message);
    return false;
  }
}

/** 取得使用者資料（顯示名稱/別名） */
export async function getProfile(userId: string): Promise<{ displayName: string } | null> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${LINE_API}/profile/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as { displayName: string };
  } catch (err: any) {
    console.error('[LINE] 取得使用者資料異常:', err.message);
    return null;
  }
}

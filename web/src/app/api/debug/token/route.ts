import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
  return NextResponse.json({
    hasToken: !!token,
    length: token.length,
    prefix: token.substring(0, 10),
    suffix: token.substring(token.length - 10),
  });
}

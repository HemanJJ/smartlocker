import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isValidAdminToken, ADMIN_COOKIE } from '@/lib/admin-auth';

// 保護後台：/admin/*（UI）＋ /api/admin/*（管理 API）
// /admin/login 例外（登入頁本身）。
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // 登入／登出本身不擋（登出只是清 cookie）
  if (
    pathname === '/admin/login' ||
    pathname === '/api/admin/login' ||
    pathname === '/api/admin/logout'
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!(await isValidAdminToken(token))) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const url = new URL('/admin/login', req.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};

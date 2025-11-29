import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Protected routes that require authentication
  const protectedRoutes = ['/dashboard']
  const isProtectedRoute = protectedRoutes.some((route: string) =>
    pathname.startsWith(route)
  )

  // Check for session token (NextAuth uses this cookie)
  const token = request.cookies.get('authjs.session-token') || request.cookies.get('__Secure-authjs.session-token')
  const isLoggedIn = !!token

  // Redirect to login if accessing protected route while not logged in
  if (isProtectedRoute && !isLoggedIn) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Redirect to home if accessing login/register while logged in
  if ((pathname === '/login' || pathname === '/register') && isLoggedIn) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|searchWorker.js|.*\\.json|.*\\.png|.*\\.jpg).*)'],
}

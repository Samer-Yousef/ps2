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
  const sessionToken = request.cookies.get('authjs.session-token')?.value ||
                       request.cookies.get('__Secure-authjs.session-token')?.value

  // Only redirect to login for protected routes if no session token exists
  if (isProtectedRoute && !sessionToken) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|searchWorker.js|.*\\.json|.*\\.png|.*\\.jpg).*)'],
}

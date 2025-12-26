import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { adminCookieName, verifyAdminToken } from "./lib/admin/auth";

const isApiRoute = (pathname: string) => pathname.startsWith("/api/admin");
const isLoginRoute = (pathname: string) => pathname === "/api/admin/login";
const isAdminPage = (pathname: string) => pathname.startsWith("/admin");
const isAdminLoginPage = (pathname: string) => pathname === "/admin/login";

export const middleware = async (request: NextRequest) => {
  const { pathname } = request.nextUrl;

  if (isApiRoute(pathname) && isLoginRoute(pathname)) {
    return NextResponse.next();
  }

  if (isAdminPage(pathname) && isAdminLoginPage(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(adminCookieName)?.value;
  if (!token) {
    return handleUnauthorized(request);
  }

  try {
    await verifyAdminToken(token);
    return NextResponse.next();
  } catch {
    return handleUnauthorized(request);
  }
};

const handleUnauthorized = (request: NextRequest) => {
  if (isApiRoute(request.nextUrl.pathname)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/admin/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
};

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};

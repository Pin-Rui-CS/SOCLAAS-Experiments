import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

/**
 * Gate every page and API route behind the shared password.
 *
 * This exists because the gateway bills every request to a personal key. An
 * unprotected public URL is someone else spending your daily quota.
 *
 * Named `proxy` rather than `middleware`: Next 16 deprecated the older
 * convention in favour of this one.
 */
export async function proxy(request: NextRequest) {
  const secret = process.env.AUTH_SECRET;

  // Fail closed. A missing secret must not silently disable the gate.
  if (!secret) {
    return new NextResponse(
      "AUTH_SECRET is not configured. Refusing to serve without a session gate.",
      { status: 500 },
    );
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token, secret)) {
    return NextResponse.next();
  }

  // API routes get a status, not a redirect to an HTML page.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  const { pathname, search } = request.nextUrl;
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  /*
   * Everything except the login page, the endpoint that issues the session, and
   * static assets. Gating `_next/static` would add a signature check to every
   * chunk and image for no benefit.
   */
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

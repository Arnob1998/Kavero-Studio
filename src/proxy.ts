import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
  // Device proof is checked inside these exact opt-in handlers, never via user cookies.
  if (["/api/connect/claim", "/api/connect/device", "/api/connect/results", "/api/connect/results/upload"].includes(request.nextUrl.pathname)) return NextResponse.next();
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|icon.svg|fonts/inter/InterVariable\\.woff2$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

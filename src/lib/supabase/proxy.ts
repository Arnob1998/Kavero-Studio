import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseAuthCookieName, requireServerSupabaseUrl } from "./url";

const PUBLIC_PATHS = new Set([
  "/",
  "/auth/login",
  "/auth/callback",
  "/auth/auth-code-error",
  "/auth/sign-out",
  "/generate",
  "/api/workspace/status",
]);

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.has(pathname);
}

function isPageRequest(request: NextRequest) {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html");
}

function getLoginUrl(request: NextRequest) {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/auth/login";
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return loginUrl;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    requireServerSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
      cookieOptions: {
        name: getSupabaseAuthCookieName(),
      },
    },
  );

  const { data } = await supabase.auth.getClaims();

  if (!data?.claims && !isPublicPath(request.nextUrl.pathname)) {
    if (isPageRequest(request)) {
      return NextResponse.redirect(getLoginUrl(request));
    }

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return supabaseResponse;
}

export const authExclusions = Array.from(PUBLIC_PATHS);

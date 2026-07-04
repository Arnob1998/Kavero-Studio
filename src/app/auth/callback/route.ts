import { NextResponse } from "next/server";
import { getAuthModeConfig } from "@/lib/auth/config";
import { getRequestSiteOrigin } from "@/lib/auth/origin";
import { getSafeAuthRedirectPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = getRequestSiteOrigin(request);
  const code = searchParams.get("code");
  const next = getSafeAuthRedirectPath(searchParams.get("next"));
  const authConfig = getAuthModeConfig();

  if (!authConfig.googleEnabled) {
    return NextResponse.redirect(`${origin}/auth/auth-code-error`);
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}

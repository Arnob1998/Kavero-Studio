import { NextResponse } from "next/server";
import { getGoogleDriveAuthorizationUrl } from "@/lib/google-drive";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    const next = new URL(request.url).searchParams.get("next") || "/settings/storage";
    return NextResponse.redirect(new URL(`/auth/login?next=${encodeURIComponent(next)}`, request.url));
  }

  const state = crypto.randomUUID();
  const response = NextResponse.redirect(getGoogleDriveAuthorizationUrl(state, request.url));
  response.cookies.set("kavero_google_drive_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });

  return response;
}

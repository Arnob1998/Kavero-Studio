import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function signOut(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}

export async function GET(request: Request) {
  return signOut(request);
}

export async function POST(request: Request) {
  return signOut(request);
}

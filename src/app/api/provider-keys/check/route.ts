import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const providerKeyCheckSchema = z.object({
  providerId: z.literal("google-gemini"),
  apiKey: z.string().trim().min(20).max(4000),
});

export async function POST(request: Request) {
  const parsed = providerKeyCheckSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid provider key check." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checkedAt = new Date().toISOString();

  try {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("key", parsed.data.apiKey);
    const response = await fetch(url, { method: "GET" });

    if (response.ok) {
      return NextResponse.json({
        status: "passed",
        checkedAt,
      });
    }

    return NextResponse.json({
      status: "failed",
      checkedAt,
      code: response.status === 401 || response.status === 403 ? "authentication_error" : "provider_error",
      message: "Gemini key check failed.",
    });
  } catch {
    return NextResponse.json({
      status: "failed",
      checkedAt,
      code: "network_error",
      message: "Gemini key check failed.",
    });
  }
}

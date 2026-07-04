import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const providerKeySchema = z.object({
  providerId: z.literal("google-gemini"),
  apiKey: z.string().trim().min(20).max(4000),
});

function getKeyHint(apiKey: string) {
  const trimmed = apiKey.trim();
  return `...${trimmed.slice(-4)}`;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_provider_keys")
    .select("id, provider_id, provider_label, key_hint, status, last_checked_at, created_at, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Unable to load provider keys", error);
    return NextResponse.json({ error: "Unable to load provider keys." }, { status: 500 });
  }

  return NextResponse.json({ providerKeys: data ?? [] });
}

export async function POST(request: Request) {
  const parsed = providerKeySchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid provider key." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("upsert_provider_key", {
    p_user_id: user.id,
    p_provider_id: parsed.data.providerId,
    p_secret: parsed.data.apiKey,
    p_key_hint: getKeyHint(parsed.data.apiKey),
  });

  if (error) {
    console.error("Unable to save provider key", error);
    return NextResponse.json({ error: "Unable to save provider key." }, { status: 500 });
  }

  return NextResponse.json({
    providerKey: {
      id: data.id,
      providerId: data.provider_id,
      providerLabel: data.provider_label,
      keyHint: data.key_hint,
      status: data.status,
      lastCheckedAt: data.last_checked_at,
      updatedAt: data.updated_at,
    },
  });
}

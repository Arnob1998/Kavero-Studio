import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const thumbnailIconSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  version: z.literal(1).default(1),
});

const promptTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(12000),
  thumbnailIcon: thumbnailIconSchema.nullable().optional(),
  referenceImages: z.array(z.unknown()).max(12).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

const promptTemplateColumns =
  "id, name, prompt, thumbnail_icon, reference_images, sort_order, created_at, updated_at";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("prompt_templates")
    .select(promptTemplateColumns)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Unable to load prompt templates." }, { status: 500 });
  }

  return NextResponse.json({ promptTemplates: data ?? [] });
}

export async function POST(request: Request) {
  const parsed = promptTemplateSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid prompt template." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("prompt_templates")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      prompt: parsed.data.prompt,
      thumbnail_icon: parsed.data.thumbnailIcon ?? null,
      reference_images: parsed.data.referenceImages ?? [],
      sort_order: parsed.data.sortOrder ?? 0,
    })
    .select(promptTemplateColumns)
    .single();

  if (error) {
    const status = error.message.includes("Prompt template limit reached") ? 409 : 500;
    return NextResponse.json({ error: "Unable to save prompt template." }, { status });
  }

  return NextResponse.json({ promptTemplate: data });
}

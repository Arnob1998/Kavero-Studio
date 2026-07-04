import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const thumbnailIconSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  version: z.literal(1).default(1),
});

const updatePromptTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  prompt: z.string().trim().min(1).max(12000).optional(),
  thumbnailIcon: thumbnailIconSchema.nullable().optional(),
  referenceImages: z.array(z.unknown()).max(12).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

const promptTemplateColumns =
  "id, name, prompt, thumbnail_icon, reference_images, sort_order, created_at, updated_at";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = updatePromptTemplateSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid prompt template." }, { status: 400 });
  }

  const supabase = await createClient();
  const updatePayload: Record<string, unknown> = {};

  if (parsed.data.name !== undefined) updatePayload.name = parsed.data.name;
  if (parsed.data.prompt !== undefined) updatePayload.prompt = parsed.data.prompt;
  if (parsed.data.thumbnailIcon !== undefined) updatePayload.thumbnail_icon = parsed.data.thumbnailIcon;
  if (parsed.data.referenceImages !== undefined) {
    updatePayload.reference_images = parsed.data.referenceImages;
  }
  if (parsed.data.sortOrder !== undefined) updatePayload.sort_order = parsed.data.sortOrder;

  const { data, error } = await supabase
    .from("prompt_templates")
    .update(updatePayload)
    .eq("id", id)
    .select(promptTemplateColumns)
    .single();

  if (error) {
    return NextResponse.json({ error: "Unable to update prompt template." }, { status: 500 });
  }

  return NextResponse.json({ promptTemplate: data });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { error } = await supabase.from("prompt_templates").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Unable to delete prompt template." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

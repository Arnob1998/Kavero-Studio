import { NextResponse } from "next/server";
import { z } from "zod";
import { getDeploymentProfile, isLocalFirstDeploymentProfile } from "@/lib/deployment-profile";
import { normalizeUserPlan } from "@/lib/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const CANVAS_LIMITS = {
  designsPerUser: 3,
  pagesPerDesign: 5,
  canvasJsonBytesPerPage: 250 * 1024,
  driveAssetsPerUser: 200,
  driveAssetBytesPerFile: 10 * 1024 * 1024,
} as const;

const embeddedAssetPattern = /data:(?:image|video|audio|application)\/[^;,]+;base64,/i;
const canvasAssetUrlPattern = /^\/api\/canvas\/assets\/[a-zA-Z0-9_-]+$/;

function isCanvasAssetUrl(value: string) {
  if (canvasAssetUrlPattern.test(value)) return true;
  try {
    const parsed = new URL(value);
    return canvasAssetUrlPattern.test(parsed.pathname);
  } catch {
    return false;
  }
}

function hasExternalCanvasImageSource(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasExternalCanvasImageSource);

  const record = value as Record<string, unknown>;
  const src = record.src;
  const type = record.type;
  if (
    typeof src === "string" &&
    typeof type === "string" &&
    type.toLowerCase().includes("image") &&
    !isCanvasAssetUrl(src)
  ) {
    return true;
  }

  return Object.values(record).some(hasExternalCanvasImageSource);
}

export const canvasJsonSchema = z
  .string()
  .refine((value) => byteSize(value) <= CANVAS_LIMITS.canvasJsonBytesPerPage, {
    message: "Canvas page is too large.",
  })
  .refine((value) => !embeddedAssetPattern.test(value), {
    message: "Canvas assets must be uploaded to Google Drive, not embedded in canvas JSON.",
  })
  .refine((value) => {
    try {
      return !hasExternalCanvasImageSource(JSON.parse(value));
    } catch {
      return false;
    }
  }, { message: "Canvas image sources must use Kavero Google Drive asset URLs." });

export const designPayloadSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  canvas_json: canvasJsonSchema.optional(),
  width: z.number().int().min(100).max(8000).optional(),
  height: z.number().int().min(100).max(8000).optional(),
  thumbnail_url: z.string().url().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const pagePayloadSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  canvas_json: canvasJsonSchema.optional(),
  after_sort_order: z.number().int().min(0).max(1000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export function byteSize(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function getCanvasUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return user;
}

export function getCanvasAdmin() {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

export async function getCanvasAccess(userId: string) {
  const deploymentProfile = getDeploymentProfile();
  const admin = createAdminClient();
  const [{ data: metadata }, { data: driveConnection }] = await Promise.all([
    admin.from("user_metadata").select("plan").eq("user_id", userId).maybeSingle(),
    admin
      .from("user_drive_connections")
      .select("status")
      .eq("user_id", userId)
      .eq("provider", "google-drive")
      .maybeSingle(),
  ]);

  const plan = normalizeUserPlan(metadata?.plan);
  const driveConnected = driveConnection?.status === "active";
  const driveReconnectRequired = driveConnection?.status === "reconnect_required";
  const isLocalFirst = isLocalFirstDeploymentProfile(deploymentProfile);

  return {
    deploymentProfile,
    plan,
    driveConnected,
    driveReconnectRequired,
    allowed: isLocalFirst || (plan === "premium" && driveConnected),
  };
}

export async function requireCanvasAccess(userId: string) {
  const access = await getCanvasAccess(userId);
  if (!access.allowed) {
    const message =
      access.plan !== "premium"
        ? "Canvas is available on the premium plan."
        : access.driveReconnectRequired
          ? "Reconnect Google Drive to use Canvas."
          : "Connect Google Drive to use Canvas.";

    return {
      access,
      response: jsonError(message, 403),
    };
  }

  return { access, response: null };
}

export function requireCanvasAdmin() {
  const admin = getCanvasAdmin();
  if (!admin) {
    return {
      admin: null,
      response: jsonError("Supabase admin credentials are not configured.", 500),
    };
  }
  return { admin, response: null };
}

export function normalizeCanvasJson(value: string | undefined) {
  return value && value.trim() ? value : "{}";
}

export function mapPage(row: Record<string, unknown>) {
  return {
    id: row.id,
    design_id: row.design_id,
    title: row.title,
    canvas_json: row.canvas_json,
    sort_order: row.sort_order,
    metadata: row.metadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mapDesign(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    canvas_json: row.canvas_json,
    width: row.width,
    height: row.height,
    thumbnail_url: row.thumbnail_url,
    metadata: row.metadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

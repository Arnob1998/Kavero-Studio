import { NextResponse } from "next/server";
import { getGoogleDriveAccessTokenForUser, markGoogleDriveReconnectRequired } from "@/lib/google-drive";
import { createClient } from "@/lib/supabase/server";
import type { GalleryImage } from "@/modules/gallery/types";
import { getGalleryImageStorageRef } from "@/modules/gallery/utils/gallery-storage-refs";
import { readStorageObject } from "@/modules/storage/dispatch/storage-object-dispatch";
import { getRuntimeManagedStorageDispatchDependencies } from "@/modules/storage/managed/runtime";
import type { ReadObjectResult } from "@/modules/storage/storage-provider";

type GeneratedImageContentRow = {
  id: string;
  mime_type: string | null;
  storage_ref: unknown | null;
  storage_provider: string | null;
  storage_kind: string | null;
  storage_status: string | null;
  storage_external_id: string | null;
  drive_file_id: string | null;
  drive_file_name: string | null;
  drive_web_view_link: string | null;
  drive_status: "available" | "missing" | "unknown";
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ imageId: string }> },
) {
  const { imageId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: record, error: recordError } = await supabase
    .from("generated_images")
    .select(
      "id, mime_type, storage_ref, storage_provider, storage_kind, storage_status, storage_external_id, drive_file_id, drive_file_name, drive_web_view_link, drive_status",
    )
    .eq("id", imageId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (recordError) {
    console.error("Unable to load generated image content", recordError);
    return NextResponse.json({ error: "Unable to load image." }, { status: 500 });
  }

  if (!record) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const imageRef = getGalleryImageStorageRef(toGalleryImage(record as GeneratedImageContentRow));
  if (!imageRef) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (imageRef.providerId !== "google-drive") {
    if (imageRef.providerId === "kavero-managed" || imageRef.providerId === "supabase-storage") {
      const dependenciesResult = getRuntimeManagedStorageDispatchDependencies();
      if (!dependenciesResult.ok) {
        console.error("Managed generated image storage is not configured", dependenciesResult.error);
        return NextResponse.json({ error: "Managed storage is not configured." }, { status: 502 });
      }

      const readResult = await readStorageObject({
        userId: user.id,
        ref: imageRef,
        dependencies: dependenciesResult.dependencies,
      });
      if (readResult.ok) {
        return new Response(toResponseBody(readResult.object), {
          status: 200,
          headers: {
            "Content-Type": record.mime_type || readResult.object.mimeType || "image/png",
            "Cache-Control": "private, max-age=300",
          },
        });
      }

      if (readResult.reason === "missing") {
        return NextResponse.json({ error: "Image is missing in storage." }, { status: 404 });
      }

      if (readResult.reason === "provider-error") {
        return NextResponse.json({ error: "Unable to stream stored image." }, { status: 502 });
      }

      if (readResult.reason === "backend-not-registered") {
        return NextResponse.json(
          { error: "Storage provider is not supported for image streaming yet." },
          { status: 501 },
        );
      }
    }

    return NextResponse.json(
      { error: "Storage provider is not supported for image streaming yet." },
      { status: 501 },
    );
  }

  const fileId = imageRef.externalId ?? imageRef.objectKey;
  let accessToken: string | null = null;
  try {
    accessToken = await getGoogleDriveAccessTokenForUser(user.id);
  } catch {
    return NextResponse.json({ error: "Google Drive needs to be reconnected." }, { status: 409 });
  }

  if (!accessToken) {
    return NextResponse.json({ error: "Google Drive is not connected." }, { status: 409 });
  }

  const driveResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!driveResponse.ok || !driveResponse.body) {
    if (driveResponse.status === 404) {
      await supabase
        .from("generated_images")
        .update({ drive_status: "missing" })
        .eq("id", record.id)
        .eq("user_id", user.id);

      return NextResponse.json({ error: "Image is missing in Google Drive." }, { status: 404 });
    }

    if (driveResponse.status === 401 || driveResponse.status === 403) {
      await markGoogleDriveReconnectRequired(user.id);
      return NextResponse.json({ error: "Google Drive needs to be reconnected." }, { status: 409 });
    }

    return NextResponse.json({ error: "Unable to stream Drive image." }, { status: 502 });
  }

  return new Response(driveResponse.body, {
    status: 200,
    headers: {
      "Content-Type": record.mime_type || driveResponse.headers.get("Content-Type") || "image/png",
      "Cache-Control": "private, max-age=300",
    },
  });
}

function toResponseBody(result: ReadObjectResult): BodyInit {
  if (result.data instanceof Uint8Array) {
    const bytes = new Uint8Array(result.data.byteLength);
    bytes.set(result.data);
    return bytes.buffer;
  }

  return result.data;
}

function toGalleryImage(row: GeneratedImageContentRow): GalleryImage {
  return {
    id: row.id,
    variant: 1,
    mime_type: row.mime_type ?? "image/png",
    drive_file_id: row.drive_file_id,
    drive_file_name: row.drive_file_name,
    drive_web_view_link: row.drive_web_view_link,
    drive_metadata_file_id: null,
    drive_status: row.drive_status,
    storage_provider: row.storage_provider,
    storage_kind: row.storage_kind,
    storage_status: row.storage_status,
    storage_ref: row.storage_ref,
    metadata_storage_ref: null,
    storage_metadata: null,
    storage_external_id: row.storage_external_id,
    storage_external_url: null,
    resolved_storage_ref: null,
    resolved_metadata_storage_ref: null,
    created_at: "",
  };
}

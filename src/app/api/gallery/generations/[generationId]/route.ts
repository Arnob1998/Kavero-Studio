import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteGalleryGeneration } from "@/modules/gallery/services/delete-gallery-generation";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ generationId: string }> },
) {
  const { generationId } = await params;
  const deleteDriveFiles = new URL(request.url).searchParams.get("files") === "delete";
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await deleteGalleryGeneration(supabase, user.id, generationId, deleteDriveFiles);

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    removed: result.removed,
    removedRecords: result.removedRecords,
    driveFilesDeleted: result.driveFilesDeleted,
  });
}

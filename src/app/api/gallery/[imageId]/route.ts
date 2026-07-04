import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteGalleryImage } from "@/modules/gallery/services/delete-gallery-image";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ imageId: string }> },
) {
  const { imageId } = await params;
  const deleteDriveFiles = new URL(request.url).searchParams.get("files") === "delete";
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await deleteGalleryImage(supabase, user.id, imageId, deleteDriveFiles);

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    removed: result.removed,
    driveFilesDeleted: result.driveFilesDeleted,
  });
}

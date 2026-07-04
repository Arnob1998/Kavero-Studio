import type { GalleryFolder, GalleryRun } from "../types";

export function getGalleryFolders(runs: GalleryRun[]): GalleryFolder[] {
  return runs
    .map((run) => {
      const images = run.generated_images ?? [];
      const coverImage = images[0];
      if (!coverImage) return null;

      return {
        id: run.id,
        prompt: run.prompt,
        modelId: run.model_id,
        modelLabel: run.model_label,
        settings: run.settings ?? {},
        generatedText: run.generated_text,
        createdAt: run.created_at,
        imageCount: images.length,
        coverImage,
        images,
      } satisfies GalleryFolder;
    })
    .filter((folder): folder is GalleryFolder => Boolean(folder))
    .sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

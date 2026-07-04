export function getGalleryImageContentUrl(imageId: string) {
  return `/api/gallery/images/${encodeURIComponent(imageId)}/content`;
}

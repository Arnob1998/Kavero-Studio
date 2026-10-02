import Link from "next/link";

export function GalleryPagination({ page, totalPages }: { page: number; totalPages: number }) {
  if (totalPages <= 1) return null;
  const linkClass = "rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white/75 hover:bg-white/10";
  return (
    <nav aria-label="Gallery pagination" className="mt-8 flex flex-wrap items-center justify-center gap-4">
      {page > 1 ? <Link className={linkClass} href={`/gallery?page=${page - 1}`}>Previous</Link> : null}
      <span className="text-sm text-white/55">Page {page} of {totalPages}</span>
      {page < totalPages ? <Link className={linkClass} href={`/gallery?page=${page + 1}`}>Next</Link> : null}
    </nav>
  );
}

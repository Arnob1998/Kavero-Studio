import { useCallback, useMemo } from "react";
import { usePathname, useRouter as useNextRouter } from "next/navigation";

export function useRouter(initialDesignId: string | null = null) {
  const pathname = usePathname();
  const router = useNextRouter();

  const navigate = useCallback((to: string) => {
    router.push(to);
  }, [router]);

  const path = pathname ?? (initialDesignId ? `/design/${initialDesignId}` : "/");
  const designId = useMemo(() => {
    const match = path.match(/^\/design\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : initialDesignId;
  }, [initialDesignId, path]);

  return { path, navigate, designId };
}

const defaultAuthenticatedPath = "/";

export function getSafeAuthRedirectPath(path: string | null | undefined) {
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return defaultAuthenticatedPath;
  }

  if (path.startsWith("/auth/")) {
    return defaultAuthenticatedPath;
  }

  return path;
}

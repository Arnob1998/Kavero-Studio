const defaultAuthenticatedPath = "/dashboard";

export function getSafeAuthRedirectPath(path: string | null | undefined) {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) {
    return defaultAuthenticatedPath;
  }

  if (path === "/" || path.startsWith("/auth/")) {
    return defaultAuthenticatedPath;
  }

  return path;
}

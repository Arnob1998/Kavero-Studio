export function getConfiguredSiteOrigin() {
  return normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL);
}

export function getClientSiteOrigin() {
  if (process.env.NODE_ENV === "development") {
    return window.location.origin;
  }

  return getConfiguredSiteOrigin() ?? window.location.origin;
}

export function getRequestSiteOrigin(request: Request) {
  if (process.env.NODE_ENV === "development") {
    return new URL(request.url).origin;
  }

  const configuredOrigin = getConfiguredSiteOrigin();
  if (configuredOrigin) {
    return configuredOrigin;
  }

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";

  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}

function normalizeOrigin(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return null;
  }
}

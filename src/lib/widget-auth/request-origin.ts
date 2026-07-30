export function getRequestOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");

  if (origin) {
    return origin;
  }

  const referer = request.headers.get("referer");

  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      // lanjut ke fallback proxy
    }
  }

  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();

  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();

  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = request.headers.get("host");

  if (host) {
    const protocol = forwardedProto ?? "http";
    return `${protocol}://${host}`;
  }

  try {
    return new URL(request.url).origin;
  } catch {
    return null;
  }
}

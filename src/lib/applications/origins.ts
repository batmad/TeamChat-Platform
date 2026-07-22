import { AppError } from "@/lib/api/app-error";

export function normalizeAllowedOrigins(values: string[]): string[] {
  const normalized = values.map((value) => {
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      throw new AppError(400, "INVALID_ORIGIN", `Invalid allowed origin: ${value}`);
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new AppError(400, "INVALID_ORIGIN_PROTOCOL", "Allowed origins must use http or https");
    }

    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
      throw new AppError(400, "INVALID_ORIGIN_FORMAT", "Allowed origins must contain only scheme, host, and optional port");
    }

    return url.origin;
  });

  return [...new Set(normalized)].sort();
}

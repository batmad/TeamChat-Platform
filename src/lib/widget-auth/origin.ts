import { AppError } from "@/lib/api/app-error";

export function assertWidgetOriginAllowed(allowedOrigins: string[], requestOrigin: string | null) {
  if (allowedOrigins.length === 0) return;
  if (!requestOrigin) {
    throw new AppError(403, "WIDGET_ORIGIN_REQUIRED", "Request origin is required for this application");
  }

  let normalized: string;
  try {
    normalized = new URL(requestOrigin).origin;
  } catch {
    throw new AppError(403, "WIDGET_ORIGIN_INVALID", "Request origin is invalid");
  }

  if (!allowedOrigins.includes(normalized)) {
    throw new AppError(403, "WIDGET_ORIGIN_DENIED", "Request origin is not allowed for this application");
  }
}

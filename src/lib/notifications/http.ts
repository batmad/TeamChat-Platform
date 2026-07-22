import { AppError } from "@/lib/api/app-error";

const NOTIFICATION_ERROR_MAP: Record<string, { status: number; message: string }> = {
  NOTIFICATION_USER_NOT_FOUND: { status: 404, message: "Notification user is unavailable" },
  NOTIFICATION_ROOM_NOT_FOUND: { status: 404, message: "Notification room is unavailable" },
  NOTIFICATION_ROOM_INVALID: { status: 409, message: "Notification room is invalid" },
  NOTIFICATION_ROOM_FORBIDDEN: { status: 403, message: "Notification room access is not allowed" },
  INVALID_MUTED_UNTIL: { status: 400, message: "Mute expiration is invalid" },
};

export function toNotificationAppError(error: unknown): never {
  if (error instanceof Error) {
    const mapped = NOTIFICATION_ERROR_MAP[error.message];
    if (mapped) throw new AppError(mapped.status, error.message, mapped.message);
  }
  throw error;
}

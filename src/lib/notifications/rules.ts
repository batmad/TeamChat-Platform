export const NOTIFICATION_BODY_PREVIEW_LENGTH = 180;

export function buildNotificationPreview(content: string, maxLength = NOTIFICATION_BODY_PREVIEW_LENGTH) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function isRoomMuteActive(mutedUntil: Date | null | undefined, now = new Date()) {
  return mutedUntil == null || mutedUntil.getTime() > now.getTime();
}

export function shouldAlertForNotification(input: {
  muteAll: boolean;
  roomMuted: boolean;
  settingEnabled: boolean;
}) {
  return !input.muteAll && !input.roomMuted && input.settingEnabled;
}

export function normalizeMutedUntil(value: string | null | undefined) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("INVALID_MUTED_UNTIL");
  return date;
}

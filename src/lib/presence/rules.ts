export const DEFAULT_PRESENCE_CLEANUP_HOURS = 8;
export const DEFAULT_PRESENCE_OFFLINE_GRACE_MS = 15_000;
export const DEFAULT_PRESENCE_HEARTBEAT_INTERVAL_MS = 25_000;

export function nextConnectionCount(current: number, delta: number): number {
  return Math.max(0, current + delta);
}

export function shouldMarkOffline(connectionCount: number): boolean {
  return connectionCount <= 0;
}

export function cleanupCutoff(now: Date, cleanupHours: number): Date {
  const safeHours = Number.isFinite(cleanupHours) && cleanupHours > 0
    ? cleanupHours
    : DEFAULT_PRESENCE_CLEANUP_HOURS;
  return new Date(now.getTime() - safeHours * 60 * 60 * 1000);
}

export function normalizeCleanupHours(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_PRESENCE_CLEANUP_HOURS;
}

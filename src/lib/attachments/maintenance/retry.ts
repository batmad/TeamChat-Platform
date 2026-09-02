export function attachmentDeleteRetryDelayMs(retryCount: number, baseMinutes: number) {
  const exponent = Math.max(0, retryCount - 1);
  const minutes = Math.min(24 * 60, baseMinutes * 2 ** exponent);
  return minutes * 60 * 1000;
}

export function attachmentDeleteFinalStatus(deleteReason: string | null) {
  if (deleteReason === "RETENTION_EXPIRED") return "EXPIRED" as const;
  return "DELETED" as const;
}

export const GLOBAL_ATTACHMENT_POLICY_KEY = "GLOBAL";
export const GLOBAL_ATTACHMENT_STORAGE_KEY = "GLOBAL:local-primary";
export const GLOBAL_ATTACHMENT_SCANNER_KEY = "GLOBAL:clamav-primary";

export const DEFAULT_ATTACHMENT_POLICY = {
  enabled: true,
  privateEnabled: true,
  groupEnabled: true,
  maxFileSizeBytes: BigInt(25 * 1024 * 1024),
  maxFilesPerMessage: 5,
  maxTotalSizeBytes: BigInt(50 * 1024 * 1024),
  storageQuotaBytes: BigInt(50 * 1024 * 1024 * 1024),
  imagePreviewEnabled: true,
  pdfPreviewEnabled: true,
  malwareScanEnabled: false,
  malwareScannerProviderId: null as string | null,
  validateMime: true,
  validateSignature: true,
  temporaryTtlMinutes: 60,
  failedCleanupHours: 24,
  uploadRateLimitEnabled: true,
  uploadRateLimitWindowMs: 60_000,
  uploadRateLimitMaxRequests: 10,
  uploadRateLimitMaxBytes: BigInt(100 * 1024 * 1024),
  deleteRetryMaxAttempts: 8,
  deleteRetryBaseMinutes: 5,
  auditDownloadEnabled: true,
  auditPreviewEnabled: true,
  storageProviderId: null as string | null,
} as const;

export function applicationAttachmentPolicyKey(applicationId: string) {
  return `APP:${applicationId}`;
}

export function globalAttachmentFileTypeKey(extension: string) {
  return `GLOBAL:${normalizeAttachmentExtension(extension)}`;
}

export function applicationAttachmentFileTypeKey(applicationId: string, extension: string) {
  return `APP:${applicationId}:${normalizeAttachmentExtension(extension)}`;
}

export function normalizeAttachmentExtension(extension: string) {
  return extension.trim().toLowerCase().replace(/^\./, "");
}

import { DEFAULT_ATTACHMENT_POLICY } from "@/lib/attachments/constants";

export type AttachmentPolicyValues = {
  enabled: boolean;
  privateEnabled: boolean;
  groupEnabled: boolean;
  maxFileSizeBytes: bigint;
  maxFilesPerMessage: number;
  maxTotalSizeBytes: bigint;
  storageQuotaBytes: bigint | null;
  imagePreviewEnabled: boolean;
  pdfPreviewEnabled: boolean;
  malwareScanEnabled: boolean;
  malwareScannerProviderId: string | null;
  validateMime: boolean;
  validateSignature: boolean;
  temporaryTtlMinutes: number;
  failedCleanupHours: number;
  uploadRateLimitEnabled: boolean;
  uploadRateLimitWindowMs: number;
  uploadRateLimitMaxRequests: number;
  uploadRateLimitMaxBytes: bigint;
  deleteRetryMaxAttempts: number;
  deleteRetryBaseMinutes: number;
  auditDownloadEnabled: boolean;
  auditPreviewEnabled: boolean;
  storageProviderId: string | null;
};

export type NullableAttachmentPolicy = {
  inheritGlobal: boolean;
} & {
  [K in keyof AttachmentPolicyValues]: AttachmentPolicyValues[K] | null;
};

export type EffectiveAttachmentPolicy = AttachmentPolicyValues & {
  source: "GLOBAL" | "APPLICATION";
};

type PolicyField = keyof AttachmentPolicyValues;

function resolveField<K extends PolicyField>(
  key: K,
  applicationPolicy: NullableAttachmentPolicy | null,
  globalPolicy: NullableAttachmentPolicy | null,
): AttachmentPolicyValues[K] {
  const applicationValue = applicationPolicy?.[key];
  if (applicationValue !== null && applicationValue !== undefined) {
    return applicationValue as AttachmentPolicyValues[K];
  }

  if (applicationPolicy?.inheritGlobal !== false) {
    const globalValue = globalPolicy?.[key];
    if (globalValue !== null && globalValue !== undefined) {
      return globalValue as AttachmentPolicyValues[K];
    }
  }

  return DEFAULT_ATTACHMENT_POLICY[key] as AttachmentPolicyValues[K];
}

export function mergeAttachmentPolicy(
  applicationPolicy: NullableAttachmentPolicy | null,
  globalPolicy: NullableAttachmentPolicy | null,
): EffectiveAttachmentPolicy {
  return {
    enabled: resolveField("enabled", applicationPolicy, globalPolicy),
    privateEnabled: resolveField(
      "privateEnabled",
      applicationPolicy,
      globalPolicy,
    ),
    groupEnabled: resolveField("groupEnabled", applicationPolicy, globalPolicy),
    maxFileSizeBytes: resolveField(
      "maxFileSizeBytes",
      applicationPolicy,
      globalPolicy,
    ),
    maxFilesPerMessage: resolveField(
      "maxFilesPerMessage",
      applicationPolicy,
      globalPolicy,
    ),
    maxTotalSizeBytes: resolveField(
      "maxTotalSizeBytes",
      applicationPolicy,
      globalPolicy,
    ),
    storageQuotaBytes: resolveField(
      "storageQuotaBytes",
      applicationPolicy,
      globalPolicy,
    ),
    imagePreviewEnabled: resolveField(
      "imagePreviewEnabled",
      applicationPolicy,
      globalPolicy,
    ),
    pdfPreviewEnabled: resolveField(
      "pdfPreviewEnabled",
      applicationPolicy,
      globalPolicy,
    ),
    malwareScanEnabled: resolveField(
      "malwareScanEnabled",
      applicationPolicy,
      globalPolicy,
    ),
    malwareScannerProviderId: resolveField(
      "malwareScannerProviderId",
      applicationPolicy,
      globalPolicy,
    ),
    validateMime: resolveField("validateMime", applicationPolicy, globalPolicy),
    validateSignature: resolveField(
      "validateSignature",
      applicationPolicy,
      globalPolicy,
    ),
    temporaryTtlMinutes: resolveField(
      "temporaryTtlMinutes",
      applicationPolicy,
      globalPolicy,
    ),
    failedCleanupHours: resolveField(
      "failedCleanupHours",
      applicationPolicy,
      globalPolicy,
    ),
    uploadRateLimitEnabled: resolveField(
      "uploadRateLimitEnabled",
      applicationPolicy,
      globalPolicy,
    ),
    uploadRateLimitWindowMs: resolveField(
      "uploadRateLimitWindowMs",
      applicationPolicy,
      globalPolicy,
    ),
    uploadRateLimitMaxRequests: resolveField(
      "uploadRateLimitMaxRequests",
      applicationPolicy,
      globalPolicy,
    ),
    uploadRateLimitMaxBytes: resolveField(
      "uploadRateLimitMaxBytes",
      applicationPolicy,
      globalPolicy,
    ),
    deleteRetryMaxAttempts: resolveField(
      "deleteRetryMaxAttempts",
      applicationPolicy,
      globalPolicy,
    ),
    deleteRetryBaseMinutes: resolveField(
      "deleteRetryBaseMinutes",
      applicationPolicy,
      globalPolicy,
    ),
    auditDownloadEnabled: resolveField(
      "auditDownloadEnabled",
      applicationPolicy,
      globalPolicy,
    ),
    auditPreviewEnabled: resolveField(
      "auditPreviewEnabled",
      applicationPolicy,
      globalPolicy,
    ),
    storageProviderId: resolveField(
      "storageProviderId",
      applicationPolicy,
      globalPolicy,
    ),
    source: applicationPolicy ? "APPLICATION" : "GLOBAL",
  };
}

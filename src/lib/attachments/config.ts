import "server-only";

import { prisma } from "@/lib/db/prisma";
import { GLOBAL_ATTACHMENT_POLICY_KEY } from "@/lib/attachments/constants";
import {
  mergeAttachmentPolicy,
  type EffectiveAttachmentPolicy,
  type NullableAttachmentPolicy,
} from "@/lib/attachments/policy";

const attachmentPolicySelect = {
  inheritGlobal: true,
  enabled: true,
  privateEnabled: true,
  groupEnabled: true,
  maxFileSizeBytes: true,
  maxFilesPerMessage: true,
  maxTotalSizeBytes: true,
  storageQuotaBytes: true,
  imagePreviewEnabled: true,
  pdfPreviewEnabled: true,
  malwareScanEnabled: true,
  malwareScannerProviderId: true,
  validateMime: true,
  validateSignature: true,
  temporaryTtlMinutes: true,
  failedCleanupHours: true,
  uploadRateLimitEnabled: true,
  uploadRateLimitWindowMs: true,
  uploadRateLimitMaxRequests: true,
  uploadRateLimitMaxBytes: true,
  deleteRetryMaxAttempts: true,
  deleteRetryBaseMinutes: true,
  auditDownloadEnabled: true,
  auditPreviewEnabled: true,
  storageProviderId: true,
} as const;

export async function resolveAttachmentPolicy(applicationId: string): Promise<EffectiveAttachmentPolicy> {
  const [globalRow, applicationRow] = await Promise.all([
    prisma.attachmentPolicy.findUnique({
      where: { key: GLOBAL_ATTACHMENT_POLICY_KEY },
      select: attachmentPolicySelect,
    }),
    prisma.attachmentPolicy.findUnique({
      where: { applicationId },
      select: attachmentPolicySelect,
    }),
  ]);

  return mergeAttachmentPolicy(
    applicationRow as NullableAttachmentPolicy | null,
    globalRow as NullableAttachmentPolicy | null,
  );
}

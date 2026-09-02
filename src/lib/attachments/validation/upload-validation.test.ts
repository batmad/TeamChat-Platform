import { describe, expect, it } from "vitest";

import type { EffectiveAttachmentFileType } from "@/lib/attachments/file-types";
import type { EffectiveAttachmentPolicy } from "@/lib/attachments/policy";
import {
  validateAttachmentUploadContent,
  validateAttachmentUploadMetadata,
} from "@/lib/attachments/validation/upload-validation";

const policy: EffectiveAttachmentPolicy = {
  enabled: true,
  privateEnabled: true,
  groupEnabled: true,

  maxFileSizeBytes: BigInt(10 * 1024 * 1024),
  maxFilesPerMessage: 5,
  maxTotalSizeBytes: BigInt(25 * 1024 * 1024),
  storageQuotaBytes: null,

  imagePreviewEnabled: true,
  pdfPreviewEnabled: true,

  malwareScanEnabled: false,
  malwareScannerProviderId: null,

  validateMime: true,
  validateSignature: true,

  temporaryTtlMinutes: 60,
  failedCleanupHours: 24,

  uploadRateLimitEnabled: false,
  uploadRateLimitWindowMs: 60_000,
  uploadRateLimitMaxRequests: 20,
  uploadRateLimitMaxBytes: BigInt(100 * 1024 * 1024),

  deleteRetryMaxAttempts: 3,
  deleteRetryBaseMinutes: 5,

  auditDownloadEnabled: true,
  auditPreviewEnabled: true,

  storageProviderId: null,

  source: "GLOBAL",
};

const pdfType: EffectiveAttachmentFileType = {
  id: "pdf",
  key: "GLOBAL:pdf",
  applicationId: null,
  category: "DOCUMENT",
  extension: "pdf",
  mimeTypes: ["application/pdf"],
  maxSizeBytes: null,
  previewable: true,
  isAllowed: true,
  isActive: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe("attachment upload validation", () => {
  it("validates metadata and content then produces SHA-256", async () => {
    const payload = new TextEncoder().encode("%PDF-1.7\ntest");
    const file = {
      name: "report.pdf",
      size: payload.byteLength,
      type: "application/pdf",
      async arrayBuffer() {
        return payload.buffer.slice(
          payload.byteOffset,
          payload.byteOffset + payload.byteLength,
        ) as ArrayBuffer;
      },
    };

    const metadata = validateAttachmentUploadMetadata({
      file,
      fileType: pdfType,
      policy,
    });
    const validated = await validateAttachmentUploadContent({
      metadata,
      policy,
    });

    expect(validated.detectedMimeType).toBe("application/pdf");
    expect(validated.checksum).toMatch(/^[a-f0-9]{64}$/);
  });
});

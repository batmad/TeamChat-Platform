import { describe, expect, it } from "vitest";
import { DEFAULT_ATTACHMENT_POLICY } from "@/lib/attachments/constants";
import {
  mergeAttachmentPolicy,
  type NullableAttachmentPolicy,
} from "@/lib/attachments/policy";

function policy(
  overrides: Partial<NullableAttachmentPolicy> = {},
): NullableAttachmentPolicy {
  return {
    inheritGlobal: false,

    enabled: null,
    privateEnabled: null,
    groupEnabled: null,

    maxFileSizeBytes: null,
    maxFilesPerMessage: null,
    maxTotalSizeBytes: null,
    storageQuotaBytes: null,

    imagePreviewEnabled: null,
    pdfPreviewEnabled: null,

    malwareScanEnabled: null,
    malwareScannerProviderId: null,

    validateMime: null,
    validateSignature: null,

    temporaryTtlMinutes: null,
    failedCleanupHours: null,

    uploadRateLimitEnabled: null,
    uploadRateLimitWindowMs: null,
    uploadRateLimitMaxRequests: null,
    uploadRateLimitMaxBytes: null,

    deleteRetryMaxAttempts: null,
    deleteRetryBaseMinutes: null,

    auditDownloadEnabled: null,
    auditPreviewEnabled: null,

    storageProviderId: null,

    ...overrides,
  };
}

describe("mergeAttachmentPolicy", () => {
  it("uses global values when there is no application override", () => {
    const result = mergeAttachmentPolicy(
      null,
      policy({ maxFilesPerMessage: 8, enabled: false }),
    );

    expect(result.source).toBe("GLOBAL");
    expect(result.maxFilesPerMessage).toBe(8);
    expect(result.enabled).toBe(false);
  });

  it("merges application values over global values", () => {
    const result = mergeAttachmentPolicy(
      policy({
        inheritGlobal: true,
        maxFileSizeBytes: BigInt(10 * 1024 * 1024),
      }),
      policy({
        maxFileSizeBytes: BigInt(25 * 1024 * 1024),
        maxFilesPerMessage: 8,
      }),
    );

    expect(result.source).toBe("APPLICATION");
    expect(result.maxFileSizeBytes).toBe(BigInt(10 * 1024 * 1024));
    expect(result.maxFilesPerMessage).toBe(8);
  });

  it("falls back to safe defaults when inheritance is disabled", () => {
    const result = mergeAttachmentPolicy(
      policy({ inheritGlobal: false }),
      policy({ maxFilesPerMessage: 99 }),
    );

    expect(result.maxFilesPerMessage).toBe(
      DEFAULT_ATTACHMENT_POLICY.maxFilesPerMessage,
    );
  });
});

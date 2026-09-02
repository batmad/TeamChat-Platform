import { describe, expect, it } from "vitest";

import { buildAttachmentWidgetConfig } from "@/lib/attachments/widget-config";

const policy = {
  enabled: true,
  privateEnabled: true,
  groupEnabled: true,
  maxFileSizeBytes: BigInt(25 * 1024 * 1024),
  maxFilesPerMessage: 5,
  maxTotalSizeBytes: BigInt(50 * 1024 * 1024),
  imagePreviewEnabled: true,
  pdfPreviewEnabled: true,
  malwareScanEnabled: false,
};

describe("buildAttachmentWidgetConfig", () => {
  it("separates private and group attachment permissions", () => {
    const result = buildAttachmentWidgetConfig({
      policy,
      permissions: [
        "chat.private.attachment.send",
        "chat.private.attachment.delete",
        "chat.group.attachment.download",
        "chat.group.attachment.delete_others",
      ],
      fileTypes: [],
    });
    expect(result.scopes.PRIVATE.canSend).toBe(true);
    expect(result.scopes.PRIVATE.canDelete).toBe(true);
    expect(result.scopes.PRIVATE.canDeleteOthers).toBe(false);
    expect(result.scopes.GROUP.canSend).toBe(false);
    expect(result.scopes.GROUP.canDownload).toBe(true);
    expect(result.scopes.GROUP.canDeleteOthers).toBe(true);
  });

  it("serializes bigint limits and filters inactive file types", () => {
    const result = buildAttachmentWidgetConfig({
      policy,
      permissions: [],
      fileTypes: [
        {
          extension: "pdf",
          category: "DOCUMENT",
          mimeTypes: ["application/pdf"],
          maxSizeBytes: BigInt(10 * 1024 * 1024),
          previewable: true,
          isAllowed: true,
          isActive: true,
        },
        {
          extension: "exe",
          category: "OTHER",
          mimeTypes: [],
          maxSizeBytes: null,
          previewable: false,
          isAllowed: false,
          isActive: false,
        },
      ],
    });
    expect(result.limits.maxFileSizeBytes).toBe(String(25 * 1024 * 1024));
    expect(result.fileTypes).toHaveLength(1);
    expect(result.fileTypes[0]).toMatchObject({
      extension: "pdf",
      maxSizeBytes: String(10 * 1024 * 1024),
      previewable: true,
    });
  });
});

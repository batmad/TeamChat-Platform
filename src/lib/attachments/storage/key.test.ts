import { describe, expect, it } from "vitest";

import { buildAttachmentStorageKey } from "@/lib/attachments/storage/key";

describe("buildAttachmentStorageKey", () => {
  it("creates an application/date scoped opaque key", () => {
    expect(
      buildAttachmentStorageKey({
        applicationId: "app_123",
        attachmentId: "attachment-123",
        createdAt: new Date("2026-08-11T04:00:00.000Z"),
      }),
    ).toBe("app_123/2026/08/attachment-123/attachment-123.bin");
  });
});

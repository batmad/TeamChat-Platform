import { describe, expect, it } from "vitest";

import { serializeMessageAttachment } from "@/lib/attachments/message/payload";

describe("serializeMessageAttachment", () => {
  it("marks a ready attachment as logically expired when expiresAt has passed", () => {
    const payload = serializeMessageAttachment({
      id: "a1",
      originalName: "report.pdf",
      extension: "pdf",
      mimeType: "application/pdf",
      detectedMimeType: "application/pdf",
      sizeBytes: BigInt(120),
      checksum: "abc",
      status: "READY",
      scanStatus: "NOT_REQUIRED",
      expiresAt: new Date(Date.now() - 1_000),
      deletedAt: null,
      deleteReason: null,
      createdAt: new Date("2026-08-11T00:00:00.000Z"),
    });

    expect(payload.status).toBe("EXPIRED");
    expect(payload.previewKind).toBe("PDF");
  });

  it("never exposes storage information in message payload", () => {
    const payload = serializeMessageAttachment({
      id: "a2",
      originalName: "photo.png",
      extension: "png",
      mimeType: "image/png",
      detectedMimeType: "image/png",
      sizeBytes: BigInt(1),
      checksum: null,
      status: "READY",
      scanStatus: "NOT_REQUIRED",
      expiresAt: null,
      deletedAt: null,
      deleteReason: null,
      createdAt: new Date("2026-08-11T00:00:00.000Z"),
    });

    expect(payload.previewKind).toBe("IMAGE");
    expect(payload).not.toHaveProperty("storageKey");
    expect(payload).not.toHaveProperty("storageProviderId");
  });
});

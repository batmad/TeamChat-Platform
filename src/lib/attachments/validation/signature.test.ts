import { describe, expect, it } from "vitest";

import {
  assertAttachmentSignatureAllowed,
  detectAttachmentSignature,
} from "@/lib/attachments/validation/signature";

describe("attachment signature validation", () => {
  it("detects PDF", () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\n");
    expect(detectAttachmentSignature(bytes)?.detectedMimeType).toBe("application/pdf");
  });

  it("distinguishes OOXML Word from a generic ZIP container", () => {
    const bytes = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,
      ...new TextEncoder().encode("word/document.xml"),
    ]);
    expect(
      assertAttachmentSignatureAllowed({ bytes, extension: "docx", validationEnabled: true })?.name,
    ).toBe("OOXML_WORD");
    expect(() =>
      assertAttachmentSignatureAllowed({ bytes, extension: "xlsx", validationEnabled: true }),
    ).toThrow(/does not match/i);
  });

  it("rejects renamed executable-like binary as PDF", () => {
    const bytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3]);
    expect(() =>
      assertAttachmentSignatureAllowed({ bytes, extension: "pdf", validationEnabled: true }),
    ).toThrow(/does not match/i);
  });
});

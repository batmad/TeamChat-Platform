import { describe, expect, it } from "vitest";

import { attachmentContentDisposition } from "@/lib/attachments/message/content";

describe("attachmentContentDisposition", () => {
  it("sanitizes the ASCII fallback and keeps an RFC 5987 filename", () => {
    const value = attachmentContentDisposition("attachment", 'laporan\r\n"Q3".pdf');
    expect(value).toContain('attachment; filename="laporan___Q3_.pdf"');
    expect(value).toContain("filename*=UTF-8''");
    expect(value).not.toContain("\r");
    expect(value).not.toContain("\n");
  });
});

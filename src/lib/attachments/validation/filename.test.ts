import { describe, expect, it } from "vitest";

import { getAttachmentExtension, sanitizeAttachmentFilename } from "@/lib/attachments/validation/filename";

describe("attachment filename validation", () => {
  it("removes path components and dangerous characters", () => {
    expect(sanitizeAttachmentFilename("../../folder/report<final>.PDF")).toBe("report_final_.PDF");
  });

  it("normalizes the extracted extension", () => {
    expect(getAttachmentExtension("Report.Final.PDF")).toBe("pdf");
  });
});

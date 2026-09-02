import { describe, expect, it } from "vitest";
import { attachmentDeleteFinalStatus, attachmentDeleteRetryDelayMs } from "@/lib/attachments/maintenance/retry";

describe("attachment deletion retry", () => {
  it("backs off exponentially", () => {
    expect(attachmentDeleteRetryDelayMs(1, 5)).toBe(5 * 60 * 1000);
    expect(attachmentDeleteRetryDelayMs(3, 5)).toBe(20 * 60 * 1000);
  });

  it("retains EXPIRED semantics for retention deletes", () => {
    expect(attachmentDeleteFinalStatus("RETENTION_EXPIRED")).toBe("EXPIRED");
    expect(attachmentDeleteFinalStatus("USER_DELETE")).toBe("DELETED");
  });
});

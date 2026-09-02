import { describe, expect, it } from "vitest";
import { attachmentRateWindowStart } from "@/lib/attachments/security/rate-limit";

describe("attachmentRateWindowStart", () => {
  it("rounds down into configured fixed window", () => {
    expect(attachmentRateWindowStart(125_999, 60_000)).toBe(120_000);
  });
});

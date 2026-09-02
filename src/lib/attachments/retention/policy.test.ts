import { describe, expect, it } from "vitest";
import { calculateAttachmentExpiresAt } from "@/lib/attachments/retention/policy";

describe("calculateAttachmentExpiresAt", () => {
  it("returns null for keep forever", () => {
    expect(calculateAttachmentExpiresAt(new Date("2026-08-11T00:00:00Z"), {
      source: "GLOBAL",
      keepForever: true,
      retentionDays: null,
    })).toBeNull();
  });

  it("adds retention days", () => {
    expect(calculateAttachmentExpiresAt(new Date("2026-08-11T00:00:00Z"), {
      source: "GLOBAL",
      keepForever: false,
      retentionDays: 30,
    })?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });
});

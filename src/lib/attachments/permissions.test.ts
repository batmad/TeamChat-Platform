import { describe, expect, it } from "vitest";
import { attachmentPermissionFor } from "@/lib/attachments/permissions";

describe("attachmentPermissionFor", () => {
  it("keeps private and group permissions separated", () => {
    expect(attachmentPermissionFor("PRIVATE", "send")).toBe("chat.private.attachment.send");
    expect(attachmentPermissionFor("GROUP", "deleteOthers")).toBe("chat.group.attachment.delete_others");
  });
});

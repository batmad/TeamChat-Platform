import { describe, expect, it } from "vitest";

import {
  MAX_PRIVATE_MESSAGE_LENGTH,
  buildPrivateRoomKey,
  canSendPrivateMessage,
  canStartPrivateConversation,
  canViewPrivateChat,
  getSharedGroupIds,
  hasSharedGroup,
  normalizePrivateMessageContent,
} from "../../src/lib/chat/private-rules";

describe("private chat rules", () => {
  describe("hasSharedGroup", () => {
    it("returns true when both users share a group", () => {
      expect(
        hasSharedGroup(["group-a", "group-b"], ["group-b", "group-c"]),
      ).toBe(true);
    });

    it("returns false when users do not share a group", () => {
      expect(hasSharedGroup(["group-a"], ["group-b"])).toBe(false);
    });

    it("returns false when one user has no groups", () => {
      expect(hasSharedGroup([], ["group-a"])).toBe(false);
      expect(hasSharedGroup(["group-a"], [])).toBe(false);
    });
  });

  describe("getSharedGroupIds", () => {
    it("returns unique shared group IDs", () => {
      expect(
        getSharedGroupIds(
          ["group-a", "group-b", "group-b"],
          ["group-b", "group-c"],
        ),
      ).toEqual(["group-b"]);
    });

    it("returns an empty array when there is no shared group", () => {
      expect(getSharedGroupIds(["group-a"], ["group-b"])).toEqual([]);
    });
  });

  describe("canViewPrivateChat", () => {
    it("allows users with chat.private.view", () => {
      expect(canViewPrivateChat(["chat.private.view"])).toBe(true);
    });

    it("rejects users without chat.private.view", () => {
      expect(canViewPrivateChat(["chat.private.send"])).toBe(false);
    });
  });

  describe("canStartPrivateConversation", () => {
    it("allows starting a conversation when users share a group", () => {
      expect(
        canStartPrivateConversation({
          permissions: ["chat.private.view", "chat.private.send"],
          actorGroupIds: ["group-a"],
          targetGroupIds: ["group-a"],
        }),
      ).toBe(true);
    });

    it("rejects starting a conversation without a shared group", () => {
      expect(
        canStartPrivateConversation({
          permissions: ["chat.private.view", "chat.private.send"],
          actorGroupIds: ["group-a"],
          targetGroupIds: ["group-b"],
        }),
      ).toBe(false);
    });

    it("allows cross-group conversations with chat.private.all", () => {
      expect(
        canStartPrivateConversation({
          permissions: [
            "chat.private.view",
            "chat.private.send",
            "chat.private.all",
          ],
          actorGroupIds: [],
          targetGroupIds: [],
        }),
      ).toBe(true);
    });

    it("rejects starting a conversation without chat.private.send", () => {
      expect(
        canStartPrivateConversation({
          permissions: ["chat.private.view"],
          actorGroupIds: ["group-a"],
          targetGroupIds: ["group-a"],
        }),
      ).toBe(false);
    });

    it("rejects starting a conversation without chat.private.view", () => {
      expect(
        canStartPrivateConversation({
          permissions: ["chat.private.send"],
          actorGroupIds: ["group-a"],
          targetGroupIds: ["group-a"],
        }),
      ).toBe(false);
    });
  });

  describe("canSendPrivateMessage", () => {
    it("allows an active room member to reply without a shared group", () => {
      expect(
        canSendPrivateMessage({
          permissions: ["chat.private.view", "chat.private.send"],
          isRoomMember: true,
        }),
      ).toBe(true);
    });

    it("rejects sending when the user is not a room member", () => {
      expect(
        canSendPrivateMessage({
          permissions: ["chat.private.view", "chat.private.send"],
          isRoomMember: false,
        }),
      ).toBe(false);
    });

    it("rejects sending without chat.private.send", () => {
      expect(
        canSendPrivateMessage({
          permissions: ["chat.private.view"],
          isRoomMember: true,
        }),
      ).toBe(false);
    });

    it("rejects sending without chat.private.view", () => {
      expect(
        canSendPrivateMessage({
          permissions: ["chat.private.send"],
          isRoomMember: true,
        }),
      ).toBe(false);
    });

    it("does not require chat.private.all for an existing room", () => {
      expect(
        canSendPrivateMessage({
          permissions: ["chat.private.view", "chat.private.send"],
          isRoomMember: true,
        }),
      ).toBe(true);
    });
  });

  describe("normalizePrivateMessageContent", () => {
    it("trims valid message content", () => {
      expect(normalizePrivateMessageContent("  Hello  ")).toEqual({
        ok: true,
        content: "Hello",
      });
    });

    it("rejects empty or whitespace-only content", () => {
      expect(normalizePrivateMessageContent("   ")).toEqual({
        ok: false,
        code: "MESSAGE_EMPTY",
      });

      expect(normalizePrivateMessageContent(null)).toEqual({
        ok: false,
        code: "MESSAGE_EMPTY",
      });
    });

    it("rejects content longer than the maximum length", () => {
      expect(
        normalizePrivateMessageContent(
          "a".repeat(MAX_PRIVATE_MESSAGE_LENGTH + 1),
        ),
      ).toEqual({
        ok: false,
        code: "MESSAGE_TOO_LONG",
      });
    });

    it("accepts content at the maximum length", () => {
      const content = "a".repeat(MAX_PRIVATE_MESSAGE_LENGTH);

      expect(normalizePrivateMessageContent(content)).toEqual({
        ok: true,
        content,
      });
    });
  });

  describe("buildPrivateRoomKey", () => {
    it("creates the same key regardless of user order", () => {
      expect(buildPrivateRoomKey("user-b", "user-a")).toBe("user-a:user-b");
      expect(buildPrivateRoomKey("user-a", "user-b")).toBe("user-a:user-b");
    });
  });
});

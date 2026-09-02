export const MAX_PRIVATE_MESSAGE_LENGTH = 4_000;

export function hasSharedGroup(
  firstGroupIds: readonly string[],
  secondGroupIds: readonly string[],
): boolean {
  if (firstGroupIds.length === 0 || secondGroupIds.length === 0) {
    return false;
  }

  const second = new Set(secondGroupIds);

  return firstGroupIds.some((groupId) => second.has(groupId));
}

export function getSharedGroupIds(
  firstGroupIds: readonly string[],
  secondGroupIds: readonly string[],
): string[] {
  const second = new Set(secondGroupIds);

  return [...new Set(firstGroupIds.filter((groupId) => second.has(groupId)))];
}

/**
 * User dapat melihat private chat yang melibatkan dirinya.
 */
export function canViewPrivateChat(permissions: readonly string[]): boolean {
  return permissions.includes("chat.private.view");
}

/**
 * User memiliki permission untuk mengirim private message.
 */
export function hasPrivateSendPermission(
  permissions: readonly string[],
): boolean {
  return permissions.includes("chat.private.send");
}

/**
 * Mengizinkan user melewati pembatasan shared group
 * saat memulai private conversation baru.
 */
export function canBypassPrivateGroupRestriction(
  permissions: readonly string[],
): boolean {
  return permissions.includes("chat.private.all");
}

/**
 * Memulai percakapan baru hanya diperbolehkan apabila:
 * - memiliki permission view dan send; serta
 * - memiliki shared group atau chat.private.all.
 */
export function canStartPrivateConversation(input: {
  permissions: readonly string[];
  actorGroupIds: readonly string[];
  targetGroupIds: readonly string[];
}): boolean {
  return (
    canViewPrivateChat(input.permissions) &&
    hasPrivateSendPermission(input.permissions) &&
    (canBypassPrivateGroupRestriction(input.permissions) ||
      hasSharedGroup(input.actorGroupIds, input.targetGroupIds))
  );
}

/**
 * Mengirim atau membalas pesan pada room yang sudah ada.
 *
 * Shared group tidak diperiksa lagi karena validasi shared group
 * dilakukan saat percakapan pertama kali dibuat.
 */
export function canSendPrivateMessage(input: {
  permissions: readonly string[];
  isRoomMember: boolean;
}): boolean {
  return (
    input.isRoomMember &&
    canViewPrivateChat(input.permissions) &&
    hasPrivateSendPermission(input.permissions)
  );
}

export function normalizePrivateMessageContent(value: unknown):
  | { ok: true; content: string }
  | {
      ok: false;
      code: "MESSAGE_EMPTY" | "MESSAGE_TOO_LONG";
    } {
  const content = typeof value === "string" ? value.trim() : "";

  if (!content) {
    return {
      ok: false,
      code: "MESSAGE_EMPTY",
    };
  }

  if (content.length > MAX_PRIVATE_MESSAGE_LENGTH) {
    return {
      ok: false,
      code: "MESSAGE_TOO_LONG",
    };
  }

  return {
    ok: true,
    content,
  };
}

export function buildPrivateRoomKey(
  firstUserIdentityId: string,
  secondUserIdentityId: string,
): string {
  return [firstUserIdentityId, secondUserIdentityId].sort().join(":");
}

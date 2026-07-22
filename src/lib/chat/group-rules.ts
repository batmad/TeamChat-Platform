export const MAX_GROUP_MESSAGE_LENGTH = 4_000;

export function canViewGroupChat(input: {
  permissions: readonly string[];
  groupIds: readonly string[];
  groupId: string;
}) {
  if (!input.permissions.includes("chat.group.view")) return false;
  return input.permissions.includes("chat.group.view_all") || input.groupIds.includes(input.groupId);
}

export function canSendGroupChat(permissions: readonly string[]) {
  return permissions.includes("chat.group.send");
}

export function normalizeGroupMessageContent(value: string) {
  const content = value.trim();
  if (!content) return { ok: false as const, code: "MESSAGE_EMPTY" as const };
  if (content.length > MAX_GROUP_MESSAGE_LENGTH) {
    return { ok: false as const, code: "MESSAGE_TOO_LONG" as const };
  }
  return { ok: true as const, content };
}

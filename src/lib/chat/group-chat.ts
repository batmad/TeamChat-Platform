import { prisma } from "@/lib/db/prisma";
import {
  GroupChatAccessError,
  type GroupChatActor,
  actorHasPermission,
  requireGroupAccess,
  requireGroupChatActor,
} from "@/lib/chat/group-access";
import { MAX_GROUP_MESSAGE_LENGTH, normalizeGroupMessageContent } from "@/lib/chat/group-rules";
import { moderateOutgoingMessage } from "@/lib/moderation/service";
import { markNotificationsReadForMessages } from "@/lib/notifications/service";
import { writeSystemLogSafe } from "@/lib/logs/system-log";

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 100;

export type GroupMessagePayload = {
  id: string;
  clientMessageId: string | null;
  applicationId: string;
  roomId: string;
  groupId: string;
  sender: {
    userIdentityId: string | null;
    username: string;
    name: string | null;
  };
  type: "TEXT";
  content: string;
  replyTo: {
    id: string;
    senderUsername: string;
    senderName: string | null;
    content: string;
  } | null;
  createdAt: string;
  readCount: number;
  isReadByCurrentUser?: boolean;
};

export function realtimeRoomName(roomId: string) {
  return `room:${roomId}`;
}

export async function ensureGroupRoom(
  applicationId: string,
  group: { id: string; name: string },
) {
  return prisma.room.upsert({
    where: {
      applicationId_groupId_type: {
        applicationId,
        groupId: group.id,
        type: "GROUP",
      },
    },
    update: {
      name: group.name,
      isActive: true,
    },
    create: {
      applicationId,
      type: "GROUP",
      name: group.name,
      groupId: group.id,
      isActive: true,
    },
  });
}

export async function ensureRoomMember(
  roomId: string,
  actor: GroupChatActor,
) {
  return prisma.roomMember.upsert({
    where: {
      roomId_userIdentityId: {
        roomId,
        userIdentityId: actor.userIdentityId,
      },
    },
    update: {
      usernameSnapshot: actor.username,
      displayNameSnapshot: actor.displayName,
      isActive: true,
      leftAt: null,
    },
    create: {
      roomId,
      userIdentityId: actor.userIdentityId,
      usernameSnapshot: actor.username,
      displayNameSnapshot: actor.displayName,
      isActive: true,
    },
  });
}

export async function joinGroupChat(userIdentityId: string, groupId: string) {
  const actor = await requireGroupChatActor(userIdentityId);
  const group = await requireGroupAccess(actor, groupId);
  const room = await ensureGroupRoom(actor.applicationId, group);
  await ensureRoomMember(room.id, actor);

  const unreadCount = await countUnreadMessages(room.id, actor.userIdentityId);
  return {
    actor,
    group,
    room,
    unreadCount,
  };
}

export async function listAvailableGroupChats(userIdentityId: string) {
  const actor = await requireGroupChatActor(userIdentityId);
  if (!actorHasPermission(actor, "chat.group.view")) {
    throw new GroupChatAccessError("GROUP_CHAT_VIEW_FORBIDDEN", "Group chat access is not allowed");
  }

  const groups = await prisma.group.findMany({
    where: {
      applicationId: actor.applicationId,
      isActive: true,
      ...(actorHasPermission(actor, "chat.group.view_all")
        ? {}
        : { id: { in: actor.groupIds.length ? actor.groupIds : ["__none__"] } }),
    },
    select: {
      id: true,
      code: true,
      name: true,
      source: true,
      rooms: {
        where: { type: "GROUP", isActive: true },
        take: 1,
        select: {
          id: true,
          messages: {
            where: { deletedAt: null },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: {
              id: true,
              senderUsername: true,
              senderName: true,
              content: true,
              createdAt: true,
            },
          },
        },
      },
    },
    orderBy: [{ name: "asc" }, { code: "asc" }],
  });

  return Promise.all(
    groups.map(async (group: { id: string; code: string; name: string; source: "EXTERNAL" | "INTERNAL"; rooms: Array<{ id: string; messages: Array<{ id: string; senderUsername: string; senderName: string | null; content: string; createdAt: Date }> }> }) => {
      const room = group.rooms[0] ?? null;
      const unreadCount = room ? await countUnreadMessages(room.id, actor.userIdentityId) : 0;
      return {
        id: group.id,
        code: group.code,
        name: group.name,
        source: group.source,
        roomId: room?.id ?? null,
        unreadCount,
        lastMessage: room?.messages[0]
          ? {
              ...room.messages[0],
              createdAt: room.messages[0].createdAt.toISOString(),
            }
          : null,
      };
    }),
  );
}

export async function countUnreadMessages(roomId: string, userIdentityId: string) {
  return prisma.message.count({
    where: {
      roomId,
      deletedAt: null,
      NOT: { senderUserIdentityId: userIdentityId },
      reads: { none: { userIdentityId } },
    },
  });
}

export async function getGroupMessageHistory(input: {
  userIdentityId: string;
  groupId: string;
  cursor?: string | null;
  limit?: number;
}) {
  const actor = await requireGroupChatActor(input.userIdentityId);
  const group = await requireGroupAccess(actor, input.groupId);
  const room = await ensureGroupRoom(actor.applicationId, group);
  await ensureRoomMember(room.id, actor);

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_HISTORY_LIMIT, 1), MAX_HISTORY_LIMIT);
  const messages = await prisma.message.findMany({
    where: {
      applicationId: actor.applicationId,
      roomId: room.id,
      deletedAt: null,
    },
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      clientMessageId: true,
      applicationId: true,
      roomId: true,
      senderUserIdentityId: true,
      senderUsername: true,
      senderName: true,
      type: true,
      content: true,
      createdAt: true,
      replyTo: {
        select: {
          id: true,
          senderUsername: true,
          senderName: true,
          content: true,
        },
      },
      reads: {
        where: { userIdentityId: actor.userIdentityId },
        select: { id: true },
      },
      _count: { select: { reads: true } },
    },
  });

  const data: GroupMessagePayload[] = messages.map((message: { id: string; clientMessageId: string | null; applicationId: string; roomId: string; senderUserIdentityId: string | null; senderUsername: string; senderName: string | null; content: string; createdAt: Date; replyTo: { id: string; senderUsername: string; senderName: string | null; content: string } | null; reads: Array<{ id: string }>; _count: { reads: number } }) => ({
    id: message.id,
    clientMessageId: message.clientMessageId,
    applicationId: message.applicationId,
    roomId: message.roomId,
    groupId: group.id,
    sender: {
      userIdentityId: message.senderUserIdentityId,
      username: message.senderUsername,
      name: message.senderName,
    },
    type: "TEXT",
    content: message.content,
    replyTo: message.replyTo,
    createdAt: message.createdAt.toISOString(),
    readCount: message._count.reads,
    isReadByCurrentUser: message.reads.length > 0,
  }));

  return {
    group,
    room: { id: room.id, name: room.name },
    messages: data,
    nextCursor: messages.length === limit ? messages[messages.length - 1]?.id ?? null : null,
  };
}

export async function sendGroupMessage(input: {
  userIdentityId: string;
  groupId: string;
  content: string;
  replyMessageId?: string | null;
  clientMessageId?: string | null;
}) {
  const actor = await requireGroupChatActor(input.userIdentityId);
  const group = await requireGroupAccess(actor, input.groupId, { requireSend: true });
  const room = await ensureGroupRoom(actor.applicationId, group);
  await ensureRoomMember(room.id, actor);
  const normalizedContent = normalizeGroupMessageContent(input.content);
  if (!normalizedContent.ok) {
    throw new GroupChatAccessError(
      normalizedContent.code,
      normalizedContent.code === "MESSAGE_EMPTY"
        ? "Message content cannot be empty"
        : `Message content cannot exceed ${MAX_GROUP_MESSAGE_LENGTH} characters`,
      400,
    );
  }
  const content = normalizedContent.content;
  const clientMessageId = input.clientMessageId?.trim() || null;

  if (clientMessageId) {
    const existing = await prisma.message.findFirst({
      where: {
        applicationId: actor.applicationId,
        clientMessageId,
      },
      select: { id: true, roomId: true },
    });
    if (existing) {
      if (existing.roomId !== room.id) {
        throw new GroupChatAccessError(
          "CLIENT_MESSAGE_ID_CONFLICT",
          "Client message identifier is already used in another conversation",
          409,
        );
      }
      return getMessagePayload(existing.id, actor.userIdentityId, group.id);
    }
  }

  if (input.replyMessageId) {
    const reply = await prisma.message.findFirst({
      where: {
        id: input.replyMessageId,
        applicationId: actor.applicationId,
        roomId: room.id,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!reply) {
      throw new GroupChatAccessError("REPLY_MESSAGE_INVALID", "Reply target is unavailable", 400);
    }
  }

  const moderation = await moderateOutgoingMessage({
    applicationId: actor.applicationId,
    userIdentityId: actor.userIdentityId,
    username: actor.username,
    userName: actor.displayName,
    roomId: room.id,
    roomType: "GROUP",
    groupId: group.id,
    content,
    metadata: { chatType: "GROUP", clientMessageId },
  });
  if (!moderation.allowed) {
    throw new GroupChatAccessError(moderation.code, moderation.message, 422);
  }

  let message;
  try {
    message = await prisma.message.create({
      data: {
        applicationId: actor.applicationId,
        roomId: room.id,
        senderUserIdentityId: actor.userIdentityId,
        senderUsername: actor.username,
        senderName: actor.displayName,
        type: "TEXT",
        content,
        clientMessageId,
        replyMessageId: input.replyMessageId || null,
        groupContexts: {
          create: { groupId: group.id },
        },
        reads: {
          create: {
            userIdentityId: actor.userIdentityId,
            usernameSnapshot: actor.username,
          },
        },
      },
      select: { id: true },
    });
  } catch (error) {
    if (clientMessageId) {
      const existing = await prisma.message.findFirst({
        where: { applicationId: actor.applicationId, clientMessageId },
        select: { id: true, roomId: true },
      });
      if (existing) {
        if (existing.roomId !== room.id) {
          throw new GroupChatAccessError(
            "CLIENT_MESSAGE_ID_CONFLICT",
            "Client message identifier is already used in another conversation",
            409,
          );
        }
        return getMessagePayload(existing.id, actor.userIdentityId, group.id);
      }
    }
    throw error;
  }

  await writeSystemLogSafe({
    applicationId: actor.applicationId,
    type: "CHAT_ACTIVITY",
    level: "INFO",
    username: actor.username,
    action: "GROUP_MESSAGE_SENT",
    message: `Group message sent to ${group.code}`,
    metadata: {
      messageId: message.id,
      roomId: room.id,
      groupId: group.id,
      clientMessageId,
      replyMessageId: input.replyMessageId ?? null,
    },
  });

  return getMessagePayload(message.id, actor.userIdentityId, group.id);
}

async function getMessagePayload(
  messageId: string,
  currentUserIdentityId: string,
  groupId: string,
): Promise<GroupMessagePayload> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      clientMessageId: true,
      applicationId: true,
      roomId: true,
      senderUserIdentityId: true,
      senderUsername: true,
      senderName: true,
      content: true,
      createdAt: true,
      replyTo: {
        select: {
          id: true,
          senderUsername: true,
          senderName: true,
          content: true,
        },
      },
      reads: {
        where: { userIdentityId: currentUserIdentityId },
        select: { id: true },
      },
      _count: { select: { reads: true } },
    },
  });
  if (!message) throw new GroupChatAccessError("MESSAGE_NOT_FOUND", "Message is unavailable", 404);

  return {
    id: message.id,
    clientMessageId: message.clientMessageId,
    applicationId: message.applicationId,
    roomId: message.roomId,
    groupId,
    sender: {
      userIdentityId: message.senderUserIdentityId,
      username: message.senderUsername,
      name: message.senderName,
    },
    type: "TEXT",
    content: message.content,
    replyTo: message.replyTo,
    createdAt: message.createdAt.toISOString(),
    readCount: message._count.reads,
    isReadByCurrentUser: message.reads.length > 0,
  };
}

export async function markGroupMessagesRead(input: {
  userIdentityId: string;
  groupId: string;
  upToMessageId?: string | null;
}) {
  const actor = await requireGroupChatActor(input.userIdentityId);
  const group = await requireGroupAccess(actor, input.groupId);
  const room = await ensureGroupRoom(actor.applicationId, group);
  await ensureRoomMember(room.id, actor);

  let cutoff: Date | null = null;
  if (input.upToMessageId) {
    const target = await prisma.message.findFirst({
      where: {
        id: input.upToMessageId,
        applicationId: actor.applicationId,
        roomId: room.id,
        deletedAt: null,
      },
      select: { createdAt: true },
    });
    if (!target) {
      throw new GroupChatAccessError("READ_MESSAGE_INVALID", "Read target is unavailable", 400);
    }
    cutoff = target.createdAt;
  }

  const unread = await prisma.message.findMany({
    where: {
      applicationId: actor.applicationId,
      roomId: room.id,
      deletedAt: null,
      NOT: { senderUserIdentityId: actor.userIdentityId },
      ...(cutoff ? { createdAt: { lte: cutoff } } : {}),
      reads: { none: { userIdentityId: actor.userIdentityId } },
    },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const readAt = new Date();
  if (unread.length > 0) {
    await prisma.messageRead.createMany({
      data: unread.map(({ id }: { id: string }) => ({
        messageId: id,
        userIdentityId: actor.userIdentityId,
        usernameSnapshot: actor.username,
        readAt,
      })),
      skipDuplicates: true,
    });
  }
  const totalNotificationUnread = await markNotificationsReadForMessages(
    actor.userIdentityId,
    unread.map(({ id }: { id: string }) => id),
  );

  return {
    group,
    room,
    reader: {
      userIdentityId: actor.userIdentityId,
      username: actor.username,
      name: actor.displayName,
    },
    readAt: readAt.toISOString(),
    upToMessageId: input.upToMessageId ?? unread[unread.length - 1]?.id ?? null,
    markedCount: unread.length,
    unreadCount: await countUnreadMessages(room.id, actor.userIdentityId),
    totalNotificationUnread,
  };
}

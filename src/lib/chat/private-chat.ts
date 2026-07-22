import { prisma } from "@/lib/db/prisma";
import {
  PrivateChatAccessError,
  type PrivateChatActor,
  type PrivateChatParticipant,
  getPrivateAccessState,
  requirePrivateChatActor,
  requirePrivateRoomParticipant,
  resolvePrivateParticipant,
} from "@/lib/chat/private-access";
import {
  MAX_PRIVATE_MESSAGE_LENGTH,
  buildPrivateRoomKey,
  canSendPrivateMessage,
  normalizePrivateMessageContent,
} from "@/lib/chat/private-rules";
import { moderateOutgoingMessage } from "@/lib/moderation/service";
import { markNotificationsReadForMessages } from "@/lib/notifications/service";
import { writeSystemLogSafe } from "@/lib/logs/system-log";

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 100;
const DEFAULT_CONTACT_LIMIT = 50;
const MAX_CONTACT_LIMIT = 100;

export type PrivateMessagePayload = {
  id: string;
  clientMessageId: string | null;
  applicationId: string;
  roomId: string;
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

export function privateRealtimeRoomName(roomId: string) {
  return `room:${roomId}`;
}

async function ensurePrivateRoomMembers(
  roomId: string,
  actor: PrivateChatActor,
  target: PrivateChatParticipant,
) {
  await prisma.roomMember.createMany({
    data: [
      {
        roomId,
        userIdentityId: actor.userIdentityId,
        usernameSnapshot: actor.username,
        displayNameSnapshot: actor.displayName,
        isActive: true,
      },
      {
        roomId,
        userIdentityId: target.userIdentityId,
        usernameSnapshot: target.username,
        displayNameSnapshot: target.displayName,
        isActive: true,
      },
    ],
    skipDuplicates: true,
  });

  await Promise.all([
    prisma.roomMember.updateMany({
      where: {
        roomId,
        userIdentityId: actor.userIdentityId,
      },
      data: {
        usernameSnapshot: actor.username,
        displayNameSnapshot: actor.displayName,
        isActive: true,
        leftAt: null,
      },
    }),
    prisma.roomMember.updateMany({
      where: {
        roomId,
        userIdentityId: target.userIdentityId,
      },
      data: {
        usernameSnapshot: target.username,
        displayNameSnapshot: target.displayName,
        isActive: true,
        leftAt: null,
      },
    }),
  ]);
}

async function findPrivateRoom(applicationId: string, privateKey: string) {
  return prisma.room.findFirst({
    where: {
      applicationId,
      privateKey,
      type: "PRIVATE",
      isActive: true,
    },
  });
}

async function createPrivateRoom(
  actor: PrivateChatActor,
  target: PrivateChatParticipant,
) {
  const privateKey = buildPrivateRoomKey(
    actor.userIdentityId,
    target.userIdentityId,
  );

  const existing = await findPrivateRoom(actor.applicationId, privateKey);

  if (existing) {
    await ensurePrivateRoomMembers(existing.id, actor, target);
    return existing;
  }

  try {
    const room = await prisma.room.create({
      data: {
        applicationId: actor.applicationId,
        type: "PRIVATE",
        privateKey,
        isActive: true,
      },
    });

    await ensurePrivateRoomMembers(room.id, actor, target);

    return room;
  } catch (error) {
    // Menangani kemungkinan dua request membuat room bersamaan
    const concurrent = await findPrivateRoom(actor.applicationId, privateKey);

    if (!concurrent) {
      throw error;
    }

    await ensurePrivateRoomMembers(concurrent.id, actor, target);

    return concurrent;
  }
}

export async function openPrivateConversation(input: {
  userIdentityId: string;
  targetUserIdentityId: string;
}) {
  const actor = await requirePrivateChatActor(input.userIdentityId);

  const target = await resolvePrivateParticipant(
    actor,
    input.targetUserIdentityId,
  );

  const privateKey = buildPrivateRoomKey(
    actor.userIdentityId,
    target.userIdentityId,
  );

  const existingRoom = await findPrivateRoom(actor.applicationId, privateKey);

  const access = getPrivateAccessState(actor, target);

  /*
   * Shared group atau chat.private.all hanya diwajibkan
   * ketika user membuat private conversation baru.
   */
  if (!existingRoom && !access.canStart) {
    const hasSendPermission = actor.permissions.includes("chat.private.send");

    throw new PrivateChatAccessError(
      hasSendPermission
        ? "PRIVATE_CHAT_SHARED_GROUP_REQUIRED"
        : "PRIVATE_CHAT_SEND_FORBIDDEN",
      hasSendPermission
        ? "Private chat requires at least one shared group"
        : "Starting private chat conversations is not allowed",
    );
  }

  const room = existingRoom ?? (await createPrivateRoom(actor, target));

  await ensurePrivateRoomMembers(room.id, actor, target);

  /*
   * Setelah room tersedia dan actor menjadi anggota aktif,
   * pengiriman hanya membutuhkan permission view dan send.
   */
  const canSend = canSendPrivateMessage({
    permissions: actor.permissions,
    isRoomMember: true,
  });

  return {
    actor,
    target,
    room,
    access: {
      ...access,
      canSend,
    },
    unreadCount: await countPrivateUnreadMessages(
      room.id,
      actor.userIdentityId,
    ),
  };
}

export async function joinPrivateConversation(
  userIdentityId: string,
  roomId: string,
) {
  const actor = await requirePrivateChatActor(userIdentityId);

  const {
    room,
    other,
    canSend: roomCanSend,
  } = await requirePrivateRoomParticipant(actor, roomId);

  let target: PrivateChatParticipant | null = null;

  try {
    target = await resolvePrivateParticipant(actor, other.userIdentityId);
  } catch {
    /*
     * History tetap dapat ditampilkan jika user lawan sudah
     * tidak aktif, tetapi pengiriman pesan akan dinonaktifkan.
     */
    target = null;
  }

  const access = target
    ? getPrivateAccessState(actor, target)
    : {
        sharedGroupIds: [],
        hasSharedGroup: false,
        canStart: false,
      };

  return {
    actor,
    room,
    participant: {
      userIdentityId: other.userIdentityId,
      username: target?.username ?? other.usernameSnapshot,
      name: target?.displayName ?? other.displayNameSnapshot,
    },
    access: {
      ...access,

      // Tidak boleh mengirim jika participant sudah tidak tersedia
      canSend: roomCanSend && target !== null,
    },
    unreadCount: await countPrivateUnreadMessages(
      room.id,
      actor.userIdentityId,
    ),
  };
}

export async function listPrivateContacts(input: {
  userIdentityId: string;
  search?: string | null;
  limit?: number;
}) {
  const actor = await requirePrivateChatActor(input.userIdentityId);

  const limit = Math.min(
    Math.max(input.limit ?? DEFAULT_CONTACT_LIMIT, 1),
    MAX_CONTACT_LIMIT,
  );

  const bypass = actor.permissions.includes("chat.private.all");

  const actorGroupIds = Array.from(
    new Set(
      actor.groupIds.filter(
        (groupId): groupId is string =>
          typeof groupId === "string" && groupId.trim().length > 0,
      ),
    ),
  );

  /*
   * User tanpa chat.private.all hanya dapat menemukan kontak
   * yang berada di shared group.
   *
   * Jika actor tidak memiliki group, tidak ada kontak yang
   * boleh ditampilkan.
   */
  if (!bypass && actorGroupIds.length === 0) {
    return [];
  }

  const search = input.search?.trim() || null;

  const identities = await prisma.userIdentity.findMany({
    where: {
      applicationId: actor.applicationId,
      isActive: true,

      id: {
        not: actor.userIdentityId,
      },

      ...(search
        ? {
            OR: [
              {
                username: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                displayNameSnapshot: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),

      /*
       * SPV/user dengan chat.private.all dapat melihat semua
       * user aktif dalam application.
       *
       * Agent hanya melihat user yang memiliki shared group.
       */
      ...(bypass
        ? {}
        : {
            groupMemberships: {
              some: {
                groupId: {
                  in: actorGroupIds,
                },
                group: {
                  applicationId: actor.applicationId,
                  isActive: true,
                },
              },
            },
          }),
    },

    select: {
      id: true,
    },

    orderBy: [
      {
        displayNameSnapshot: "asc",
      },
      {
        username: "asc",
      },
    ],

    /*
     * Ambil lebih banyak kandidat karena beberapa target
     * mungkin ditolak oleh resolvePrivateParticipant().
     */
    take: Math.min(limit * 3, 300),
  });

  const contacts: Array<{
    userIdentityId: string;
    username: string;
    name: string | null;
    sharedGroupIds: string[];
    canStart: true;
  }> = [];

  for (const identity of identities) {
    try {
      const target = await resolvePrivateParticipant(actor, identity.id);

      const access = getPrivateAccessState(actor, target);

      if (!access.canStart) {
        continue;
      }

      contacts.push({
        userIdentityId: target.userIdentityId,
        username: target.username,
        name: target.displayName,
        sharedGroupIds: access.sharedGroupIds,
        canStart: true,
      });

      if (contacts.length >= limit) {
        break;
      }
    } catch {
      /*
       * Target yang sudah tidak aktif atau tidak memiliki
       * akses private chat tidak ditampilkan.
       */
    }
  }

  return contacts;
}

export async function listPrivateConversations(userIdentityId: string) {
  const actor = await requirePrivateChatActor(userIdentityId);

  /*
   * Query membership di bawah hanya mengambil room
   * dengan actor sebagai anggota aktif.
   */
  const canSendExistingConversation = canSendPrivateMessage({
    permissions: actor.permissions,
    isRoomMember: true,
  });

  const memberships = await prisma.roomMember.findMany({
    where: {
      userIdentityId: actor.userIdentityId,
      isActive: true,
      room: {
        applicationId: actor.applicationId,
        type: "PRIVATE",
        isActive: true,
      },
    },
    select: {
      room: {
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          members: {
            where: {
              isActive: true,
            },
            select: {
              userIdentityId: true,
              usernameSnapshot: true,
              displayNameSnapshot: true,
            },
          },
          messages: {
            where: {
              deletedAt: null,
            },
            orderBy: [
              {
                createdAt: "desc",
              },
              {
                id: "desc",
              },
            ],
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
    orderBy: {
      room: {
        updatedAt: "desc",
      },
    },
  });

  return Promise.all(
    memberships.map(
      async (membership: {
        room: {
          id: string;
          createdAt: Date;
          updatedAt: Date;
          members: Array<{
            userIdentityId: string;
            usernameSnapshot: string;
            displayNameSnapshot: string | null;
          }>;
          messages: Array<{
            id: string;
            senderUsername: string;
            senderName: string | null;
            content: string;
            createdAt: Date;
          }>;
        };
      }) => {
        const room = membership.room;

        const other = room.members.find(
          (member) => member.userIdentityId !== actor.userIdentityId,
        );

        let target: PrivateChatParticipant | null = null;

        if (other) {
          try {
            target = await resolvePrivateParticipant(
              actor,
              other.userIdentityId,
            );
          } catch {
            target = null;
          }
        }

        const access = target
          ? getPrivateAccessState(actor, target)
          : {
              sharedGroupIds: [],
              hasSharedGroup: false,
              canStart: false,
            };

        return {
          roomId: room.id,
          participant: other
            ? {
                userIdentityId: other.userIdentityId,
                username: target?.username ?? other.usernameSnapshot,
                name: target?.displayName ?? other.displayNameSnapshot,
              }
            : null,
          unreadCount: await countPrivateUnreadMessages(
            room.id,
            actor.userIdentityId,
          ),
          sharedGroupIds: access.sharedGroupIds,

          /*
           * Existing conversation dapat dibalas tanpa shared group,
           * selama participant masih tersedia dan actor memiliki izin.
           */
          canSend:
            canSendExistingConversation &&
            target !== null &&
            other !== undefined,

          historyAvailable: true,
          lastMessage: room.messages[0]
            ? {
                ...room.messages[0],
                createdAt: room.messages[0].createdAt.toISOString(),
              }
            : null,
          createdAt: room.createdAt.toISOString(),
          updatedAt: room.updatedAt.toISOString(),
        };
      },
    ),
  );
}

export async function countPrivateUnreadMessages(
  roomId: string,
  userIdentityId: string,
) {
  return prisma.message.count({
    where: {
      roomId,
      deletedAt: null,
      NOT: {
        senderUserIdentityId: userIdentityId,
      },
      reads: {
        none: {
          userIdentityId,
        },
      },
    },
  });
}

export async function getPrivateMessageHistory(input: {
  userIdentityId: string;
  roomId: string;
  cursor?: string | null;
  limit?: number;
}) {
  const actor = await requirePrivateChatActor(input.userIdentityId);

  const joined = await joinPrivateConversation(
    actor.userIdentityId,
    input.roomId,
  );

  const limit = Math.min(
    Math.max(input.limit ?? DEFAULT_HISTORY_LIMIT, 1),
    MAX_HISTORY_LIMIT,
  );

  const messages = await prisma.message.findMany({
    where: {
      applicationId: actor.applicationId,
      roomId: joined.room.id,
      deletedAt: null,
    },
    ...(input.cursor
      ? {
          cursor: {
            id: input.cursor,
          },
          skip: 1,
        }
      : {}),
    orderBy: [
      {
        createdAt: "desc",
      },
      {
        id: "desc",
      },
    ],
    take: limit,
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
        where: {
          userIdentityId: actor.userIdentityId,
        },
        select: {
          id: true,
        },
      },
      _count: {
        select: {
          reads: true,
        },
      },
    },
  });

  const data: PrivateMessagePayload[] = messages.map(
    (message: {
      id: string;
      clientMessageId: string | null;
      applicationId: string;
      roomId: string;
      senderUserIdentityId: string | null;
      senderUsername: string;
      senderName: string | null;
      content: string;
      createdAt: Date;
      replyTo: {
        id: string;
        senderUsername: string;
        senderName: string | null;
        content: string;
      } | null;
      reads: Array<{
        id: string;
      }>;
      _count: {
        reads: number;
      };
    }) => ({
      id: message.id,
      clientMessageId: message.clientMessageId,
      applicationId: message.applicationId,
      roomId: message.roomId,
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
    }),
  );

  return {
    room: {
      id: joined.room.id,
    },
    participant: joined.participant,
    sharedGroupIds: joined.access.sharedGroupIds,
    canSend: joined.access.canSend,
    historyAvailable: true,
    messages: data,
    nextCursor:
      messages.length === limit
        ? (messages[messages.length - 1]?.id ?? null)
        : null,
  };
}

async function requirePrivateSendAccess(
  userIdentityId: string,
  roomId: string,
) {
  const actor = await requirePrivateChatActor(userIdentityId);

  const { room, other, canSend } = await requirePrivateRoomParticipant(
    actor,
    roomId,
  );

  /*
   * Participant harus tetap aktif dan masih memiliki
   * akses private chat.
   */
  const target = await resolvePrivateParticipant(actor, other.userIdentityId);

  if (!canSend) {
    throw new PrivateChatAccessError(
      "PRIVATE_CHAT_SEND_FORBIDDEN",
      "Sending private chat messages is not allowed",
    );
  }

  /*
   * Access state masih digunakan untuk mendapatkan
   * sharedGroupIds sebagai metadata konteks pesan.
   */
  const access = getPrivateAccessState(actor, target);

  return {
    actor,
    target,
    room,
    access,
  };
}

export async function sendPrivateMessage(input: {
  userIdentityId: string;
  roomId: string;
  content: string;
  replyMessageId?: string | null;
  clientMessageId?: string | null;
}) {
  const { actor, room, access } = await requirePrivateSendAccess(
    input.userIdentityId,
    input.roomId,
  );

  const normalizedContent = normalizePrivateMessageContent(input.content);

  if (!normalizedContent.ok) {
    throw new PrivateChatAccessError(
      normalizedContent.code,
      normalizedContent.code === "MESSAGE_EMPTY"
        ? "Message content cannot be empty"
        : `Message content cannot exceed ${MAX_PRIVATE_MESSAGE_LENGTH} characters`,
      400,
    );
  }

  const clientMessageId = input.clientMessageId?.trim() || null;

  if (clientMessageId) {
    const existing = await prisma.message.findFirst({
      where: {
        applicationId: actor.applicationId,
        clientMessageId,
      },
      select: {
        id: true,
        roomId: true,
      },
    });

    if (existing) {
      if (existing.roomId !== room.id) {
        throw new PrivateChatAccessError(
          "CLIENT_MESSAGE_ID_CONFLICT",
          "Client message identifier is already used in another conversation",
          409,
        );
      }

      return getPrivateMessagePayload(existing.id, actor.userIdentityId);
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
      select: {
        id: true,
      },
    });

    if (!reply) {
      throw new PrivateChatAccessError(
        "REPLY_MESSAGE_INVALID",
        "Reply target is unavailable",
        400,
      );
    }
  }

  const moderation = await moderateOutgoingMessage({
    applicationId: actor.applicationId,
    userIdentityId: actor.userIdentityId,
    username: actor.username,
    userName: actor.displayName,
    roomId: room.id,
    roomType: "PRIVATE",
    content: normalizedContent.content,
    metadata: {
      chatType: "PRIVATE",
      clientMessageId,
    },
  });

  if (!moderation.allowed) {
    throw new PrivateChatAccessError(moderation.code, moderation.message, 422);
  }

  let created;

  try {
    created = await prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          applicationId: actor.applicationId,
          roomId: room.id,
          senderUserIdentityId: actor.userIdentityId,
          senderUsername: actor.username,
          senderName: actor.displayName,
          type: "TEXT",
          content: normalizedContent.content,
          clientMessageId,
          replyMessageId: input.replyMessageId || null,
          ...(access.sharedGroupIds.length
            ? {
                groupContexts: {
                  create: access.sharedGroupIds.map((groupId) => ({
                    groupId,
                  })),
                },
              }
            : {}),
          reads: {
            create: {
              userIdentityId: actor.userIdentityId,
              usernameSnapshot: actor.username,
            },
          },
        },
        select: {
          id: true,
        },
      });

      // Perbarui waktu room agar conversation terbaru naik ke atas
      await tx.room.update({
        where: {
          id: room.id,
        },
        data: {
          updatedAt: new Date(),
        },
      });

      return message;
    });
  } catch (error) {
    if (clientMessageId) {
      const existing = await prisma.message.findFirst({
        where: {
          applicationId: actor.applicationId,
          clientMessageId,
        },
        select: {
          id: true,
          roomId: true,
        },
      });

      if (existing) {
        if (existing.roomId !== room.id) {
          throw new PrivateChatAccessError(
            "CLIENT_MESSAGE_ID_CONFLICT",
            "Client message identifier is already used in another conversation",
            409,
          );
        }

        return getPrivateMessagePayload(existing.id, actor.userIdentityId);
      }
    }

    throw error;
  }

  await writeSystemLogSafe({
    applicationId: actor.applicationId,
    type: "CHAT_ACTIVITY",
    level: "INFO",
    username: actor.username,
    action: "PRIVATE_MESSAGE_SENT",
    message: "Private message sent",
    metadata: {
      messageId: created.id,
      roomId: room.id,
      clientMessageId,
      replyMessageId: input.replyMessageId ?? null,
    },
  });

  return getPrivateMessagePayload(created.id, actor.userIdentityId);
}

async function getPrivateMessagePayload(
  messageId: string,
  currentUserIdentityId: string,
): Promise<PrivateMessagePayload> {
  const message = await prisma.message.findUnique({
    where: {
      id: messageId,
    },
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
        where: {
          userIdentityId: currentUserIdentityId,
        },
        select: {
          id: true,
        },
      },
      _count: {
        select: {
          reads: true,
        },
      },
    },
  });

  if (!message) {
    throw new PrivateChatAccessError(
      "MESSAGE_NOT_FOUND",
      "Message is unavailable",
      404,
    );
  }

  return {
    id: message.id,
    clientMessageId: message.clientMessageId,
    applicationId: message.applicationId,
    roomId: message.roomId,
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

export async function markPrivateMessagesRead(input: {
  userIdentityId: string;
  roomId: string;
  upToMessageId?: string | null;
}) {
  const actor = await requirePrivateChatActor(input.userIdentityId);

  const joined = await joinPrivateConversation(
    actor.userIdentityId,
    input.roomId,
  );

  let cutoff: Date | null = null;

  if (input.upToMessageId) {
    const target = await prisma.message.findFirst({
      where: {
        id: input.upToMessageId,
        applicationId: actor.applicationId,
        roomId: joined.room.id,
        deletedAt: null,
      },
      select: {
        createdAt: true,
      },
    });

    if (!target) {
      throw new PrivateChatAccessError(
        "READ_MESSAGE_INVALID",
        "Read target is unavailable",
        400,
      );
    }

    cutoff = target.createdAt;
  }

  const unread = await prisma.message.findMany({
    where: {
      applicationId: actor.applicationId,
      roomId: joined.room.id,
      deletedAt: null,
      NOT: {
        senderUserIdentityId: actor.userIdentityId,
      },
      ...(cutoff
        ? {
            createdAt: {
              lte: cutoff,
            },
          }
        : {}),
      reads: {
        none: {
          userIdentityId: actor.userIdentityId,
        },
      },
    },
    select: {
      id: true,
    },
    orderBy: [
      {
        createdAt: "asc",
      },
      {
        id: "asc",
      },
    ],
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
    roomId: joined.room.id,
    reader: {
      userIdentityId: actor.userIdentityId,
      username: actor.username,
      name: actor.displayName,
    },
    readAt: readAt.toISOString(),
    upToMessageId: input.upToMessageId ?? unread[unread.length - 1]?.id ?? null,
    markedCount: unread.length,
    unreadCount: await countPrivateUnreadMessages(
      joined.room.id,
      actor.userIdentityId,
    ),
    totalNotificationUnread,
  };
}

export async function getPrivateTypingContext(
  userIdentityId: string,
  roomId: string,
) {
  const { actor, room } = await requirePrivateSendAccess(
    userIdentityId,
    roomId,
  );

  return {
    actor,
    room,
  };
}

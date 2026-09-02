import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { resolveGroupChatActor } from "@/lib/chat/group-access";
import { canViewGroupChat } from "@/lib/chat/group-rules";
import {
  buildNotificationPreview,
  isRoomMuteActive,
  shouldAlertForNotification,
} from "@/lib/notifications/rules";

export type NotificationDispatchPayload = {
  recipientUserIdentityId: string;
  notification: {
    id: string;
    type: "MESSAGE";
    title: string;
    body: string | null;
    roomId: string | null;
    messageId: string | null;
    createdAt: string;
    metadata: Record<string, unknown> | null;
  };
  totalUnread: number;
  roomUnread: number;
  shouldPlaySound: boolean;
  shouldShowBrowserNotification: boolean;
  muted: boolean;
};

async function ensureNotificationSetting(userIdentityId: string) {
  const existing = await prisma.notificationSetting.findUnique({
    where: { userIdentityId },
  });
  if (existing) return existing;

  const identity = await prisma.userIdentity.findUnique({
    where: { id: userIdentityId },
    select: {
      id: true,
      application: {
        select: {
          widgetConfig: {
            select: {
              soundEnabledByDefault: true,
              browserNotificationEnabledByDefault: true,
            },
          },
        },
      },
    },
  });
  if (!identity) throw new Error("NOTIFICATION_USER_NOT_FOUND");

  return prisma.notificationSetting.create({
    data: {
      userIdentityId,
      soundEnabled:
        identity.application.widgetConfig?.soundEnabledByDefault ?? true,
      browserNotificationEnabled:
        identity.application.widgetConfig
          ?.browserNotificationEnabledByDefault ?? true,
    },
  });
}

async function resolveRoomMute(userIdentityId: string, roomId: string) {
  const mute = await prisma.roomMute.findUnique({
    where: { userIdentityId_roomId: { userIdentityId, roomId } },
    select: { mutedUntil: true },
  });
  if (!mute) return false;
  return isRoomMuteActive(mute.mutedUntil);
}

export async function getNotificationPreferences(
  userIdentityId: string,
  roomId?: string | null,
) {
  const settings = await ensureNotificationSetting(userIdentityId);
  const roomMuted = roomId
    ? await resolveRoomMute(userIdentityId, roomId)
    : false;
  return {
    soundEnabled: settings.soundEnabled,
    browserNotificationEnabled: settings.browserNotificationEnabled,
    muteAll: settings.muteAll,
    roomMuted,
    shouldPlaySound: shouldAlertForNotification({
      muteAll: settings.muteAll,
      roomMuted,
      settingEnabled: settings.soundEnabled,
    }),
    shouldShowBrowserNotification: shouldAlertForNotification({
      muteAll: settings.muteAll,
      roomMuted,
      settingEnabled: settings.browserNotificationEnabled,
    }),
  };
}

export async function getNotificationSettings(userIdentityId: string) {
  const settings = await ensureNotificationSetting(userIdentityId);
  const now = new Date();
  const mutes = await prisma.roomMute.findMany({
    where: {
      userIdentityId,
      OR: [{ mutedUntil: null }, { mutedUntil: { gt: now } }],
    },
    select: {
      roomId: true,
      mutedUntil: true,
      room: {
        select: {
          type: true,
          name: true,
          group: { select: { id: true, code: true, name: true } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return {
    soundEnabled: settings.soundEnabled,
    browserNotificationEnabled: settings.browserNotificationEnabled,
    muteAll: settings.muteAll,
    roomMutes: mutes.map(
      (mute: {
        roomId: string;
        mutedUntil: Date | null;
        room: {
          type: string;
          name: string | null;
          group: { id: string; code: string; name: string } | null;
        };
      }) => ({
        roomId: mute.roomId,
        mutedUntil: mute.mutedUntil?.toISOString() ?? null,
        roomType: mute.room.type,
        roomName: mute.room.name,
        group: mute.room.group,
      }),
    ),
  };
}

export async function updateNotificationSettings(input: {
  userIdentityId: string;
  soundEnabled?: boolean;
  browserNotificationEnabled?: boolean;
  muteAll?: boolean;
}) {
  await ensureNotificationSetting(input.userIdentityId);
  return prisma.notificationSetting.update({
    where: { userIdentityId: input.userIdentityId },
    data: {
      ...(input.soundEnabled === undefined
        ? {}
        : { soundEnabled: input.soundEnabled }),
      ...(input.browserNotificationEnabled === undefined
        ? {}
        : { browserNotificationEnabled: input.browserNotificationEnabled }),
      ...(input.muteAll === undefined ? {} : { muteAll: input.muteAll }),
    },
    select: {
      soundEnabled: true,
      browserNotificationEnabled: true,
      muteAll: true,
    },
  });
}

async function assertRoomMuteAccess(userIdentityId: string, roomId: string) {
  const identity = await prisma.userIdentity.findUnique({
    where: { id: userIdentityId },
    select: { applicationId: true, isActive: true },
  });
  if (!identity?.isActive) throw new Error("NOTIFICATION_USER_NOT_FOUND");

  const room = await prisma.room.findFirst({
    where: {
      id: roomId,
      applicationId: identity.applicationId,
      isActive: true,
    },
    select: {
      id: true,
      type: true,
      groupId: true,
      members: {
        where: { userIdentityId, isActive: true },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!room) throw new Error("NOTIFICATION_ROOM_NOT_FOUND");

  if (room.type === "PRIVATE") {
    if (room.members.length === 0)
      throw new Error("NOTIFICATION_ROOM_FORBIDDEN");
    return room;
  }

  if (!room.groupId) throw new Error("NOTIFICATION_ROOM_INVALID");
  const actor = await resolveGroupChatActor(userIdentityId);
  if (
    !actor ||
    !canViewGroupChat({
      permissions: actor.permissions,
      groupIds: actor.groupIds,
      groupId: room.groupId,
    })
  ) {
    throw new Error("NOTIFICATION_ROOM_FORBIDDEN");
  }
  return room;
}

export async function setRoomMute(input: {
  userIdentityId: string;
  roomId: string;
  mutedUntil: Date | null;
}) {
  await assertRoomMuteAccess(input.userIdentityId, input.roomId);
  return prisma.roomMute.upsert({
    where: {
      userIdentityId_roomId: {
        userIdentityId: input.userIdentityId,
        roomId: input.roomId,
      },
    },
    update: { mutedUntil: input.mutedUntil },
    create: {
      userIdentityId: input.userIdentityId,
      roomId: input.roomId,
      mutedUntil: input.mutedUntil,
    },
    select: { roomId: true, mutedUntil: true },
  });
}

export async function clearRoomMute(userIdentityId: string, roomId: string) {
  await assertRoomMuteAccess(userIdentityId, roomId);
  await prisma.roomMute.deleteMany({ where: { userIdentityId, roomId } });
  return { roomId, muted: false };
}

async function createRecipientNotification(input: {
  applicationId: string;
  recipientUserIdentityId: string;
  roomId: string;
  messageId: string;
  title: string;
  body: string;
  metadata: Prisma.InputJsonObject;
}): Promise<NotificationDispatchPayload> {
  const dedupeKey = `${input.recipientUserIdentityId}:${input.messageId}`;
  const notification = await prisma.notification.upsert({
    where: { dedupeKey },
    update: {
      title: input.title,
      body: input.body,
      roomId: input.roomId,
      metadata: input.metadata,
    },
    create: {
      applicationId: input.applicationId,
      recipientUserIdentityId: input.recipientUserIdentityId,
      type: "MESSAGE",
      title: input.title,
      body: input.body,
      roomId: input.roomId,
      messageId: input.messageId,
      dedupeKey,
      metadata: input.metadata,
    },
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      roomId: true,
      messageId: true,
      metadata: true,
      createdAt: true,
    },
  });

  const [totalUnread, roomUnread, preferences] = await Promise.all([
    prisma.notification.count({
      where: {
        recipientUserIdentityId: input.recipientUserIdentityId,
        readAt: null,
      },
    }),
    prisma.notification.count({
      where: {
        recipientUserIdentityId: input.recipientUserIdentityId,
        roomId: input.roomId,
        readAt: null,
      },
    }),
    getNotificationPreferences(input.recipientUserIdentityId, input.roomId),
  ]);

  return {
    recipientUserIdentityId: input.recipientUserIdentityId,
    notification: {
      id: notification.id,
      type: "MESSAGE",
      title: notification.title,
      body: notification.body,
      roomId: notification.roomId,
      messageId: notification.messageId,
      createdAt: notification.createdAt.toISOString(),
      metadata:
        (notification.metadata as Record<string, unknown> | null) ?? null,
    },
    totalUnread,
    roomUnread,
    shouldPlaySound: preferences.shouldPlaySound,
    shouldShowBrowserNotification: preferences.shouldShowBrowserNotification,
    muted: preferences.muteAll || preferences.roomMuted,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R | null>,
) {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    const resolved = await Promise.all(batch.map(worker));
    for (const item of resolved) if (item != null) results.push(item);
  }
  return results;
}

export async function createGroupMessageNotifications(input: {
  applicationId: string;
  groupId: string;
  roomId: string;
  messageId: string;
  senderUserIdentityId: string;
  senderUsername: string;
  senderName: string | null;
  content: string;
}) {
  const [group, candidates] = await Promise.all([
    prisma.group.findFirst({
      where: {
        id: input.groupId,
        applicationId: input.applicationId,
        isActive: true,
      },
      select: { id: true, name: true },
    }),
    prisma.userIdentity.findMany({
      where: {
        applicationId: input.applicationId,
        isActive: true,
        id: { not: input.senderUserIdentityId },
      },
      select: { id: true },
    }),
  ]);
  if (!group) return [];

  const eligible = await mapWithConcurrency(
    candidates,
    25,
    async (candidate: { id: string }) => {
      const actor = await resolveGroupChatActor(candidate.id);
      if (!actor) return null;
      return canViewGroupChat({
        permissions: actor.permissions,
        groupIds: actor.groupIds,
        groupId: input.groupId,
      })
        ? candidate.id
        : null;
    },
  );

  const senderLabel = input.senderName || input.senderUsername;
  const body = `${senderLabel}: ${buildNotificationPreview(input.content)}`;
  return mapWithConcurrency(eligible, 25, (recipientUserIdentityId: string) =>
    createRecipientNotification({
      applicationId: input.applicationId,
      recipientUserIdentityId,
      roomId: input.roomId,
      messageId: input.messageId,
      title: group.name,
      body,
      metadata: {
        chatType: "GROUP",
        groupId: input.groupId,
        senderUserIdentityId: input.senderUserIdentityId,
        senderUsername: input.senderUsername,
        senderName: input.senderName,
      },
    }),
  );
}

export async function createPrivateMessageNotifications(input: {
  applicationId: string;
  roomId: string;
  messageId: string;
  senderUserIdentityId: string;
  senderUsername: string;
  senderName: string | null;
  content: string;
}) {
  const recipient = await prisma.roomMember.findFirst({
    where: {
      roomId: input.roomId,
      userIdentityId: { not: input.senderUserIdentityId },
      isActive: true,
    },
    select: {
      userIdentityId: true,
      userIdentity: {
        select: {
          isActive: true,
          applicationId: true,
          userOverride: { select: { isAccessDisabled: true } },
        },
      },
    },
  });
  if (
    !recipient ||
    !recipient.userIdentity.isActive ||
    recipient.userIdentity.applicationId !== input.applicationId ||
    recipient.userIdentity.userOverride?.isAccessDisabled
  )
    return [];

  const notification = await createRecipientNotification({
    applicationId: input.applicationId,
    recipientUserIdentityId: recipient.userIdentityId,
    roomId: input.roomId,
    messageId: input.messageId,
    title: input.senderName || input.senderUsername,
    body: buildNotificationPreview(input.content),
    metadata: {
      chatType: "PRIVATE",
      senderUserIdentityId: input.senderUserIdentityId,
      senderUsername: input.senderUsername,
      senderName: input.senderName,
    },
  });
  return [notification];
}

export async function getNotificationSummary(userIdentityId: string) {
  const [totalUnread, unreadByRoomRows, latest] = await Promise.all([
    prisma.notification.count({
      where: { recipientUserIdentityId: userIdentityId, readAt: null },
    }),
    prisma.notification.groupBy({
      by: ["roomId"],
      where: {
        recipientUserIdentityId: userIdentityId,
        readAt: null,
        roomId: { not: null },
      },
      _count: { _all: true },
    }),
    prisma.notification.findMany({
      where: { recipientUserIdentityId: userIdentityId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        roomId: true,
        messageId: true,
        metadata: true,
        readAt: true,
        createdAt: true,
      },
    }),
  ]);

  const unreadByRoom: Record<string, number> = {};
  for (const row of unreadByRoomRows as Array<{
    roomId: string | null;
    _count: { _all: number };
  }>) {
    if (row.roomId) unreadByRoom[row.roomId] = row._count._all;
  }

  return {
    totalUnread,
    unreadByRoom,
    latest: latest.map(
      (item: {
        id: string;
        type: string;
        title: string;
        body: string | null;
        roomId: string | null;
        messageId: string | null;
        metadata: unknown;
        readAt: Date | null;
        createdAt: Date;
      }) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        body: item.body,
        roomId: item.roomId,
        messageId: item.messageId,
        metadata: item.metadata,
        readAt: item.readAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
      }),
    ),
  };
}

export async function markNotificationsReadForMessages(
  userIdentityId: string,
  messageIds: string[],
) {
  if (messageIds.length > 0) {
    await prisma.notification.updateMany({
      where: {
        recipientUserIdentityId: userIdentityId,
        messageId: { in: messageIds },
        readAt: null,
      },
      data: { readAt: new Date() },
    });
  }
  return prisma.notification.count({
    where: { recipientUserIdentityId: userIdentityId, readAt: null },
  });
}

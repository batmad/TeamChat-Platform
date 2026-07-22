import { prisma } from "@/lib/db/prisma";
import { resolveEffectiveUser } from "@/lib/users/effective-user";
import {
  canSendPrivateMessage,
  canStartPrivateConversation,
  canViewPrivateChat,
  getSharedGroupIds,
} from "@/lib/chat/private-rules";

export class PrivateChatAccessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 403,
  ) {
    super(message);
    this.name = "PrivateChatAccessError";
  }
}

export type PrivateChatActor = {
  userIdentityId: string;
  applicationId: string;
  username: string;
  displayName: string | null;
  permissions: string[];
  groupIds: string[];
};

export type PrivateChatParticipant = {
  userIdentityId: string;
  applicationId: string;
  username: string;
  displayName: string | null;
  groupIds: string[];
};

export async function resolvePrivateChatActor(
  userIdentityId: string,
): Promise<PrivateChatActor | null> {
  const effectiveUser = await resolveEffectiveUser(userIdentityId);
  if (!effectiveUser || effectiveUser.isAccessDisabled) return null;

  return {
    userIdentityId: effectiveUser.userIdentityId,
    applicationId: effectiveUser.applicationId,
    username: effectiveUser.username,
    displayName: effectiveUser.displayName,
    permissions: effectiveUser.permissions,
    groupIds: effectiveUser.groups.map((group) => group.id),
  };
}

export async function requirePrivateChatActor(
  userIdentityId: string,
): Promise<PrivateChatActor> {
  const actor = await resolvePrivateChatActor(userIdentityId);
  if (!actor) {
    throw new PrivateChatAccessError(
      "PRIVATE_CHAT_SESSION_REVOKED",
      "User session is no longer authorized for private chat",
      401,
    );
  }
  if (!canViewPrivateChat(actor.permissions)) {
    throw new PrivateChatAccessError(
      "PRIVATE_CHAT_VIEW_FORBIDDEN",
      "Private chat access is not allowed",
    );
  }
  return actor;
}

export async function resolvePrivateParticipant(
  actor: PrivateChatActor,
  targetUserIdentityId: string,
): Promise<PrivateChatParticipant> {
  if (!targetUserIdentityId || targetUserIdentityId === actor.userIdentityId) {
    throw new PrivateChatAccessError(
      "PRIVATE_CHAT_TARGET_INVALID",
      "Private chat target is invalid",
      400,
    );
  }

  const effectiveUser = await resolveEffectiveUser(targetUserIdentityId);
  if (
    !effectiveUser ||
    effectiveUser.isAccessDisabled ||
    effectiveUser.applicationId !== actor.applicationId ||
    !canViewPrivateChat(effectiveUser.permissions)
  ) {
    throw new PrivateChatAccessError(
      "PRIVATE_CHAT_TARGET_UNAVAILABLE",
      "Private chat target is unavailable",
      404,
    );
  }

  return {
    userIdentityId: effectiveUser.userIdentityId,
    applicationId: effectiveUser.applicationId,
    username: effectiveUser.username,
    displayName: effectiveUser.displayName,
    groupIds: effectiveUser.groups.map((group) => group.id),
  };
}

export function getPrivateAccessState(
  actor: PrivateChatActor,
  target: PrivateChatParticipant,
) {
  const sharedGroupIds = getSharedGroupIds(actor.groupIds, target.groupIds);

  return {
    sharedGroupIds,
    hasSharedGroup: sharedGroupIds.length > 0,

    // Digunakan untuk memulai private conversation baru
    canStart: canStartPrivateConversation({
      permissions: actor.permissions,
      actorGroupIds: actor.groupIds,
      targetGroupIds: target.groupIds,
    }),
  };
}

export async function requirePrivateRoomParticipant(
  actor: PrivateChatActor,
  roomId: string,
) {
  const room = await prisma.room.findFirst({
    where: {
      id: roomId,
      applicationId: actor.applicationId,
      type: "PRIVATE",
      isActive: true,
      members: {
        some: {
          userIdentityId: actor.userIdentityId,
          isActive: true,
        },
      },
    },
    select: {
      id: true,
      applicationId: true,
      privateKey: true,
      createdAt: true,
      members: {
        where: { isActive: true },
        select: {
          userIdentityId: true,
          usernameSnapshot: true,
          displayNameSnapshot: true,
        },
      },
    },
  });

  if (!room) {
    throw new PrivateChatAccessError(
      "PRIVATE_CONVERSATION_NOT_FOUND",
      "Private conversation is unavailable",
      404,
    );
  }

  const other = room.members.find(
    (member: { userIdentityId: string }) =>
      member.userIdentityId !== actor.userIdentityId,
  );

  if (!other) {
    throw new PrivateChatAccessError(
      "PRIVATE_CONVERSATION_INVALID",
      "Private conversation participant is unavailable",
      409,
    );
  }

  /*
   * Query room di atas sudah memastikan actor merupakan
   * anggota aktif pada private room ini.
   */
  const canSend = canSendPrivateMessage({
    permissions: actor.permissions,
    isRoomMember: true,
  });

  return {
    room,
    other,
    canSend,
  };
}

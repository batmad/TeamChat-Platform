import { prisma } from "@/lib/db/prisma";
import { resolveEffectivePermissions } from "@/lib/rbac/effective-permissions";
import { canSendGroupChat, canViewGroupChat } from "@/lib/chat/group-rules";

export class GroupChatAccessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 403,
  ) {
    super(message);
    this.name = "GroupChatAccessError";
  }
}

export type GroupChatActor = {
  userIdentityId: string;
  applicationId: string;
  username: string;
  displayName: string | null;
  permissions: string[];
  groupIds: string[];
};

export async function resolveGroupChatActor(
  userIdentityId: string,
): Promise<GroupChatActor | null> {
  const identity = await prisma.userIdentity.findUnique({
    where: { id: userIdentityId },
    select: {
      id: true,
      applicationId: true,
      username: true,
      displayNameSnapshot: true,
      isActive: true,
      application: { select: { status: true } },
      userOverride: {
        select: {
          isAccessDisabled: true,
          roleOverride: {
            select: {
              id: true,
              applicationId: true,
              isActive: true,
              permissions: {
                select: {
                  permission: { select: { code: true, isActive: true } },
                },
              },
            },
          },
        },
      },
      presence: {
        select: {
          effectiveRole: {
            select: {
              id: true,
              applicationId: true,
              isActive: true,
              permissions: {
                select: {
                  permission: { select: { code: true, isActive: true } },
                },
              },
            },
          },
        },
      },
      permissionOverrides: {
        select: {
          effect: true,
          permission: { select: { code: true, isActive: true } },
        },
      },
      groupMemberships: {
        where: { group: { isActive: true } },
        select: { groupId: true },
      },
    },
  });

  if (
    !identity ||
    !identity.isActive ||
    identity.application.status !== "ACTIVE" ||
    identity.userOverride?.isAccessDisabled
  ) {
    return null;
  }

  const overrideRole = identity.userOverride?.roleOverride;
  const cachedRole = identity.presence?.effectiveRole;
  const role =
    overrideRole?.isActive &&
    overrideRole.applicationId === identity.applicationId
      ? overrideRole
      : cachedRole?.isActive &&
          cachedRole.applicationId === identity.applicationId
        ? cachedRole
        : null;

  const rolePermissions =
    role?.permissions
      .filter(
        ({ permission }: { permission: { code: string; isActive: boolean } }) =>
          permission.isActive,
      )
      .map(
        ({ permission }: { permission: { code: string; isActive: boolean } }) =>
          permission.code,
      ) ?? [];

  const overrides = identity.permissionOverrides
    .filter(
      ({ permission }: { permission: { code: string; isActive: boolean } }) =>
        permission.isActive,
    )
    .map(
      ({
        permission,
        effect,
      }: {
        permission: { code: string; isActive: boolean };
        effect: string;
      }) => ({
        code: permission.code,
        effect: effect as "ALLOW" | "DENY",
      }),
    );

  return {
    userIdentityId: identity.id,
    applicationId: identity.applicationId,
    username: identity.username,
    displayName: identity.displayNameSnapshot,
    permissions: resolveEffectivePermissions(rolePermissions, overrides),
    groupIds: identity.groupMemberships.map(
      ({ groupId }: { groupId: string }) => groupId,
    ),
  };
}

export function actorHasPermission(actor: GroupChatActor, permission: string) {
  return actor.permissions.includes(permission);
}

export async function requireGroupChatActor(
  userIdentityId: string,
): Promise<GroupChatActor> {
  const actor = await resolveGroupChatActor(userIdentityId);
  if (!actor) {
    throw new GroupChatAccessError(
      "GROUP_CHAT_SESSION_REVOKED",
      "User session is no longer authorized for group chat",
      401,
    );
  }
  return actor;
}

export async function requireGroupAccess(
  actor: GroupChatActor,
  groupId: string,
  options: { requireSend?: boolean } = {},
) {
  const group = await prisma.group.findFirst({
    where: {
      id: groupId,
      applicationId: actor.applicationId,
      isActive: true,
    },
    select: {
      id: true,
      applicationId: true,
      code: true,
      name: true,
      source: true,
      isActive: true,
    },
  });
  if (!group) {
    throw new GroupChatAccessError(
      "GROUP_NOT_FOUND",
      "Group is unavailable",
      404,
    );
  }

  if (
    !canViewGroupChat({
      permissions: actor.permissions,
      groupIds: actor.groupIds,
      groupId: group.id,
    })
  ) {
    const code = actorHasPermission(actor, "chat.group.view")
      ? "GROUP_CHAT_SCOPE_FORBIDDEN"
      : "GROUP_CHAT_VIEW_FORBIDDEN";
    throw new GroupChatAccessError(
      code,
      "User does not have access to this group",
    );
  }
  if (options.requireSend && !canSendGroupChat(actor.permissions)) {
    throw new GroupChatAccessError(
      "GROUP_CHAT_SEND_FORBIDDEN",
      "Sending group chat messages is not allowed",
    );
  }

  return group;
}

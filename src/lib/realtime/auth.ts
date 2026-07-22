import type { Socket } from "socket.io";
import { prisma } from "@/lib/db/prisma";
import { resolveEffectivePermissions } from "@/lib/rbac/effective-permissions";
import type { RealtimeSocketData } from "@/lib/realtime/events";
import { verifyChatSessionToken } from "@/lib/widget-auth/chat-session";

type HandshakeSocket = Pick<Socket, "handshake">;

function extractToken(socket: HandshakeSocket): string | null {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === "string" && authToken.trim())
    return authToken.trim();

  const authorization = socket.handshake.headers.authorization;
  if (typeof authorization !== "string") return null;
  const [scheme, token] = authorization.split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

function normalizeOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

export async function authenticateRealtimeSocket(
  socket: HandshakeSocket,
): Promise<RealtimeSocketData> {
  const token = extractToken(socket);
  if (!token) throw new Error("REALTIME_SESSION_REQUIRED");

  const payload = await verifyChatSessionToken(token);
  if (!payload) throw new Error("REALTIME_SESSION_INVALID");

  const identity = await prisma.userIdentity.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      applicationId: true,
      username: true,
      displayNameSnapshot: true,
      isActive: true,
      application: {
        select: {
          key: true,
          status: true,
          allowedOrigins: true,
        },
      },
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
    identity.userOverride?.isAccessDisabled ||
    identity.application.status !== "ACTIVE" ||
    identity.applicationId !== payload.applicationId ||
    identity.application.key !== payload.applicationKey ||
    identity.username !== payload.username
  ) {
    throw new Error("REALTIME_SESSION_REVOKED");
  }

  if (identity.application.allowedOrigins.length > 0) {
    const origin = normalizeOrigin(socket.handshake.headers.origin);
    if (!origin || !identity.application.allowedOrigins.includes(origin)) {
      throw new Error("REALTIME_ORIGIN_DENIED");
    }
  }

  const roleOverride = identity.userOverride?.roleOverride;
  const cachedRole = identity.presence?.effectiveRole;
  const role =
    roleOverride?.isActive &&
    roleOverride.applicationId === identity.applicationId
      ? roleOverride
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
    applicationKey: identity.application.key,
    username: identity.username,
    displayName: identity.displayNameSnapshot,
    effectiveRoleId: role?.id ?? null,
    permissions: resolveEffectivePermissions(rolePermissions, overrides),
    groupIds: identity.groupMemberships.map(
      (membership: { groupId: string }) => membership.groupId,
    ),
    sessionReference: payload.sessionReference,
    lastHeartbeatWriteAt: 0,
  };
}

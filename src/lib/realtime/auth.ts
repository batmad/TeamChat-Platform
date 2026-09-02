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

function normalizeOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;

  try {
    return new URL(origin.trim()).origin;
  } catch {
    return null;
  }
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0]?.trim() || null;
  }

  return value?.split(",")[0]?.trim() || null;
}

function getRealtimeRequestOrigin(socket: HandshakeSocket): string | null {
  const rawOrigin = firstHeaderValue(socket.handshake.headers.origin);
  const origin = normalizeOrigin(rawOrigin);

  if (origin) {
    return origin;
  }

  const forwardedProto = firstHeaderValue(
    socket.handshake.headers["x-forwarded-proto"],
  );

  const forwardedHost = firstHeaderValue(
    socket.handshake.headers["x-forwarded-host"],
  );

  if (forwardedProto && forwardedHost) {
    return normalizeOrigin(`${forwardedProto}://${forwardedHost}`);
  }

  const host = firstHeaderValue(socket.handshake.headers.host);

  if (forwardedProto && host) {
    return normalizeOrigin(`${forwardedProto}://${host}`);
  }

  return null;
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
    const requestOrigin = getRealtimeRequestOrigin(socket);

    const allowedOrigins = identity.application.allowedOrigins
      .map(normalizeOrigin)
      .filter((origin): origin is string => origin !== null);

    console.log("REALTIME ORIGIN CHECK", {
      rawOrigin: socket.handshake.headers.origin,
      resolvedOrigin: requestOrigin,
      allowedOrigins,
      host: socket.handshake.headers.host,
      forwardedHost: socket.handshake.headers["x-forwarded-host"],
      forwardedProto: socket.handshake.headers["x-forwarded-proto"],
    });

    if (!requestOrigin || !allowedOrigins.includes(requestOrigin)) {
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

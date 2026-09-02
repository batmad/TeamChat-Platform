import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger/logger";
import { cleanupCutoff, normalizeCleanupHours } from "@/lib/presence/rules";

type PresenceConnectInput = {
  userIdentityId: string;
  effectiveRoleId: string | null;
  sessionReference: string;
  metadata: Prisma.InputJsonObject;
};

export async function markPresenceConnected(input: PresenceConnectInput) {
  const now = new Date();
  return prisma.userPresence.upsert({
    where: { userIdentityId: input.userIdentityId },
    create: {
      userIdentityId: input.userIdentityId,
      effectiveRoleId: input.effectiveRoleId,
      status: "ONLINE",
      connectionCount: 1,
      loginAt: now,
      lastSeenAt: now,
      logoutAt: null,
      offlineAt: null,
      sessionReference: input.sessionReference,
      metadata: input.metadata,
    },
    update: {
      effectiveRoleId: input.effectiveRoleId,
      status: "ONLINE",
      connectionCount: { increment: 1 },
      loginAt: now,
      lastSeenAt: now,
      logoutAt: null,
      offlineAt: null,
      sessionReference: input.sessionReference,
      metadata: input.metadata,
    },
  });
}

export async function decrementPresenceConnection(userIdentityId: string) {
  await prisma.userPresence.updateMany({
    where: { userIdentityId, connectionCount: { gt: 0 } },
    data: {
      connectionCount: { decrement: 1 },
      lastSeenAt: new Date(),
    },
  });

  return prisma.userPresence.findUnique({ where: { userIdentityId } });
}

export async function markPresenceOfflineIfDisconnected(
  userIdentityId: string,
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.userPresence.findUnique({
      where: { userIdentityId },
      select: { id: true, connectionCount: true, status: true },
    });
    if (!current || current.connectionCount > 0) return null;

    const now = new Date();
    return tx.userPresence.update({
      where: { id: current.id },
      data: {
        connectionCount: 0,
        status: "OFFLINE",
        offlineAt: now,
        lastSeenAt: now,
      },
    });
  });
}

export async function touchPresence(userIdentityId: string) {
  return prisma.userPresence.updateMany({
    where: { userIdentityId, status: "ONLINE" },
    data: { lastSeenAt: new Date() },
  });
}

export async function resetOnlinePresenceOnRealtimeStartup() {
  const now = new Date();
  const result = await prisma.userPresence.updateMany({
    where: {
      OR: [{ status: "ONLINE" }, { connectionCount: { gt: 0 } }],
    },
    data: {
      status: "OFFLINE",
      connectionCount: 0,
      offlineAt: now,
      lastSeenAt: now,
    },
  });

  if (result.count > 0) {
    logger.warn(
      { count: result.count },
      "Reset stale online presence after realtime server startup",
    );
  }
  return result.count;
}

export async function getPresenceCleanupHours() {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: "presence.cleanup_offline_after_hours" },
    select: { value: true },
  });
  return normalizeCleanupHours(setting?.value);
}

export async function cleanupExpiredOfflinePresence(now = new Date()) {
  const cleanupHours = await getPresenceCleanupHours();
  const cutoff = cleanupCutoff(now, cleanupHours);
  const result = await prisma.userPresence.deleteMany({
    where: {
      status: "OFFLINE",
      connectionCount: 0,
      offlineAt: { lt: cutoff },
    },
  });

  if (result.count > 0) {
    logger.info(
      { count: result.count, cleanupHours, cutoff },
      "Expired offline presence records removed",
    );
  }

  return { count: result.count, cleanupHours, cutoff };
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { AppError } from "@/lib/api/app-error";
import { prisma } from "@/lib/db/prisma";
import { requireApiSession, sessionHasPermission } from "@/lib/rbac/guards";
import {
  ensureLogModuleAccess,
  getAllowedSystemLogTypes,
  type LogCategory,
} from "@/lib/logs/access";


type AuditRow = {
  id: string; applicationId: string | null; actorUsername: string; action: string; entityType: string; entityId: string | null; beforeData: unknown; afterData: unknown; metadata: unknown; createdAt: Date;
};
type ViolationRow = {
  id: string; applicationId: string; username: string; userName: string | null; roomId: string | null; roomType: string | null; matchedText: string; attemptedMessage: string; status: string; metadata: unknown; attemptedAt: Date; group: { id: string; code: string; name: string } | null; room: { id: string; type: string } | null;
};
type SystemRow = {
  id: string; applicationId: string | null; type: string; level: string; requestId: string | null; username: string | null; action: string | null; message: string; metadata: unknown; createdAt: Date;
};

const querySchema = z.object({
  source: z.enum(["SYSTEM", "AUDIT", "VIOLATION"]).default("SYSTEM"),
  applicationId: z.string().uuid().optional(),
  category: z.enum(["integration", "authentication", "error", "activity"]).optional(),
  level: z.enum(["DEBUG", "INFO", "WARN", "ERROR", "FATAL"]).optional(),
  username: z.string().trim().max(100).optional(),
  action: z.string().trim().max(200).optional(),
  requestId: z.string().trim().max(200).optional(),
  query: z.string().trim().max(500).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function parseQuery(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  return querySchema.parse(params);
}

function resolveApplicationScope(
  session: Awaited<ReturnType<typeof requireApiSession>>,
  requestedApplicationId?: string,
) {
  if (session.isRoot) return requestedApplicationId;
  if (!session.applicationId) {
    throw new AppError(403, "APPLICATION_SCOPE_DENIED", "No application context is active");
  }
  if (requestedApplicationId && requestedApplicationId !== session.applicationId) {
    throw new AppError(403, "APPLICATION_SCOPE_DENIED", "Application access is not allowed");
  }
  return session.applicationId;
}

export const GET = withApiHandler(async (request) => {
  const session = await requireApiSession();
  ensureLogModuleAccess(session);
  const input = parseQuery(request);
  const applicationId = resolveApplicationScope(session, input.applicationId);
  const limit = input.limit;

  if (input.source === "AUDIT") {
    if (!sessionHasPermission(session, "logs.audit.view")) {
      throw new AppError(403, "FORBIDDEN", "Audit log access is not allowed");
    }
    const rows = await prisma.auditLog.findMany({
      where: {
        ...(applicationId ? { applicationId } : {}),
        ...(input.username ? { actorUsername: { contains: input.username, mode: "insensitive" } } : {}),
        ...(input.action ? { action: { contains: input.action, mode: "insensitive" } } : {}),
        ...(input.query
          ? {
              OR: [
                { actorUsername: { contains: input.query, mode: "insensitive" } },
                { action: { contains: input.query, mode: "insensitive" } },
                { entityType: { contains: input.query, mode: "insensitive" } },
                { entityId: { contains: input.query, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(input.from || input.to
          ? { createdAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } }
          : {}),
      },
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    }) as AuditRow[];
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit).map((row) => ({
      id: row.id,
      source: "AUDIT",
      applicationId: row.applicationId,
      timestamp: row.createdAt.toISOString(),
      level: "INFO",
      username: row.actorUsername,
      action: row.action,
      message: `${row.action} ${row.entityType}${row.entityId ? ` (${row.entityId})` : ""}`,
      requestId: null,
      metadata: {
        entityType: row.entityType,
        entityId: row.entityId,
        beforeData: row.beforeData,
        afterData: row.afterData,
        metadata: row.metadata,
      },
    }));
    return NextResponse.json({
      success: true,
      data: { entries: data, nextCursor: hasMore ? rows[limit - 1]?.id ?? null : null },
    });
  }

  if (input.source === "VIOLATION") {
    if (!sessionHasPermission(session, "logs.violation.view")) {
      throw new AppError(403, "FORBIDDEN", "Content violation log access is not allowed");
    }
    const rows = await prisma.contentViolationLog.findMany({
      where: {
        ...(applicationId ? { applicationId } : {}),
        ...(input.username ? { username: { contains: input.username, mode: "insensitive" } } : {}),
        ...(input.query
          ? {
              OR: [
                { username: { contains: input.query, mode: "insensitive" } },
                { userName: { contains: input.query, mode: "insensitive" } },
                { matchedText: { contains: input.query, mode: "insensitive" } },
                { attemptedMessage: { contains: input.query, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(input.from || input.to
          ? { attemptedAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } }
          : {}),
      },
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      orderBy: [{ attemptedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: {
        group: { select: { id: true, code: true, name: true } },
        room: { select: { id: true, type: true } },
      },
    }) as ViolationRow[];
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit).map((row) => ({
      id: row.id,
      source: "VIOLATION",
      applicationId: row.applicationId,
      timestamp: row.attemptedAt.toISOString(),
      level: "WARN",
      username: row.username,
      action: "FORBIDDEN_CONTENT_BLOCKED",
      message: `Blocked forbidden content matching "${row.matchedText}"`,
      requestId: null,
      metadata: {
        userName: row.userName,
        roomId: row.roomId,
        roomType: row.roomType,
        group: row.group,
        matchedText: row.matchedText,
        attemptedMessage: row.attemptedMessage,
        status: row.status,
        metadata: row.metadata,
      },
    }));
    return NextResponse.json({
      success: true,
      data: { entries: data, nextCursor: hasMore ? rows[limit - 1]?.id ?? null : null },
    });
  }

  const types = getAllowedSystemLogTypes(session, (input.category as LogCategory | undefined) ?? null);
  if (!types.length) {
    throw new AppError(403, "FORBIDDEN", "No system log category is available for this user");
  }

  const rows = await prisma.systemLog.findMany({
    where: {
      ...(applicationId ? { applicationId } : {}),
      type: { in: types as never[] },
      ...(input.level ? { level: input.level } : {}),
      ...(input.username ? { username: { contains: input.username, mode: "insensitive" } } : {}),
      ...(input.action ? { action: { contains: input.action, mode: "insensitive" } } : {}),
      ...(input.requestId ? { requestId: { contains: input.requestId, mode: "insensitive" } } : {}),
      ...(input.query
        ? {
            OR: [
              { message: { contains: input.query, mode: "insensitive" } },
              { action: { contains: input.query, mode: "insensitive" } },
              { username: { contains: input.query, mode: "insensitive" } },
              { requestId: { contains: input.query, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(input.from || input.to
        ? { createdAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } }
        : {}),
    },
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  }) as SystemRow[];
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit).map((row) => ({
    id: row.id,
    source: "SYSTEM",
    applicationId: row.applicationId,
    timestamp: row.createdAt.toISOString(),
    type: row.type,
    level: row.level,
    username: row.username,
    action: row.action,
    message: row.message,
    requestId: row.requestId,
    metadata: row.metadata,
  }));
  return NextResponse.json({
    success: true,
    data: { entries: data, nextCursor: hasMore ? rows[limit - 1]?.id ?? null : null },
  });
});

import "server-only";
import { prisma } from "@/lib/db/prisma";
import type { CurrentSession } from "@/lib/auth/dal";
import { sanitizeLogData } from "@/lib/logs/sanitize";

type AuditInput = {
  session: CurrentSession;
  action: string;
  entityType: string;
  entityId?: string | null;
  applicationId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  metadata?: unknown;
};

export async function writeAuditLog(input: AuditInput) {
  await prisma.auditLog.create({
    data: {
      applicationId: input.applicationId ?? input.session.applicationId ?? null,
      actorInternalUserId: input.session.userId,
      actorUsername: input.session.username,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      beforeData: input.beforeData === undefined ? undefined : sanitizeLogData(input.beforeData) as never,
      afterData: input.afterData === undefined ? undefined : sanitizeLogData(input.afterData) as never,
      metadata: input.metadata === undefined ? undefined : sanitizeLogData(input.metadata) as never,
    },
  });
}

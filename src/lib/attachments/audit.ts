import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

export type AttachmentAuditInput = {
  applicationId?: string | null;
  actorUsername?: string | null;
  action: string;
  attachmentId?: string | null;
  message?: string;
  level?: "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";
  metadata?: Record<string, unknown>;
};

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error)
    return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        jsonSafe(v),
      ]),
    );
  }
  return value;
}

export async function writeAttachmentAuditSafe(input: AttachmentAuditInput) {
  const actorUsername = input.actorUsername?.trim() || "SYSTEM";
  const metadata = jsonSafe(input.metadata ?? {}) as Record<string, unknown>;

  await Promise.allSettled([
    prisma.systemLog.create({
      data: {
        applicationId: input.applicationId ?? null,
        type:
          input.level === "ERROR" || input.level === "FATAL"
            ? "ERROR"
            : "CHAT_ACTIVITY",
        level: input.level ?? "INFO",
        username: actorUsername,
        action: input.action,
        message: input.message ?? input.action,
        metadata: metadata as Prisma.InputJsonValue,
      },
    }),
    prisma.auditLog.create({
      data: {
        applicationId: input.applicationId ?? null,
        actorUsername,
        action: input.action,
        entityType: "MESSAGE_ATTACHMENT",
        entityId: input.attachmentId ?? null,
        metadata: metadata as Prisma.InputJsonValue,
      },
    }),
  ]);
}

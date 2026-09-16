import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger/logger";
import { sanitizeLogData } from "@/lib/logs/sanitize";

export type SystemLogType =
  | "INTEGRATION"
  | "API"
  | "AUTHENTICATION"
  | "ERROR"
  | "SYSTEM"
  | "USER_ACTIVITY"
  | "CHAT_ACTIVITY"
  | "CONTENT_VIOLATION"
  | "REPORT";

export type SystemLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

export type SystemLogInput = {
  applicationId?: string | null;
  type: SystemLogType;
  level: SystemLogLevel;
  requestId?: string | null;
  username?: string | null;
  action?: string | null;
  message: string;
  metadata?: unknown;
};

export async function writeSystemLog(input: SystemLogInput) {
  return prisma.systemLog.create({
    data: {
      applicationId: input.applicationId ?? null,
      type: input.type,
      level: input.level,
      requestId: input.requestId ?? null,
      username: input.username ?? null,
      action: input.action ?? null,
      message: input.message,
      metadata: input.metadata === undefined ? undefined : sanitizeLogData(input.metadata) as never,
    },
  });
}

export async function writeSystemLogSafe(input: SystemLogInput) {
  try {
    await writeSystemLog(input);
  } catch (error) {
    logger.error(
      {
        err: error,
        logType: input.type,
        logAction: input.action,
        requestId: input.requestId,
      },
      "Failed to persist centralized system log",
    );
  }
}

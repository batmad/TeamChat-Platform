import "server-only";
import { writeSystemLog } from "@/lib/logs/system-log";

export async function writeAuthenticationLog(input: {
  applicationId?: string | null;
  requestId?: string | null;
  username?: string | null;
  level: "INFO" | "WARN" | "ERROR";
  action: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  await writeSystemLog({
    applicationId: input.applicationId ?? null,
    type: "AUTHENTICATION",
    level: input.level,
    requestId: input.requestId ?? null,
    username: input.username ?? null,
    action: input.action,
    message: input.message,
    metadata: input.metadata,
  });
}

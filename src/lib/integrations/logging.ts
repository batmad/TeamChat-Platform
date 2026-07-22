import "server-only";
import { writeSystemLog } from "@/lib/logs/system-log";

type IntegrationLogInput = {
  applicationId: string;
  requestId?: string | null;
  integrationType: "DATABASE" | "API";
  level: "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";
  action: string;
  message: string;
  username?: string | null;
  metadata?: Record<string, unknown>;
};

export async function writeIntegrationLog(input: IntegrationLogInput) {
  await writeSystemLog({
    applicationId: input.applicationId,
    type: input.integrationType === "API" ? "API" : "INTEGRATION",
    level: input.level,
    requestId: input.requestId ?? null,
    username: input.username ?? null,
    action: input.action,
    message: input.message,
    metadata: input.metadata,
  });
}

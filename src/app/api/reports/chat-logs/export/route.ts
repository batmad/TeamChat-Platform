import { z } from "zod";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { writeSystemLogSafe } from "@/lib/logs/system-log";
import { requireApiPermission } from "@/lib/rbac/guards";
import { collectChatLogsReport } from "@/lib/reports/chat-logs";
import { createChatLogsCsv, createChatLogsXlsx } from "@/lib/reports/export";
import { resolveChatLogsScope } from "@/lib/reports/chat-logs-scope";

const schema = z.object({
  applicationId: z.string().uuid(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  groupId: z.string().uuid().optional(),
  username: z.string().trim().max(150).optional(),
  chatType: z.enum(["ALL", "PRIVATE", "GROUP"]).default("ALL"),
  format: z.enum(["csv", "xlsx"]),
});

export const GET = withApiHandler(async (request) => {
  const input = schema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (input.from && input.to && input.from > input.to) {
    throw new AppError(400, "REPORT_DATE_RANGE_INVALID", "Report start date cannot be after end date");
  }
  const session = await requireApiPermission("reports.chat_logs.export", input.applicationId);
  const scope = await resolveChatLogsScope(session, input.applicationId);
  const rows = await collectChatLogsReport({
    filters: {
      applicationId: input.applicationId,
      from: input.from,
      to: input.to,
      groupId: input.groupId,
      username: input.username,
      chatType: input.chatType,
    },
    scope,
  });

  const metadata = {
    format: input.format,
    rowCount: rows.length,
    filters: {
      from: input.from?.toISOString() ?? null,
      to: input.to?.toISOString() ?? null,
      groupId: input.groupId ?? null,
      username: input.username ?? null,
      chatType: input.chatType,
    },
    scopeType: scope.scopeType,
    scopeSource: scope.source,
  };
  await Promise.all([
    writeAuditLog({
      session,
      applicationId: input.applicationId,
      action: "CHAT_LOG_REPORT_EXPORTED",
      entityType: "ReportDefinition",
      entityId: scope.reportId,
      metadata,
    }),
    writeSystemLogSafe({
      applicationId: input.applicationId,
      type: "REPORT",
      level: "INFO",
      username: session.username,
      action: "CHAT_LOG_REPORT_EXPORTED",
      message: `Chat Logs Report exported as ${input.format.toUpperCase()}`,
      metadata,
    }),
  ]);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (input.format === "csv") {
    const csv = createChatLogsCsv(rows);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="chat-logs-${stamp}.csv"`,
      },
    });
  }

  const xlsx = await createChatLogsXlsx(rows);
  return new Response(new Uint8Array(xlsx), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="chat-logs-${stamp}.xlsx"`,
    },
  });
});

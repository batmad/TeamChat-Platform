import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { writeSystemLogSafe } from "@/lib/logs/system-log";
import { requireApiPermission } from "@/lib/rbac/guards";
import { queryChatLogsReport } from "@/lib/reports/chat-logs";
import { resolveChatLogsScope } from "@/lib/reports/chat-logs-scope";

const schema = z.object({
  applicationId: z.string().uuid(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  groupId: z.string().uuid().optional(),
  username: z.string().trim().max(150).optional(),
  chatType: z.enum(["ALL", "PRIVATE", "GROUP"]).default("ALL"),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = withApiHandler(async (request) => {
  const input = schema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (input.from && input.to && input.from > input.to) {
    throw new AppError(400, "REPORT_DATE_RANGE_INVALID", "Report start date cannot be after end date");
  }
  const session = await requireApiPermission("reports.chat_logs.view", input.applicationId);
  const scope = await resolveChatLogsScope(session, input.applicationId);
  const result = await queryChatLogsReport({
    filters: {
      applicationId: input.applicationId,
      from: input.from,
      to: input.to,
      groupId: input.groupId,
      username: input.username,
      chatType: input.chatType,
    },
    scope,
    cursor: input.cursor,
    limit: input.limit,
  });

  if (!input.cursor) {
    const metadata = {
      filters: {
        from: input.from?.toISOString() ?? null,
        to: input.to?.toISOString() ?? null,
        groupId: input.groupId ?? null,
        username: input.username ?? null,
        chatType: input.chatType,
      },
      scopeType: scope.scopeType,
      scopeSource: scope.source,
      allowedGroupIds: scope.allowedGroups.map((group) => group.id),
      total: result.total,
    };
    await Promise.all([
      writeAuditLog({
        session,
        applicationId: input.applicationId,
        action: "CHAT_LOG_REPORT_GENERATED",
        entityType: "ReportDefinition",
        entityId: scope.reportId,
        metadata,
      }),
      writeSystemLogSafe({
        applicationId: input.applicationId,
        type: "REPORT",
        level: "INFO",
        username: session.username,
        action: "CHAT_LOG_REPORT_GENERATED",
        message: "Chat Logs Report generated",
        metadata,
      }),
    ]);
  }

  return NextResponse.json({
    success: true,
    data: {
      ...result,
      scope: {
        type: scope.scopeType,
        source: scope.source,
        unrestricted: scope.unrestricted,
        groups: scope.allowedGroups,
      },
    },
  });
});

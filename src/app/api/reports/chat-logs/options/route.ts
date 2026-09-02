import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { requireApiPermission } from "@/lib/rbac/guards";
import { resolveChatLogsScope } from "@/lib/reports/chat-logs-scope";

const schema = z.object({ applicationId: z.string().uuid() });

export const GET = withApiHandler(async (request) => {
  const input = schema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  const session = await requireApiPermission("reports.chat_logs.view", input.applicationId);
  const scope = await resolveChatLogsScope(session, input.applicationId);
  return NextResponse.json({
    success: true,
    data: {
      scope: {
        type: scope.scopeType,
        source: scope.source,
        unrestricted: scope.unrestricted,
        groups: scope.allowedGroups,
      },
    },
  });
});

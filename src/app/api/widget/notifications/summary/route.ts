import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { getNotificationSummary } from "@/lib/notifications/service";
import { requireChatSession } from "@/lib/widget-auth/current-chat-user";
import { applyWidgetCors, widgetPreflightResponse } from "@/lib/widget-auth/cors";

export const OPTIONS = async (request: Request) => widgetPreflightResponse(request, "GET, OPTIONS");

const handledGet = withApiHandler(async (request) => {
  const current = await requireChatSession(request);
  const summary = await getNotificationSummary(current.authorization.userIdentityId);
  return NextResponse.json({ success: true, data: summary });
});

export const GET = async (request: Request) =>
  applyWidgetCors(await handledGet(request), request.headers.get("origin"));

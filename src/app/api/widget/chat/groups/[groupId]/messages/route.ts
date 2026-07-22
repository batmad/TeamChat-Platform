import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { getGroupMessageHistory } from "@/lib/chat/group-chat";
import { toChatAppError } from "@/lib/chat/http";
import { requireChatSession } from "@/lib/widget-auth/current-chat-user";
import { applyWidgetCors, widgetPreflightResponse } from "@/lib/widget-auth/cors";

type Context = { params: Promise<{ groupId: string }> };

const querySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const OPTIONS = async (request: Request) => widgetPreflightResponse(request, "GET, OPTIONS");

const handledGet = withApiHandler(async (request, context: Context) => {
  const current = await requireChatSession(request);
  const { groupId } = await context.params;
  const url = new URL(request.url);
  const query = querySchema.parse({
    cursor: url.searchParams.get("cursor") || undefined,
    limit: url.searchParams.get("limit") || undefined,
  });

  try {
    const data = await getGroupMessageHistory({
      userIdentityId: current.authorization.userIdentityId,
      groupId,
      cursor: query.cursor,
      limit: query.limit,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return toChatAppError(error);
  }
});

export const GET = async (request: Request, context: Context) =>
  applyWidgetCors(await handledGet(request, context), request.headers.get("origin"));

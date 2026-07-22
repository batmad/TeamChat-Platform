import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { markGroupMessagesRead } from "@/lib/chat/group-chat";
import { toChatAppError } from "@/lib/chat/http";
import { requireChatSession } from "@/lib/widget-auth/current-chat-user";
import { applyWidgetCors, widgetPreflightResponse } from "@/lib/widget-auth/cors";

type Context = { params: Promise<{ groupId: string }> };

const bodySchema = z.object({
  upToMessageId: z.string().uuid().nullable().optional(),
});

export const OPTIONS = async (request: Request) => widgetPreflightResponse(request, "POST, OPTIONS");

const handledPost = withApiHandler(async (request, context: Context) => {
  const current = await requireChatSession(request);
  const { groupId } = await context.params;
  const body = bodySchema.parse(await request.json().catch(() => ({})));

  try {
    const data = await markGroupMessagesRead({
      userIdentityId: current.authorization.userIdentityId,
      groupId,
      upToMessageId: body.upToMessageId,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return toChatAppError(error);
  }
});

export const POST = async (request: Request, context: Context) =>
  applyWidgetCors(await handledPost(request, context), request.headers.get("origin"));

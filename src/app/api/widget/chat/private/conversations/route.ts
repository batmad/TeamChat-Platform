import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { toChatAppError } from "@/lib/chat/http";
import {
  listPrivateConversations,
  openPrivateConversation,
} from "@/lib/chat/private-chat";
import { requireChatSession } from "@/lib/widget-auth/current-chat-user";
import {
  applyWidgetCors,
  widgetPreflightResponse,
} from "@/lib/widget-auth/cors";

const openSchema = z.object({
  targetUserIdentityId: z.string().uuid(),
});

export const OPTIONS = async (request: Request) =>
  widgetPreflightResponse(request, "GET, POST, OPTIONS");

const handledGet = withApiHandler(async (request) => {
  const current = await requireChatSession(request);

  try {
    const conversations = await listPrivateConversations(
      current.authorization.userIdentityId,
    );

    return NextResponse.json({
      success: true,
      data: {
        conversations,
      },
    });
  } catch (error) {
    return toChatAppError(error);
  }
});

const handledPost = withApiHandler(async (request) => {
  const current = await requireChatSession(request);
  const payload = openSchema.parse(await request.json());

  try {
    const result = await openPrivateConversation({
      userIdentityId: current.authorization.userIdentityId,
      targetUserIdentityId: payload.targetUserIdentityId,
    });

    return NextResponse.json({
      success: true,
      data: {
        roomId: result.room.id,
        participant: {
          userIdentityId: result.target.userIdentityId,
          username: result.target.username,
          name: result.target.displayName,
        },
        sharedGroupIds: result.access.sharedGroupIds,
        canSend: result.access.canSend,
        historyAvailable: true,
        unreadCount: result.unreadCount,
      },
    });
  } catch (error) {
    return toChatAppError(error);
  }
});

export const GET = async (request: Request) =>
  applyWidgetCors(await handledGet(request), request.headers.get("origin"));

export const POST = async (request: Request) =>
  applyWidgetCors(await handledPost(request), request.headers.get("origin"));

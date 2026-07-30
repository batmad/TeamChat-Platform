import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { toNotificationAppError } from "@/lib/notifications/http";
import { clearRoomMute, setRoomMute } from "@/lib/notifications/service";
import { normalizeMutedUntil } from "@/lib/notifications/rules";
import { requireChatSession } from "@/lib/widget-auth/current-chat-user";
import {
  applyWidgetCors,
  widgetPreflightResponse,
} from "@/lib/widget-auth/cors";
import { getRequestOrigin } from "@//lib/widget-auth/request-origin";

type Context = { params: Promise<{ roomId: string }> };
const bodySchema = z.object({
  mutedUntil: z.string().datetime().nullable().optional(),
});

export const OPTIONS = async (request: Request) =>
  widgetPreflightResponse(request, "PUT, DELETE, OPTIONS");

const handledPut = withApiHandler(async (request, context: Context) => {
  const current = await requireChatSession(request);
  const { roomId } = await context.params;
  const body = bodySchema.parse(await request.json().catch(() => ({})));
  try {
    const mute = await setRoomMute({
      userIdentityId: current.authorization.userIdentityId,
      roomId,
      mutedUntil: normalizeMutedUntil(body.mutedUntil),
    });
    return NextResponse.json({
      success: true,
      data: {
        roomId: mute.roomId,
        muted: true,
        mutedUntil: mute.mutedUntil?.toISOString() ?? null,
      },
    });
  } catch (error) {
    return toNotificationAppError(error);
  }
});

const handledDelete = withApiHandler(async (request, context: Context) => {
  const current = await requireChatSession(request);
  const { roomId } = await context.params;
  try {
    const data = await clearRoomMute(
      current.authorization.userIdentityId,
      roomId,
    );
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return toNotificationAppError(error);
  }
});

export const PUT = async (request: Request, context: Context) => {
  const requestOrigin = getRequestOrigin(request);
  return applyWidgetCors(await handledPut(request, context), requestOrigin);
};

export const DELETE = async (request: Request, context: Context) => {
  const requestOrigin = getRequestOrigin(request);
  return applyWidgetCors(await handledDelete(request, context), requestOrigin);
};

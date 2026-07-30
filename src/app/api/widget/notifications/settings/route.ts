import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/with-api-handler";
import {
  getNotificationSettings,
  updateNotificationSettings,
} from "@/lib/notifications/service";
import { requireChatSession } from "@/lib/widget-auth/current-chat-user";
import {
  applyWidgetCors,
  widgetPreflightResponse,
} from "@/lib/widget-auth/cors";
import { getRequestOrigin } from "@//lib/widget-auth/request-origin";

const bodySchema = z
  .object({
    soundEnabled: z.boolean().optional(),
    browserNotificationEnabled: z.boolean().optional(),
    muteAll: z.boolean().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one notification setting is required",
  );

export const OPTIONS = async (request: Request) =>
  widgetPreflightResponse(request, "GET, PATCH, OPTIONS");

const handledGet = withApiHandler(async (request) => {
  const current = await requireChatSession(request);
  const settings = await getNotificationSettings(
    current.authorization.userIdentityId,
  );
  return NextResponse.json({ success: true, data: settings });
});

const handledPatch = withApiHandler(async (request) => {
  const current = await requireChatSession(request);
  const body = bodySchema.parse(await request.json());
  const settings = await updateNotificationSettings({
    userIdentityId: current.authorization.userIdentityId,
    ...body,
  });
  return NextResponse.json({ success: true, data: settings });
});

export const GET = async (request: Request) => {
  const requestOrigin = getRequestOrigin(request);
  return applyWidgetCors(await handledGet(request), requestOrigin);
};

export const PATCH = async (request: Request) => {
  const requestOrigin = getRequestOrigin(request);
  return applyWidgetCors(await handledPatch(request), requestOrigin);
};

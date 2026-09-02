import { z } from "zod";
import { NextResponse } from "next/server";

import { withApiHandler } from "@/lib/api/with-api-handler";
import { resolveAttachmentBrowserAccess } from "@/lib/attachments/message/browser-access";
import { applyWidgetCors, widgetPreflightResponse } from "@/lib/widget-auth/cors";
import { requireChatSession } from "@/lib/widget-auth/current-chat-user";
import { getRequestOrigin } from "@/lib/widget-auth/request-origin";

export const runtime = "nodejs";
type Context = { params: Promise<{ attachmentId: string }> };

const actionSchema = z.enum(["download", "preview"]);

export const OPTIONS = async (request: Request) =>
  widgetPreflightResponse(request, "GET, OPTIONS");

const handledGet = withApiHandler(async (request: Request, context: Context) => {
  const current = await requireChatSession(request);
  const { attachmentId } = await context.params;
  const action = actionSchema.parse(
    new URL(request.url).searchParams.get("action") || "download",
  );

  const access = await resolveAttachmentBrowserAccess({
    attachmentId,
    applicationId: current.authorization.applicationId,
    userIdentityId: current.authorization.userIdentityId,
    action,
  });

  return NextResponse.json({ success: true, data: access });
});

export const GET = async (request: Request, context: Context) => {
  const origin = getRequestOrigin(request);
  return applyWidgetCors(await handledGet(request, context), origin);
};

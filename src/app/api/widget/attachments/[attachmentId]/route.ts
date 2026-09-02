import { NextResponse } from "next/server";

import { withApiHandler } from "@/lib/api/with-api-handler";
import { deleteMessageAttachment } from "@/lib/attachments/message/delete";
import { applyWidgetCors, widgetPreflightResponse } from "@/lib/widget-auth/cors";
import { requireChatSession } from "@/lib/widget-auth/current-chat-user";
import { getRequestOrigin } from "@//lib/widget-auth/request-origin";

export const runtime = "nodejs";

type Context = { params: Promise<{ attachmentId: string }> };

export const OPTIONS = async (request: Request) =>
  widgetPreflightResponse(request, "DELETE, OPTIONS");

const handledDelete = withApiHandler(async (request: Request, context: Context) => {
  const current = await requireChatSession(request);
  const { attachmentId } = await context.params;

  const deleted = await deleteMessageAttachment({
    attachmentId,
    applicationId: current.authorization.applicationId,
    userIdentityId: current.authorization.userIdentityId,
  });

  return NextResponse.json({ success: true, data: deleted });
});

export const DELETE = async (request: Request, context: Context) => {
  const requestOrigin = getRequestOrigin(request);
  return applyWidgetCors(await handledDelete(request, context), requestOrigin);
};

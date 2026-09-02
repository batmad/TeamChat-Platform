import { NextResponse } from "next/server";

import { withApiHandler } from "@/lib/api/with-api-handler";
import { resolveAttachmentPolicy } from "@/lib/attachments/config";
import { listEffectiveAttachmentFileTypes } from "@/lib/attachments/file-types";
import { buildAttachmentWidgetConfig } from "@/lib/attachments/widget-config";
import { applyWidgetCors, widgetPreflightResponse } from "@/lib/widget-auth/cors";
import { requireChatSession } from "@/lib/widget-auth/current-chat-user";
import { getRequestOrigin } from "@/lib/widget-auth/request-origin";

export const runtime = "nodejs";
export const OPTIONS = async (request: Request) =>
  widgetPreflightResponse(request, "GET, OPTIONS");

const handledGet = withApiHandler(async (request: Request) => {
  const current = await requireChatSession(request);
  const applicationId = current.authorization.applicationId;
  const [policy, fileTypes] = await Promise.all([
    resolveAttachmentPolicy(applicationId),
    listEffectiveAttachmentFileTypes(applicationId),
  ]);

  return NextResponse.json({
    success: true,
    data: buildAttachmentWidgetConfig({
      policy,
      fileTypes,
      permissions: current.authorization.permissions,
    }),
  });
});

export const GET = async (request: Request) => {
  const origin = getRequestOrigin(request);
  return applyWidgetCors(await handledGet(request), origin);
};

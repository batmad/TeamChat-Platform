import { Buffer } from "node:buffer";

import { withApiHandler } from "@/lib/api/with-api-handler";
import { attachmentContentDisposition } from "@/lib/attachments/message/content";
import { readAttachmentForDownload } from "@/lib/attachments/message/read";
import { applyWidgetCors, widgetPreflightResponse } from "@/lib/widget-auth/cors";
import { requireChatSession } from "@/lib/widget-auth/current-chat-user";
import { getRequestOrigin } from "@//lib/widget-auth/request-origin";

export const runtime = "nodejs";

type Context = { params: Promise<{ attachmentId: string }> };

export const OPTIONS = async (request: Request) =>
  widgetPreflightResponse(request, "GET, OPTIONS");

const handledGet = withApiHandler(async (request: Request, context: Context) => {
  const current = await requireChatSession(request);
  const { attachmentId } = await context.params;

  const delivery = await readAttachmentForDownload({
    attachmentId,
    applicationId: current.authorization.applicationId,
    userIdentityId: current.authorization.userIdentityId,
  });

  if (delivery.kind === "SIGNED_URL") {
    return new Response(null, {
      status: 307,
      headers: {
        Location: delivery.redirectUrl,
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }

  return new Response(Buffer.from(delivery.bytes), {
    status: 200,
    headers: {
      "Content-Type":
        delivery.access.detectedMimeType ||
        delivery.access.mimeType ||
        "application/octet-stream",
      "Content-Length": String(delivery.bytes.byteLength),
      "Content-Disposition": attachmentContentDisposition(
        "attachment",
        delivery.access.originalName,
      ),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

export const GET = async (request: Request, context: Context) => {
  const requestOrigin = getRequestOrigin(request);
  return applyWidgetCors(await handledGet(request, context), requestOrigin);
};

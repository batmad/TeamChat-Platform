import { Buffer } from "node:buffer";

import { withApiHandler } from "@/lib/api/with-api-handler";
import { attachmentContentDisposition } from "@/lib/attachments/message/content";
import { readChatLogAttachmentForAdmin } from "@/lib/reports/chat-log-attachments";

export const runtime = "nodejs";
type Context = { params: Promise<{ attachmentId: string }> };

export const GET = withApiHandler(async (_request: Request, context: Context) => {
  const { attachmentId } = await context.params;
  const delivery = await readChatLogAttachmentForAdmin({
    attachmentId,
    action: "download",
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
    headers: {
      "Content-Type": delivery.contentType,
      "Content-Length": String(delivery.bytes.byteLength),
      "Content-Disposition": attachmentContentDisposition(
        "attachment",
        delivery.originalName,
      ),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

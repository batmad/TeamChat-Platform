import { NextResponse } from "next/server";

import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { createAttachmentStorageProvider } from "@/lib/attachments/storage/factory";
import { resolveAttachmentStorageConfig } from "@/lib/attachments/storage/resolver";
import { prisma } from "@/lib/db/prisma";
import { applyWidgetCors, widgetPreflightResponse } from "@/lib/widget-auth/cors";
import { requireChatSession } from "@/lib/widget-auth/current-chat-user";
import { getRequestOrigin } from "@/lib/widget-auth/request-origin";

export const runtime = "nodejs";
type Context = { params: Promise<{ attachmentId: string }> };
export const OPTIONS = async (request: Request) => widgetPreflightResponse(request, "DELETE, OPTIONS");

const handledDelete = withApiHandler(async (request: Request, context: Context) => {
  const current = await requireChatSession(request);
  const { attachmentId } = await context.params;
  const row = await prisma.messageAttachment.findFirst({
    where: {
      id: attachmentId,
      applicationId: current.authorization.applicationId,
      uploadedByUserIdentityId: current.authorization.userIdentityId,
    },
  });
  if (!row) throw new AppError(404, "ATTACHMENT_NOT_FOUND", "Attachment was not found");
  if (row.messageId) {
    throw new AppError(409, "ATTACHMENT_ALREADY_BOUND", "A sent attachment must be deleted from its message");
  }
  if (row.deletedAt || row.status === "DELETED" || row.status === "EXPIRED") {
    return NextResponse.json({ success: true, data: { attachmentId, discarded: true } });
  }

  const deletedAt = new Date();
  try {
    if (row.storageProviderId && row.storageKey) {
      const storage = await resolveAttachmentStorageConfig({
        applicationId: row.applicationId,
        preferredStorageProviderId: row.storageProviderId,
      });
      const provider = createAttachmentStorageProvider(storage);
      await provider.delete(row.storageKey);
    }

    await prisma.messageAttachment.update({
      where: { id: row.id },
      data: {
        status: "DELETED",
        deletedAt,
        deletedByUserIdentityId: current.authorization.userIdentityId,
        deleteReason: "UPLOAD_DISCARDED",
        storageKey: null,
        deleteLastError: null,
      },
    });
  } catch (error) {
    await prisma.messageAttachment.update({
      where: { id: row.id },
      data: {
        status: "DELETE_FAILED",
        deletedByUserIdentityId: current.authorization.userIdentityId,
        deleteReason: "UPLOAD_DISCARDED",
        deleteRetryCount: { increment: 1 },
        deleteLastAttemptAt: deletedAt,
        deleteLastError:
          error instanceof Error ? error.message.slice(0, 2000) : "Discard cleanup failed",
      },
    });
    throw new AppError(503, "ATTACHMENT_DISCARD_FAILED", "Attachment cleanup could not be completed");
  }

  return NextResponse.json({ success: true, data: { attachmentId, discarded: true } });
});

export const DELETE = async (request: Request, context: Context) => {
  const origin = getRequestOrigin(request);
  return applyWidgetCors(await handledDelete(request, context), origin);
};

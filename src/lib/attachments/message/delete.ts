import "server-only";

import { AppError } from "@/lib/api/app-error";
import { writeAttachmentAuditSafe } from "@/lib/attachments/audit";
import { attachmentPermissionFor } from "@/lib/attachments/permissions";
import { requireAttachmentAccess } from "@/lib/attachments/message/access";
import { createAttachmentStorageProvider } from "@/lib/attachments/storage/factory";
import { resolveAttachmentStorageConfig } from "@/lib/attachments/storage/resolver";
import { prisma } from "@/lib/db/prisma";

export type DeletedAttachmentEvent = {
  attachmentId: string;
  messageId: string;
  roomId: string;
  roomType: "PRIVATE" | "GROUP";
  groupId: string | null;
  deletedAt: string;
  deletedByUserIdentityId: string;
  deleteReason: "USER_DELETE" | "MODERATOR_DELETE";
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 2000) : "Unknown storage deletion error";
}

export async function deleteMessageAttachment(input: {
  attachmentId: string;
  applicationId: string;
  userIdentityId: string;
}): Promise<DeletedAttachmentEvent> {
  const base = await requireAttachmentAccess({ ...input, action: "delete" }).catch(async (error) => {
    if (!(error instanceof AppError) || error.code !== "ATTACHMENT_ACTION_FORBIDDEN") throw error;
    return requireAttachmentAccess({ ...input, action: "deleteOthers" });
  });

  const isOwner = base.uploadedByUserIdentityId === base.actorUserIdentityId;
  const requiredPermission = attachmentPermissionFor(base.roomType, isOwner ? "delete" : "deleteOthers");
  if (!base.actorPermissions.includes(requiredPermission)) {
    throw new AppError(
      403,
      "ATTACHMENT_DELETE_FORBIDDEN",
      isOwner ? "You do not have permission to delete your attachment" : "You do not have permission to delete another user's attachment",
    );
  }

  if (base.deletedAt || base.status === "DELETED") throw new AppError(410, "ATTACHMENT_DELETED", "Attachment has already been deleted");
  if (!base.storageProviderId || !base.storageKey) throw new AppError(410, "ATTACHMENT_STORAGE_MISSING", "Attachment file is unavailable");

  const message = await prisma.messageAttachment.findUnique({ where: { id: base.attachmentId }, select: { messageId: true } });
  if (!message?.messageId) throw new AppError(409, "ATTACHMENT_MESSAGE_MISSING", "Attachment message is unavailable");

  const claimed = await prisma.messageAttachment.updateMany({
    where: {
      id: base.attachmentId,
      applicationId: base.applicationId,
      deletedAt: null,
      status: { notIn: ["DELETED", "DELETING"] },
    },
    data: { status: "DELETING" },
  });
  if (claimed.count !== 1) throw new AppError(409, "ATTACHMENT_DELETE_CONFLICT", "Attachment deletion is already in progress");

  const deleteReason = isOwner ? "USER_DELETE" : "MODERATOR_DELETE";
  const deletedAt = new Date();
  try {
    const storageConfig = await resolveAttachmentStorageConfig({
      applicationId: base.applicationId,
      preferredStorageProviderId: base.storageProviderId,
    });
    const provider = createAttachmentStorageProvider(storageConfig);
    await provider.delete(base.storageKey);

    await prisma.messageAttachment.update({
      where: { id: base.attachmentId },
      data: {
        status: "DELETED",
        deletedAt,
        deletedByUserIdentityId: base.actorUserIdentityId,
        deleteReason,
        storageKey: null,
        deleteRetryCount: 0,
        deleteLastAttemptAt: deletedAt,
        deleteLastError: null,
      },
    });
  } catch (error) {
    const storageError = errorMessage(error);
    await prisma.messageAttachment
      .update({
        where: { id: base.attachmentId },
        data: {
          status: "DELETE_FAILED",
          deletedByUserIdentityId: base.actorUserIdentityId,
          deleteReason,
          deleteRetryCount: { increment: 1 },
          deleteLastAttemptAt: new Date(),
          deleteLastError: storageError,
        },
      })
      .catch(() => undefined);
    await writeAttachmentAuditSafe({
      applicationId: base.applicationId,
      actorUsername: base.actorUsername,
      action: "ATTACHMENT_STORAGE_DELETE_FAILED",
      attachmentId: base.attachmentId,
      level: "ERROR",
      metadata: {
        messageId: message.messageId,
        roomId: base.roomId,
        roomType: base.roomType,
        groupId: base.groupId,
        deleteReason,
        error: storageError,
      },
    });
    throw error;
  }

  await writeAttachmentAuditSafe({
    applicationId: base.applicationId,
    actorUsername: base.actorUsername,
    action: isOwner ? "ATTACHMENT_DELETED" : "ATTACHMENT_DELETED_BY_MODERATOR",
    attachmentId: base.attachmentId,
    metadata: {
      messageId: message.messageId,
      roomId: base.roomId,
      roomType: base.roomType,
      groupId: base.groupId,
      originalName: base.originalName,
      sizeBytes: base.sizeBytes,
    },
  });

  return {
    attachmentId: base.attachmentId,
    messageId: message.messageId,
    roomId: base.roomId,
    roomType: base.roomType,
    groupId: base.groupId,
    deletedAt: deletedAt.toISOString(),
    deletedByUserIdentityId: base.actorUserIdentityId,
    deleteReason,
  };
}

export async function markMessageAttachmentsForDeletion(input: {
  applicationId: string;
  messageId: string;
  deletedByUserIdentityId?: string | null;
  reason?: string;
}) {
  return prisma.messageAttachment.updateMany({
    where: {
      applicationId: input.applicationId,
      messageId: input.messageId,
      deletedAt: null,
      status: { notIn: ["DELETED", "DELETING"] },
    },
    data: {
      status: "DELETING",
      deletedByUserIdentityId: input.deletedByUserIdentityId ?? null,
      deleteReason: input.reason ?? "MESSAGE_DELETED",
    },
  });
}

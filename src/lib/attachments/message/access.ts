import "server-only";

import { AppError } from "@/lib/api/app-error";
import { resolveAttachmentFileType } from "@/lib/attachments/file-types";
import {
  attachmentPermissionFor,
  type AttachmentPermissionAction,
  type AttachmentRoomType,
} from "@/lib/attachments/permissions";
import { resolveAttachmentPolicy } from "@/lib/attachments/config";
import { requireGroupAccess, requireGroupChatActor } from "@/lib/chat/group-access";
import { requirePrivateChatActor, requirePrivateRoomParticipant } from "@/lib/chat/private-access";
import { prisma } from "@/lib/db/prisma";

export type AttachmentAccessContext = {
  attachmentId: string;
  applicationId: string;
  roomId: string;
  roomType: AttachmentRoomType;
  groupId: string | null;
  actorUserIdentityId: string;
  actorUsername: string;
  actorPermissions: string[];
  uploadedByUserIdentityId: string | null;
  originalName: string;
  extension: string;
  mimeType: string;
  detectedMimeType: string | null;
  sizeBytes: bigint;
  status: string;
  scanStatus: string;
  expiresAt: Date | null;
  deletedAt: Date | null;
  storageProviderId: string | null;
  storageKey: string | null;
};

async function requireRoomAccess(userIdentityId: string, attachment: {
  roomId: string;
  roomType: AttachmentRoomType;
  groupId: string | null;
}) {
  if (attachment.roomType === "PRIVATE") {
    const actor = await requirePrivateChatActor(userIdentityId);
    await requirePrivateRoomParticipant(actor, attachment.roomId);
    return actor;
  }

  const actor = await requireGroupChatActor(userIdentityId);
  if (!attachment.groupId) {
    throw new AppError(409, "ATTACHMENT_GROUP_CONTEXT_INVALID", "Attachment group context is invalid");
  }
  await requireGroupAccess(actor, attachment.groupId);
  return actor;
}

export async function requireAttachmentAccess(input: {
  attachmentId: string;
  applicationId: string;
  userIdentityId: string;
  action: AttachmentPermissionAction;
}): Promise<AttachmentAccessContext> {
  const row = await prisma.messageAttachment.findFirst({
    where: {
      id: input.attachmentId,
      applicationId: input.applicationId,
      messageId: { not: null },
    },
    select: {
      id: true,
      applicationId: true,
      uploadedByUserIdentityId: true,
      originalName: true,
      extension: true,
      mimeType: true,
      detectedMimeType: true,
      sizeBytes: true,
      status: true,
      scanStatus: true,
      expiresAt: true,
      deletedAt: true,
      storageProviderId: true,
      storageKey: true,
      message: {
        select: {
          deletedAt: true,
          room: {
            select: {
              id: true,
              type: true,
              groupId: true,
              isActive: true,
            },
          },
        },
      },
    },
  });

  if (!row?.message || row.message.deletedAt || !row.message.room.isActive) {
    throw new AppError(404, "ATTACHMENT_NOT_FOUND", "Attachment is unavailable");
  }

  const roomType = row.message.room.type;
  if (roomType !== "PRIVATE" && roomType !== "GROUP") {
    throw new AppError(409, "ATTACHMENT_ROOM_TYPE_INVALID", "Attachment room type is invalid");
  }

  const actor = await requireRoomAccess(input.userIdentityId, {
    roomId: row.message.room.id,
    roomType,
    groupId: row.message.room.groupId,
  });

  if (actor.applicationId !== input.applicationId) {
    throw new AppError(404, "ATTACHMENT_NOT_FOUND", "Attachment is unavailable");
  }

  const permission = attachmentPermissionFor(roomType, input.action);
  if (!actor.permissions.includes(permission)) {
    throw new AppError(
      403,
      "ATTACHMENT_ACTION_FORBIDDEN",
      "You do not have permission to perform this attachment action",
      { permission },
    );
  }

  return {
    attachmentId: row.id,
    applicationId: row.applicationId,
    roomId: row.message.room.id,
    roomType,
    groupId: row.message.room.groupId,
    actorUserIdentityId: actor.userIdentityId,
    actorUsername: actor.username,
    actorPermissions: actor.permissions,
    uploadedByUserIdentityId: row.uploadedByUserIdentityId,
    originalName: row.originalName,
    extension: row.extension,
    mimeType: row.mimeType,
    detectedMimeType: row.detectedMimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    scanStatus: row.scanStatus,
    expiresAt: row.expiresAt,
    deletedAt: row.deletedAt,
    storageProviderId: row.storageProviderId,
    storageKey: row.storageKey,
  };
}

export function assertAttachmentReadable(access: AttachmentAccessContext) {
  if (access.status === "EXPIRED" || (access.expiresAt && access.expiresAt <= new Date())) {
    throw new AppError(410, "ATTACHMENT_EXPIRED", "Attachment has expired");
  }
  if (access.deletedAt || access.status === "DELETED" || access.status === "DELETING") {
    throw new AppError(410, "ATTACHMENT_DELETED", "Attachment has been deleted");
  }
  if (access.status !== "READY") {
    throw new AppError(409, "ATTACHMENT_NOT_READY", "Attachment is not ready for access");
  }
  if (access.scanStatus === "PENDING" || access.scanStatus === "SCANNING") {
    throw new AppError(409, "ATTACHMENT_SCAN_PENDING", "Attachment security scan is still in progress");
  }
  if (access.scanStatus === "INFECTED" || access.scanStatus === "FAILED") {
    throw new AppError(403, "ATTACHMENT_SCAN_REJECTED", "Attachment is unavailable");
  }
  if (!access.storageProviderId || !access.storageKey) {
    throw new AppError(410, "ATTACHMENT_STORAGE_MISSING", "Attachment file is unavailable");
  }
}

export async function assertAttachmentPreviewAllowed(access: AttachmentAccessContext) {
  assertAttachmentReadable(access);

  const [policy, fileType] = await Promise.all([
    resolveAttachmentPolicy(access.applicationId),
    resolveAttachmentFileType(access.applicationId, access.extension),
  ]);

  if (!fileType || !fileType.isActive || !fileType.isAllowed || !fileType.previewable) {
    throw new AppError(403, "ATTACHMENT_PREVIEW_DISABLED", "Preview is disabled for this file type");
  }
  if (fileType.category === "IMAGE" && !policy.imagePreviewEnabled) {
    throw new AppError(403, "ATTACHMENT_PREVIEW_DISABLED", "Image preview is disabled");
  }
  if (access.extension.toLowerCase() === "pdf" && !policy.pdfPreviewEnabled) {
    throw new AppError(403, "ATTACHMENT_PREVIEW_DISABLED", "PDF preview is disabled");
  }
  if (fileType.category !== "IMAGE" && access.extension.toLowerCase() !== "pdf") {
    throw new AppError(403, "ATTACHMENT_PREVIEW_UNSUPPORTED", "Preview is not supported for this file type");
  }
}

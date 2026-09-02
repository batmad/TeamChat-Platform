import "server-only";

import { AppError } from "@/lib/api/app-error";
import { writeAuditLog } from "@/lib/audit/audit";
import { resolveAttachmentPolicy } from "@/lib/attachments/config";
import { resolveAttachmentFileType } from "@/lib/attachments/file-types";
import { attachmentContentDisposition } from "@/lib/attachments/message/content";
import { createAttachmentStorageProvider } from "@/lib/attachments/storage/factory";
import { resolveAttachmentStorageConfig } from "@/lib/attachments/storage/resolver";
import { prisma } from "@/lib/db/prisma";
import { writeSystemLogSafe } from "@/lib/logs/system-log";
import { requireApiPermission } from "@/lib/rbac/guards";
import { resolveChatLogsScope } from "@/lib/reports/chat-logs-scope";

export type ChatLogAttachmentAction = "preview" | "download";

export type ChatLogAttachmentDelivery =
  | {
      kind: "SIGNED_URL";
      redirectUrl: string;
      contentType: string;
      originalName: string;
    }
  | {
      kind: "PROXY";
      bytes: Uint8Array;
      contentType: string;
      originalName: string;
    };

function remainingRetentionSeconds(expiresAt: Date | null) {
  if (!expiresAt) return null;
  return Math.floor((expiresAt.getTime() - Date.now()) / 1000);
}

function reportScopeAllowsMessage(
  scope: Awaited<ReturnType<typeof resolveChatLogsScope>>,
  message: {
    room: { type: "PRIVATE" | "GROUP"; groupId: string | null };
    groupContexts: Array<{ groupId: string }>;
  },
) {
  if (scope.unrestricted) return true;
  const allowed = new Set(scope.allowedGroups.map((group) => group.id));
  if (message.room.type === "GROUP") {
    return Boolean(message.room.groupId && allowed.has(message.room.groupId));
  }
  return message.groupContexts.some((context) => allowed.has(context.groupId));
}

function assertReadable(attachment: {
  status: string;
  scanStatus: string;
  expiresAt: Date | null;
  deletedAt: Date | null;
  storageProviderId: string | null;
  storageKey: string | null;
}) {
  if (
    attachment.status === "EXPIRED" ||
    (attachment.expiresAt && attachment.expiresAt.getTime() <= Date.now())
  ) {
    throw new AppError(410, "ATTACHMENT_EXPIRED", "Attachment has expired");
  }
  if (
    attachment.deletedAt ||
    attachment.status === "DELETED" ||
    attachment.status === "DELETING"
  ) {
    throw new AppError(410, "ATTACHMENT_DELETED", "Attachment has been deleted");
  }
  if (attachment.status !== "READY") {
    throw new AppError(409, "ATTACHMENT_NOT_READY", "Attachment is not ready for access");
  }
  if (attachment.scanStatus === "PENDING" || attachment.scanStatus === "SCANNING") {
    throw new AppError(
      409,
      "ATTACHMENT_SCAN_PENDING",
      "Attachment security scan is still in progress",
    );
  }
  if (attachment.scanStatus === "INFECTED" || attachment.scanStatus === "FAILED") {
    throw new AppError(403, "ATTACHMENT_SCAN_REJECTED", "Attachment is unavailable");
  }
  if (!attachment.storageProviderId || !attachment.storageKey) {
    throw new AppError(
      410,
      "ATTACHMENT_STORAGE_MISSING",
      "Attachment file is unavailable",
    );
  }
}

async function assertPreviewAllowed(attachment: {
  applicationId: string;
  extension: string;
}) {
  const [policy, fileType] = await Promise.all([
    resolveAttachmentPolicy(attachment.applicationId),
    resolveAttachmentFileType(attachment.applicationId, attachment.extension),
  ]);
  if (!fileType || !fileType.isActive || !fileType.isAllowed || !fileType.previewable) {
    throw new AppError(
      403,
      "ATTACHMENT_PREVIEW_DISABLED",
      "Preview is disabled for this file type",
    );
  }
  if (fileType.category === "IMAGE" && !policy.imagePreviewEnabled) {
    throw new AppError(403, "ATTACHMENT_PREVIEW_DISABLED", "Image preview is disabled");
  }
  if (attachment.extension.toLowerCase() === "pdf" && !policy.pdfPreviewEnabled) {
    throw new AppError(403, "ATTACHMENT_PREVIEW_DISABLED", "PDF preview is disabled");
  }
  if (fileType.category !== "IMAGE" && attachment.extension.toLowerCase() !== "pdf") {
    throw new AppError(
      403,
      "ATTACHMENT_PREVIEW_UNSUPPORTED",
      "Preview is not supported for this file type",
    );
  }
}

export async function readChatLogAttachmentForAdmin(input: {
  attachmentId: string;
  action: ChatLogAttachmentAction;
}): Promise<ChatLogAttachmentDelivery> {
  const attachment = await prisma.messageAttachment.findUnique({
    where: { id: input.attachmentId },
    select: {
      id: true,
      applicationId: true,
      messageId: true,
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
          id: true,
          deletedAt: true,
          room: {
            select: {
              id: true,
              type: true,
              groupId: true,
              isActive: true,
            },
          },
          groupContexts: { select: { groupId: true } },
        },
      },
    },
  });

  if (
    !attachment?.messageId ||
    !attachment.message ||
    attachment.message.deletedAt ||
    !attachment.message.room.isActive
  ) {
    throw new AppError(404, "ATTACHMENT_NOT_FOUND", "Attachment is unavailable");
  }

  const permission =
    input.action === "download" ? "reports.chat_logs.export" : "reports.chat_logs.view";
  const session = await requireApiPermission(permission, attachment.applicationId);
  const scope = await resolveChatLogsScope(session, attachment.applicationId);

  if (!reportScopeAllowsMessage(scope, attachment.message)) {
    throw new AppError(404, "ATTACHMENT_NOT_FOUND", "Attachment is unavailable");
  }

  assertReadable(attachment);
  if (input.action === "preview") {
    await assertPreviewAllowed(attachment);
  }

  const storageConfig = await resolveAttachmentStorageConfig({
    applicationId: attachment.applicationId,
    preferredStorageProviderId: attachment.storageProviderId,
  });
  const provider = createAttachmentStorageProvider(storageConfig);
  const contentType =
    attachment.detectedMimeType || attachment.mimeType || "application/octet-stream";
  const retentionSeconds = remainingRetentionSeconds(attachment.expiresAt);
  if (retentionSeconds !== null && retentionSeconds <= 0) {
    throw new AppError(410, "ATTACHMENT_EXPIRED", "Attachment has expired");
  }

  const mode = input.action === "preview" ? "inline" : "attachment";
  let delivery: ChatLogAttachmentDelivery;
  if (provider.createSignedReadUrl) {
    const redirectUrl = await provider.createSignedReadUrl({
      key: attachment.storageKey!,
      responseContentType: contentType,
      responseContentDisposition: attachmentContentDisposition(mode, attachment.originalName),
      maxExpiresInSeconds: retentionSeconds,
    });
    if (redirectUrl) {
      delivery = {
        kind: "SIGNED_URL",
        redirectUrl,
        contentType,
        originalName: attachment.originalName,
      };
    } else {
      delivery = {
        kind: "PROXY",
        bytes: await provider.read(attachment.storageKey!),
        contentType,
        originalName: attachment.originalName,
      };
    }
  } else {
    delivery = {
      kind: "PROXY",
      bytes: await provider.read(attachment.storageKey!),
      contentType,
      originalName: attachment.originalName,
    };
  }

  const action =
    input.action === "preview"
      ? "CHAT_LOG_ATTACHMENT_PREVIEW"
      : "CHAT_LOG_ATTACHMENT_DOWNLOAD";
  const metadata = {
    messageId: attachment.message.id,
    roomId: attachment.message.room.id,
    roomType: attachment.message.room.type,
    originalName: attachment.originalName,
    sizeBytes: Number(attachment.sizeBytes),
    delivery: delivery.kind,
    scopeType: scope.scopeType,
    scopeSource: scope.source,
  };
  await Promise.all([
    writeAuditLog({
      session,
      applicationId: attachment.applicationId,
      action,
      entityType: "MessageAttachment",
      entityId: attachment.id,
      metadata,
    }),
    writeSystemLogSafe({
      applicationId: attachment.applicationId,
      type: "REPORT",
      level: "INFO",
      username: session.username,
      action,
      message:
        input.action === "preview"
          ? "Chat Logs attachment previewed"
          : "Chat Logs attachment downloaded",
      metadata: { attachmentId: attachment.id, ...metadata },
    }),
  ]);

  return delivery;
}

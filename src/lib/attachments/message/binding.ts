import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { AppError } from "@/lib/api/app-error";
import { resolveAttachmentPolicy } from "@/lib/attachments/config";
import type { AttachmentRoomType } from "@/lib/attachments/permissions";
import {
  calculateAttachmentExpiresAt,
  resolveAttachmentRetentionPolicy,
} from "@/lib/attachments/retention/policy";

const MAX_ATTACHMENT_IDS_PER_REQUEST = 20;

type BindableAttachmentRow = {
  id: string;
  status: string;
  messageId: string | null;
  sizeBytes: bigint;
  expiresAt: Date | null;
};

export function normalizeAttachmentIds(value?: string[] | null): string[] {
  if (!value?.length) return [];

  const normalized = value.map((id) => id.trim()).filter(Boolean);
  if (normalized.length > MAX_ATTACHMENT_IDS_PER_REQUEST) {
    throw new AppError(400, "ATTACHMENT_TOO_MANY_IDS", "Attachment identifier count exceeds the server safety limit");
  }

  const unique = [...new Set(normalized)];
  if (unique.length !== normalized.length) {
    throw new AppError(400, "ATTACHMENT_DUPLICATE_ID", "Duplicate attachment identifiers are not allowed");
  }
  return unique;
}

function assertAttachmentScopeEnabled(
  roomType: AttachmentRoomType,
  policy: Awaited<ReturnType<typeof resolveAttachmentPolicy>>,
) {
  if (!policy.enabled) throw new AppError(403, "ATTACHMENTS_DISABLED", "Attachments are disabled for this application");
  if (roomType === "PRIVATE" && !policy.privateEnabled) {
    throw new AppError(403, "PRIVATE_ATTACHMENTS_DISABLED", "Private-chat attachments are disabled");
  }
  if (roomType === "GROUP" && !policy.groupEnabled) {
    throw new AppError(403, "GROUP_ATTACHMENTS_DISABLED", "Group-chat attachments are disabled");
  }
}

export async function bindReadyAttachmentsToMessage(input: {
  tx: Prisma.TransactionClient;
  applicationId: string;
  userIdentityId: string;
  roomType: AttachmentRoomType;
  messageId: string;
  attachmentIds: string[];
}) {
  const attachmentIds = normalizeAttachmentIds(input.attachmentIds);
  if (attachmentIds.length === 0) return [];

  const [policy, retentionPolicy] = await Promise.all([
    resolveAttachmentPolicy(input.applicationId),
    resolveAttachmentRetentionPolicy(input.applicationId),
  ]);
  assertAttachmentScopeEnabled(input.roomType, policy);

  if (attachmentIds.length > policy.maxFilesPerMessage) {
    throw new AppError(400, "ATTACHMENT_TOO_MANY_FILES", "Attachment file count exceeds the configured maximum", {
      maxFilesPerMessage: policy.maxFilesPerMessage,
    });
  }

  const now = new Date();
  const rows: BindableAttachmentRow[] = await input.tx.messageAttachment.findMany({
    where: {
      id: { in: attachmentIds },
      applicationId: input.applicationId,
      uploadedByUserIdentityId: input.userIdentityId,
      deletedAt: null,
    },
    select: { id: true, status: true, messageId: true, sizeBytes: true, expiresAt: true },
  });

  if (rows.length !== attachmentIds.length) {
    throw new AppError(400, "ATTACHMENT_BIND_INVALID", "One or more attachments are unavailable for this message");
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = attachmentIds.map((id) => byId.get(id)!);
  for (const row of ordered) {
    if (row.status !== "READY") {
      throw new AppError(409, "ATTACHMENT_NOT_READY", "One or more attachments are not ready to be sent", {
        attachmentId: row.id,
        status: row.status,
      });
    }
    if (row.messageId !== null) {
      throw new AppError(409, "ATTACHMENT_ALREADY_BOUND", "One or more attachments are already attached to a message", {
        attachmentId: row.id,
      });
    }
    if (row.expiresAt && row.expiresAt <= now) {
      throw new AppError(410, "ATTACHMENT_EXPIRED", "One or more attachments have expired", { attachmentId: row.id });
    }
    if (row.sizeBytes > policy.maxFileSizeBytes) {
      throw new AppError(413, "ATTACHMENT_FILE_TOO_LARGE", "Attachment exceeds the current configured file-size limit", {
        attachmentId: row.id,
        maxFileSizeBytes: policy.maxFileSizeBytes.toString(),
      });
    }
  }

  const totalBytes = ordered.reduce((sum, row) => sum + row.sizeBytes, BigInt(0));
  if (totalBytes > policy.maxTotalSizeBytes) {
    throw new AppError(413, "ATTACHMENT_TOTAL_SIZE_TOO_LARGE", "Attachment batch exceeds the current configured total size", {
      maxTotalSizeBytes: policy.maxTotalSizeBytes.toString(),
    });
  }

  const expiresAt = calculateAttachmentExpiresAt(now, retentionPolicy);
  const updated = await input.tx.messageAttachment.updateMany({
    where: {
      id: { in: attachmentIds },
      applicationId: input.applicationId,
      uploadedByUserIdentityId: input.userIdentityId,
      status: "READY",
      messageId: null,
      deletedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    data: { messageId: input.messageId, expiresAt },
  });

  if (updated.count !== attachmentIds.length) {
    throw new AppError(409, "ATTACHMENT_BIND_CONFLICT", "Attachment state changed while the message was being sent");
  }
  return attachmentIds;
}

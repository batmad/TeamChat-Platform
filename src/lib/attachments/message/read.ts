import "server-only";

import { AppError } from "@/lib/api/app-error";
import { writeAttachmentAuditSafe } from "@/lib/attachments/audit";
import { resolveAttachmentPolicy } from "@/lib/attachments/config";
import { attachmentContentDisposition } from "@/lib/attachments/message/content";
import { createAttachmentStorageProvider } from "@/lib/attachments/storage/factory";
import { resolveAttachmentStorageConfig } from "@/lib/attachments/storage/resolver";
import {
  assertAttachmentPreviewAllowed,
  assertAttachmentReadable,
  requireAttachmentAccess,
} from "@/lib/attachments/message/access";

export type AttachmentDelivery =
  | {
      kind: "PROXY";
      access: Awaited<ReturnType<typeof requireAttachmentAccess>>;
      bytes: Uint8Array;
    }
  | {
      kind: "SIGNED_URL";
      access: Awaited<ReturnType<typeof requireAttachmentAccess>>;
      redirectUrl: string;
    };

function remainingRetentionSeconds(expiresAt: Date | null) {
  if (!expiresAt) return null;
  return Math.floor((expiresAt.getTime() - Date.now()) / 1000);
}

async function buildDelivery(input: {
  access: Awaited<ReturnType<typeof requireAttachmentAccess>>;
  mode: "attachment" | "inline";
}): Promise<AttachmentDelivery> {
  const storageConfig = await resolveAttachmentStorageConfig({
    applicationId: input.access.applicationId,
    preferredStorageProviderId: input.access.storageProviderId,
  });
  const provider = createAttachmentStorageProvider(storageConfig);
  const contentType =
    input.access.detectedMimeType ||
    input.access.mimeType ||
    "application/octet-stream";
  const retentionSeconds = remainingRetentionSeconds(input.access.expiresAt);
  if (retentionSeconds !== null && retentionSeconds <= 0) {
    throw new AppError(410, "ATTACHMENT_EXPIRED", "Attachment has expired");
  }

  if (provider.createSignedReadUrl) {
    const redirectUrl = await provider.createSignedReadUrl({
      key: input.access.storageKey!,
      responseContentType: contentType,
      responseContentDisposition: attachmentContentDisposition(
        input.mode,
        input.access.originalName,
      ),
      maxExpiresInSeconds: retentionSeconds,
    });
    if (redirectUrl) {
      return { kind: "SIGNED_URL", access: input.access, redirectUrl };
    }
  }

  const bytes = await provider.read(input.access.storageKey!);
  return { kind: "PROXY", access: input.access, bytes };
}

export async function readAttachmentForDownload(input: {
  attachmentId: string;
  applicationId: string;
  userIdentityId: string;
}): Promise<AttachmentDelivery> {
  const access = await requireAttachmentAccess({ ...input, action: "download" });
  assertAttachmentReadable(access);
  const delivery = await buildDelivery({ access, mode: "attachment" });

  const policy = await resolveAttachmentPolicy(access.applicationId);
  if (policy.auditDownloadEnabled) {
    await writeAttachmentAuditSafe({
      applicationId: access.applicationId,
      actorUsername: access.actorUsername,
      action: "ATTACHMENT_DOWNLOAD",
      attachmentId: access.attachmentId,
      metadata: {
        roomId: access.roomId,
        roomType: access.roomType,
        originalName: access.originalName,
        sizeBytes: access.sizeBytes,
        delivery: delivery.kind,
      },
    });
  }
  return delivery;
}

export async function readAttachmentForPreview(input: {
  attachmentId: string;
  applicationId: string;
  userIdentityId: string;
}): Promise<AttachmentDelivery> {
  const access = await requireAttachmentAccess({ ...input, action: "preview" });
  await assertAttachmentPreviewAllowed(access);
  const delivery = await buildDelivery({ access, mode: "inline" });

  const policy = await resolveAttachmentPolicy(access.applicationId);
  if (policy.auditPreviewEnabled) {
    await writeAttachmentAuditSafe({
      applicationId: access.applicationId,
      actorUsername: access.actorUsername,
      action: "ATTACHMENT_PREVIEW",
      attachmentId: access.attachmentId,
      metadata: {
        roomId: access.roomId,
        roomType: access.roomType,
        originalName: access.originalName,
        sizeBytes: access.sizeBytes,
        delivery: delivery.kind,
      },
    });
  }
  return delivery;
}

import "server-only";

import { AppError } from "@/lib/api/app-error";
import { writeAttachmentAuditSafe } from "@/lib/attachments/audit";
import { resolveAttachmentPolicy } from "@/lib/attachments/config";
import { attachmentContentDisposition } from "@/lib/attachments/message/content";
import {
  assertAttachmentPreviewAllowed,
  assertAttachmentReadable,
  requireAttachmentAccess,
} from "@/lib/attachments/message/access";
import { createAttachmentStorageProvider } from "@/lib/attachments/storage/factory";
import { resolveAttachmentStorageConfig } from "@/lib/attachments/storage/resolver";

export type AttachmentBrowserAction = "download" | "preview";

export type AttachmentBrowserAccess = {
  delivery: "SIGNED_URL" | "PROXY";
  url: string | null;
  attachmentId: string;
  originalName: string;
  mimeType: string;
  expiresAt: string | null;
};

function remainingRetentionSeconds(expiresAt: Date | null) {
  if (!expiresAt) return null;
  return Math.floor((expiresAt.getTime() - Date.now()) / 1000);
}

export async function resolveAttachmentBrowserAccess(input: {
  attachmentId: string;
  applicationId: string;
  userIdentityId: string;
  action: AttachmentBrowserAction;
}): Promise<AttachmentBrowserAccess> {
  const access = await requireAttachmentAccess({
    attachmentId: input.attachmentId,
    applicationId: input.applicationId,
    userIdentityId: input.userIdentityId,
    action: input.action,
  });

  if (input.action === "preview") await assertAttachmentPreviewAllowed(access);
  else assertAttachmentReadable(access);

  const storageConfig = await resolveAttachmentStorageConfig({
    applicationId: access.applicationId,
    preferredStorageProviderId: access.storageProviderId,
  });
  const provider = createAttachmentStorageProvider(storageConfig);
  const contentType =
    access.detectedMimeType || access.mimeType || "application/octet-stream";
  const retentionSeconds = remainingRetentionSeconds(access.expiresAt);

  if (retentionSeconds !== null && retentionSeconds <= 0) {
    throw new AppError(410, "ATTACHMENT_EXPIRED", "Attachment has expired");
  }

  if (provider.createSignedReadUrl) {
    const url = await provider.createSignedReadUrl({
      key: access.storageKey!,
      responseContentType: contentType,
      responseContentDisposition: attachmentContentDisposition(
        input.action === "preview" ? "inline" : "attachment",
        access.originalName,
      ),
      maxExpiresInSeconds: retentionSeconds,
    });

    if (url) {
      const policy = await resolveAttachmentPolicy(access.applicationId);
      const auditEnabled =
        input.action === "preview"
          ? policy.auditPreviewEnabled
          : policy.auditDownloadEnabled;
      if (auditEnabled) {
        await writeAttachmentAuditSafe({
          applicationId: access.applicationId,
          actorUsername: access.actorUsername,
          action:
            input.action === "preview"
              ? "ATTACHMENT_PREVIEW"
              : "ATTACHMENT_DOWNLOAD",
          attachmentId: access.attachmentId,
          metadata: {
            roomId: access.roomId,
            roomType: access.roomType,
            originalName: access.originalName,
            sizeBytes: access.sizeBytes,
            delivery: "SIGNED_URL",
          },
        });
      }

      return {
        delivery: "SIGNED_URL",
        url,
        attachmentId: access.attachmentId,
        originalName: access.originalName,
        mimeType: contentType,
        expiresAt: access.expiresAt?.toISOString() ?? null,
      };
    }
  }

  return {
    delivery: "PROXY",
    url: null,
    attachmentId: access.attachmentId,
    originalName: access.originalName,
    mimeType: contentType,
    expiresAt: access.expiresAt?.toISOString() ?? null,
  };
}

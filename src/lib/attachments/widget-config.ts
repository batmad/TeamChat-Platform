import { ATTACHMENT_PERMISSIONS } from "@/lib/attachments/permissions";

type EffectivePolicy = {
  enabled: boolean;
  privateEnabled: boolean;
  groupEnabled: boolean;
  maxFileSizeBytes: bigint;
  maxFilesPerMessage: number;
  maxTotalSizeBytes: bigint;
  imagePreviewEnabled: boolean;
  pdfPreviewEnabled: boolean;
  malwareScanEnabled: boolean;
};

type EffectiveFileType = {
  extension: string;
  category: string;
  mimeTypes: string[];
  maxSizeBytes: bigint | null;
  previewable: boolean;
  isAllowed: boolean;
  isActive: boolean;
};

export function buildAttachmentWidgetConfig(input: {
  policy: EffectivePolicy;
  fileTypes: EffectiveFileType[];
  permissions: string[];
}) {
  const has = (permission: string) => input.permissions.includes(permission);
  return {
    enabled: input.policy.enabled,
    scopes: {
      PRIVATE: {
        enabled: input.policy.privateEnabled,
        canSend: has(ATTACHMENT_PERMISSIONS.PRIVATE.send),
        canDownload: has(ATTACHMENT_PERMISSIONS.PRIVATE.download),
        canPreview: has(ATTACHMENT_PERMISSIONS.PRIVATE.preview),
        canDelete: has(ATTACHMENT_PERMISSIONS.PRIVATE.delete),
        canDeleteOthers: has(ATTACHMENT_PERMISSIONS.PRIVATE.deleteOthers),
      },
      GROUP: {
        enabled: input.policy.groupEnabled,
        canSend: has(ATTACHMENT_PERMISSIONS.GROUP.send),
        canDownload: has(ATTACHMENT_PERMISSIONS.GROUP.download),
        canPreview: has(ATTACHMENT_PERMISSIONS.GROUP.preview),
        canDelete: has(ATTACHMENT_PERMISSIONS.GROUP.delete),
        canDeleteOthers: has(ATTACHMENT_PERMISSIONS.GROUP.deleteOthers),
      },
    },
    limits: {
      maxFileSizeBytes: input.policy.maxFileSizeBytes.toString(),
      maxFilesPerMessage: input.policy.maxFilesPerMessage,
      maxTotalSizeBytes: input.policy.maxTotalSizeBytes.toString(),
    },
    preview: {
      image: input.policy.imagePreviewEnabled,
      pdf: input.policy.pdfPreviewEnabled,
    },
    malwareScanEnabled: input.policy.malwareScanEnabled,
    fileTypes: input.fileTypes
      .filter((item) => item.isActive)
      .map((item) => ({
        extension: item.extension,
        category: item.category,
        mimeTypes: item.mimeTypes,
        maxSizeBytes: item.maxSizeBytes?.toString() ?? null,
        previewable: item.previewable,
        isAllowed: item.isAllowed,
      })),
  };
}

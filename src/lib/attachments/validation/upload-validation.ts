import { AppError } from "@/lib/api/app-error";
import type { EffectiveAttachmentFileType } from "@/lib/attachments/file-types";
import type { EffectiveAttachmentPolicy } from "@/lib/attachments/policy";
import { sha256Hex } from "@/lib/attachments/validation/checksum";
import { getAttachmentExtension, sanitizeAttachmentFilename } from "@/lib/attachments/validation/filename";
import { assertAttachmentMimeAllowed, normalizeMimeType } from "@/lib/attachments/validation/mime";
import { assertAttachmentSignatureAllowed } from "@/lib/attachments/validation/signature";

export type AttachmentUploadFileLike = {
  name: string;
  size: number;
  type?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type AttachmentUploadMetadata = {
  file: AttachmentUploadFileLike;
  originalName: string;
  extension: string;
  mimeType: string;
  fileType: EffectiveAttachmentFileType;
};

export type ValidatedAttachmentUpload = AttachmentUploadMetadata & {
  bytes: Uint8Array;
  detectedMimeType: string | null;
  checksum: string;
};

export function effectiveMaxFileSize(
  policy: EffectiveAttachmentPolicy,
  fileType: EffectiveAttachmentFileType,
) {
  if (fileType.maxSizeBytes === null) return policy.maxFileSizeBytes;
  return fileType.maxSizeBytes < policy.maxFileSizeBytes
    ? fileType.maxSizeBytes
    : policy.maxFileSizeBytes;
}

export function validateAttachmentUploadMetadata(input: {
  file: AttachmentUploadFileLike;
  fileType: EffectiveAttachmentFileType;
  policy: EffectiveAttachmentPolicy;
}): AttachmentUploadMetadata {
  const originalName = sanitizeAttachmentFilename(input.file.name);
  const extension = getAttachmentExtension(originalName);

  if (!input.fileType.isActive || !input.fileType.isAllowed) {
    throw new AppError(400, "ATTACHMENT_FILE_TYPE_NOT_ALLOWED", "Attachment file type is not allowed");
  }

  if (input.fileType.extension !== extension) {
    throw new AppError(400, "ATTACHMENT_FILE_TYPE_MISMATCH", "Attachment file-type policy mismatch");
  }

  if (!Number.isSafeInteger(input.file.size) || input.file.size <= 0) {
    throw new AppError(400, "ATTACHMENT_FILE_EMPTY", "Attachment file must not be empty");
  }

  const maximumSize = effectiveMaxFileSize(input.policy, input.fileType);
  if (BigInt(input.file.size) > maximumSize) {
    throw new AppError(
      413,
      "ATTACHMENT_FILE_TOO_LARGE",
      "Attachment exceeds the configured maximum file size",
      { maxFileSizeBytes: maximumSize.toString() },
    );
  }

  const mimeType = assertAttachmentMimeAllowed({
    declaredMimeType: input.file.type,
    allowedMimeTypes: input.fileType.mimeTypes,
    validationEnabled: input.policy.validateMime,
  });

  return {
    file: input.file,
    originalName,
    extension,
    mimeType: mimeType || normalizeMimeType(input.file.type) || "application/octet-stream",
    fileType: input.fileType,
  };
}

export async function validateAttachmentUploadContent(input: {
  metadata: AttachmentUploadMetadata;
  policy: EffectiveAttachmentPolicy;
}): Promise<ValidatedAttachmentUpload> {
  const arrayBuffer = await input.metadata.file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  if (bytes.byteLength !== input.metadata.file.size) {
    throw new AppError(
      400,
      "ATTACHMENT_SIZE_MISMATCH",
      "Attachment size changed while the upload was being processed",
    );
  }

  const signature = assertAttachmentSignatureAllowed({
    bytes,
    extension: input.metadata.extension,
    validationEnabled: input.policy.validateSignature,
  });

  return {
    ...input.metadata,
    bytes,
    detectedMimeType: signature?.detectedMimeType ?? null,
    checksum: sha256Hex(bytes),
  };
}

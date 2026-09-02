import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";

import { AppError } from "@/lib/api/app-error";
import { writeAttachmentAuditSafe } from "@/lib/attachments/audit";
import { resolveAttachmentPolicy } from "@/lib/attachments/config";
import { resolveAttachmentFileType } from "@/lib/attachments/file-types";
import type { AttachmentRoomType } from "@/lib/attachments/permissions";
import { createAttachmentMalwareScanner } from "@/lib/attachments/scanner/factory";
import { resolveAttachmentMalwareScannerConfig } from "@/lib/attachments/scanner/resolver";
import type { AttachmentMalwareScanner } from "@/lib/attachments/scanner/types";
import { consumeAttachmentUploadRateLimit } from "@/lib/attachments/security/rate-limit";
import { createAttachmentStorageProvider } from "@/lib/attachments/storage/factory";
import { buildAttachmentStorageKey } from "@/lib/attachments/storage/key";
import { resolveAttachmentStorageConfig } from "@/lib/attachments/storage/resolver";
import type { AttachmentStorageProvider } from "@/lib/attachments/storage/types";
import { assertAttachmentQuotaReservation } from "@/lib/attachments/upload/quota";
import {
  type AttachmentUploadFileLike,
  type AttachmentUploadMetadata,
  type ValidatedAttachmentUpload,
  validateAttachmentUploadContent,
  validateAttachmentUploadMetadata,
} from "@/lib/attachments/validation/upload-validation";
import {
  getAttachmentExtension,
  sanitizeAttachmentFilename,
} from "@/lib/attachments/validation/filename";
import { prisma } from "@/lib/db/prisma";

export type UploadTemporaryAttachmentsInput = {
  applicationId: string;
  userIdentityId: string;
  username: string;
  displayName: string | null;
  roomType: AttachmentRoomType;
  files: AttachmentUploadFileLike[];
};

export type UploadedAttachmentDto = {
  id: string;
  originalName: string;
  extension: string;
  mimeType: string;
  detectedMimeType: string | null;
  sizeBytes: number;
  checksum: string | null;
  status: "READY";
  scanStatus: "NOT_REQUIRED" | "CLEAN";
  previewable: boolean;
  createdAt: string;
};

type PlannedAttachment = {
  id: string;
  createdAt: Date;
  storageKey: string;
  storedName: string;
  file: ValidatedAttachmentUpload;
};

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 2000)
    : "Unknown attachment error";
}

function assertAttachmentFeatureEnabled(
  roomType: AttachmentRoomType,
  policy: Awaited<ReturnType<typeof resolveAttachmentPolicy>>,
) {
  if (!policy.enabled)
    throw new AppError(
      403,
      "ATTACHMENTS_DISABLED",
      "Attachments are disabled for this application",
    );
  if (roomType === "PRIVATE" && !policy.privateEnabled) {
    throw new AppError(
      403,
      "PRIVATE_ATTACHMENTS_DISABLED",
      "Private-chat attachments are disabled",
    );
  }
  if (roomType === "GROUP" && !policy.groupEnabled) {
    throw new AppError(
      403,
      "GROUP_ATTACHMENTS_DISABLED",
      "Group-chat attachments are disabled",
    );
  }
}

async function prepareMetadata(
  applicationId: string,
  file: AttachmentUploadFileLike,
  policy: Awaited<ReturnType<typeof resolveAttachmentPolicy>>,
): Promise<AttachmentUploadMetadata> {
  const sanitizedName = sanitizeAttachmentFilename(file.name);
  const extension = getAttachmentExtension(sanitizedName);
  const fileType = await resolveAttachmentFileType(applicationId, extension);
  if (!fileType || !fileType.isAllowed || !fileType.isActive) {
    throw new AppError(
      400,
      "ATTACHMENT_FILE_TYPE_NOT_ALLOWED",
      `Attachment file type .${extension} is not allowed`,
      {
        extension,
      },
    );
  }
  return validateAttachmentUploadMetadata({ file, fileType, policy });
}

function isPreviewEnabled(
  file: ValidatedAttachmentUpload,
  policy: Awaited<ReturnType<typeof resolveAttachmentPolicy>>,
) {
  if (!file.fileType.previewable) return false;
  if (file.fileType.category === "IMAGE") return policy.imagePreviewEnabled;
  if (file.extension === "pdf") return policy.pdfPreviewEnabled;
  return false;
}

async function reserveAttachmentRows(input: {
  applicationId: string;
  userIdentityId: string;
  username: string;
  displayName: string | null;
  providerId: string;
  plans: PlannedAttachment[];
  quotaBytes: bigint | null;
  malwareScanEnabled: boolean;
}) {
  const incomingBytes = input.plans.reduce(
    (sum, item) => sum + BigInt(item.file.bytes.byteLength),
    BigInt(0),
  );
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await assertAttachmentQuotaReservation({
      tx,
      applicationId: input.applicationId,
      incomingBytes,
      quotaBytes: input.quotaBytes,
    });

    for (const item of input.plans) {
      await tx.messageAttachment.create({
        data: {
          id: item.id,
          applicationId: input.applicationId,
          uploadedByUserIdentityId: input.userIdentityId,
          uploadedByUsername: input.username,
          uploadedByName: input.displayName,
          originalName: item.file.originalName,
          storedName: item.storedName,
          extension: item.file.extension,
          mimeType: item.file.mimeType,
          detectedMimeType: item.file.detectedMimeType,
          sizeBytes: BigInt(item.file.bytes.byteLength),
          checksum: item.file.checksum,
          checksumAlgorithm: "SHA256",
          storageProviderId: input.providerId,
          storageKey: item.storageKey,
          status: "TEMPORARY",
          scanStatus: input.malwareScanEnabled ? "PENDING" : "NOT_REQUIRED",
          createdAt: item.createdAt,
        },
      });
    }
  });
}

async function deleteStoredObjectBestEffort(
  provider: AttachmentStorageProvider,
  storageKey: string,
) {
  try {
    if (await provider.exists(storageKey)) await provider.delete(storageKey);
    return true;
  } catch {
    return false;
  }
}

async function rollbackSuccessfulAttachments(
  provider: AttachmentStorageProvider,
  uploaded: Array<{ id: string; storageKey: string }>,
) {
  await Promise.allSettled(
    uploaded.map(async (item) => {
      const deleted = await deleteStoredObjectBestEffort(
        provider,
        item.storageKey,
      );
      await prisma.messageAttachment.update({
        where: { id: item.id },
        data: deleted
          ? {
              status: "FAILED",
              storageKey: null,
              deletedAt: new Date(),
              deleteReason: "BATCH_UPLOAD_ROLLBACK",
            }
          : {
              status: "DELETE_FAILED",
              deleteReason: "BATCH_UPLOAD_ROLLBACK",
              deleteRetryCount: { increment: 1 },
              deleteLastAttemptAt: new Date(),
              deleteLastError: "Batch rollback could not remove stored object",
            },
      });
    }),
  );
}

async function processPlannedAttachment(input: {
  plan: PlannedAttachment;
  provider: AttachmentStorageProvider;
  scanner: AttachmentMalwareScanner | null;
  policy: Awaited<ReturnType<typeof resolveAttachmentPolicy>>;
  applicationId: string;
  username: string;
}): Promise<UploadedAttachmentDto> {
  const { plan } = input;
  await prisma.messageAttachment.update({
    where: { id: plan.id },
    data: { status: "UPLOADING" },
  });

  try {
    await input.provider.put({
      key: plan.storageKey,
      data: plan.file.bytes,
      contentType: plan.file.detectedMimeType ?? plan.file.mimeType,
    });
  } catch (error) {
    console.error(error);
    const storageDeleted = await deleteStoredObjectBestEffort(
      input.provider,
      plan.storageKey,
    );
    await prisma.messageAttachment.update({
      where: { id: plan.id },
      data: {
        status: "FAILED",
        storageKey: storageDeleted ? null : plan.storageKey,
        deletedAt: storageDeleted ? new Date() : null,
        deleteReason: "UPLOAD_STORAGE_FAILED",
      },
    });
    throw new AppError(
      503,
      "ATTACHMENT_UPLOAD_FAILED",
      "Attachment could not be stored",
      {
        fileName: plan.file.originalName,
      },
    );
  }

  let scanStatus: "NOT_REQUIRED" | "CLEAN" = "NOT_REQUIRED";
  if (input.scanner) {
    await prisma.messageAttachment.update({
      where: { id: plan.id },
      data: {
        status: "SCANNING",
        scanStatus: "SCANNING",
        scanProvider: input.scanner.providerName,
        scanAttemptCount: { increment: 1 },
        scanLastError: null,
      },
    });

    try {
      const result = await input.scanner.scan(plan.file.bytes);
      const scannedAt = new Date();
      if (result.infected) {
        const storageDeleted = await deleteStoredObjectBestEffort(
          input.provider,
          plan.storageKey,
        );
        await prisma.messageAttachment.update({
          where: { id: plan.id },
          data: {
            status: "REJECTED",
            scanStatus: "INFECTED",
            scanResult: {
              clean: false,
              infected: true,
              threatName: result.threatName,
              rawResult: result.rawResult,
            },
            scannedAt,
            storageKey: storageDeleted ? null : plan.storageKey,
            deletedAt: storageDeleted ? scannedAt : null,
            deleteReason: "MALWARE_DETECTED",
          },
        });
        await writeAttachmentAuditSafe({
          applicationId: input.applicationId,
          actorUsername: input.username,
          action: "ATTACHMENT_MALWARE_DETECTED",
          attachmentId: plan.id,
          level: "WARN",
          metadata: {
            originalName: plan.file.originalName,
            threatName: result.threatName,
            storageDeleted,
          },
        });
        throw new AppError(
          400,
          "ATTACHMENT_MALWARE_DETECTED",
          "Attachment was rejected by malware scanning",
        );
      }

      scanStatus = "CLEAN";
      await prisma.messageAttachment.update({
        where: { id: plan.id },
        data: {
          status: "READY",
          scanStatus: "CLEAN",
          scanResult: {
            clean: true,
            infected: false,
            rawResult: result.rawResult,
          },
          scannedAt,
          scanLastError: null,
        },
      });
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === "ATTACHMENT_MALWARE_DETECTED"
      )
        throw error;
      const storageDeleted = await deleteStoredObjectBestEffort(
        input.provider,
        plan.storageKey,
      );
      const scannedAt = new Date();
      await prisma.messageAttachment.update({
        where: { id: plan.id },
        data: {
          status: "FAILED",
          scanStatus: "FAILED",
          scanLastError: errorMessage(error),
          scannedAt,
          storageKey: storageDeleted ? null : plan.storageKey,
          deletedAt: storageDeleted ? scannedAt : null,
          deleteReason: "MALWARE_SCAN_FAILED",
        },
      });
      await writeAttachmentAuditSafe({
        applicationId: input.applicationId,
        actorUsername: input.username,
        action: "ATTACHMENT_MALWARE_SCAN_FAILED",
        attachmentId: plan.id,
        level: "ERROR",
        metadata: {
          originalName: plan.file.originalName,
          error: errorMessage(error),
          storageDeleted,
        },
      });
      throw new AppError(
        503,
        "ATTACHMENT_MALWARE_SCAN_FAILED",
        "Attachment security scan could not be completed",
      );
    }
  } else {
    await prisma.messageAttachment.update({
      where: { id: plan.id },
      data: { status: "READY", scanStatus: "NOT_REQUIRED" },
    });
  }

  await writeAttachmentAuditSafe({
    applicationId: input.applicationId,
    actorUsername: input.username,
    action: "ATTACHMENT_UPLOAD",
    attachmentId: plan.id,
    metadata: {
      originalName: plan.file.originalName,
      extension: plan.file.extension,
      mimeType: plan.file.detectedMimeType ?? plan.file.mimeType,
      sizeBytes: plan.file.bytes.byteLength,
      scanStatus,
    },
  });

  return {
    id: plan.id,
    originalName: plan.file.originalName,
    extension: plan.file.extension,
    mimeType: plan.file.mimeType,
    detectedMimeType: plan.file.detectedMimeType,
    sizeBytes: plan.file.bytes.byteLength,
    checksum: plan.file.checksum,
    status: "READY",
    scanStatus,
    previewable: isPreviewEnabled(plan.file, input.policy),
    createdAt: plan.createdAt.toISOString(),
  };
}

export async function uploadTemporaryAttachments(
  input: UploadTemporaryAttachmentsInput,
): Promise<UploadedAttachmentDto[]> {
  const policy = await resolveAttachmentPolicy(input.applicationId);
  assertAttachmentFeatureEnabled(input.roomType, policy);

  if (input.files.length === 0) {
    throw new AppError(
      400,
      "ATTACHMENT_FILE_REQUIRED",
      "At least one attachment file is required",
    );
  }
  if (input.files.length > policy.maxFilesPerMessage) {
    throw new AppError(
      400,
      "ATTACHMENT_TOO_MANY_FILES",
      "Attachment file count exceeds the configured maximum",
      {
        maxFilesPerMessage: policy.maxFilesPerMessage,
      },
    );
  }

  const metadata = await Promise.all(
    input.files.map((file) =>
      prepareMetadata(input.applicationId, file, policy),
    ),
  );
  const declaredTotalBytes = metadata.reduce(
    (sum, item) => sum + BigInt(item.file.size),
    BigInt(0),
  );
  if (declaredTotalBytes > policy.maxTotalSizeBytes) {
    throw new AppError(
      413,
      "ATTACHMENT_TOTAL_SIZE_TOO_LARGE",
      "Attachment batch exceeds the configured total size",
      {
        maxTotalSizeBytes: policy.maxTotalSizeBytes.toString(),
      },
    );
  }

  try {
    await consumeAttachmentUploadRateLimit({
      applicationId: input.applicationId,
      userIdentityId: input.userIdentityId,
      incomingBytes: declaredTotalBytes,
      policy,
    });
  } catch (error) {
    if (
      error instanceof AppError &&
      error.code === "ATTACHMENT_UPLOAD_RATE_LIMITED"
    ) {
      await writeAttachmentAuditSafe({
        applicationId: input.applicationId,
        actorUsername: input.username,
        action: "ATTACHMENT_UPLOAD_RATE_LIMITED",
        level: "WARN",
        metadata: {
          incomingBytes: declaredTotalBytes.toString(),
          fileCount: input.files.length,
        },
      });
    }
    throw error;
  }

  const validatedFiles = await Promise.all(
    metadata.map((item) =>
      validateAttachmentUploadContent({ metadata: item, policy }),
    ),
  );

  const storageConfig = await resolveAttachmentStorageConfig({
    applicationId: input.applicationId,
    preferredStorageProviderId: policy.storageProviderId,
  });
  const provider = createAttachmentStorageProvider(storageConfig);

  let scanner: AttachmentMalwareScanner | null = null;
  if (policy.malwareScanEnabled) {
    const scannerConfig = await resolveAttachmentMalwareScannerConfig({
      applicationId: input.applicationId,
      preferredScannerProviderId: policy.malwareScannerProviderId,
    });
    scanner = createAttachmentMalwareScanner(scannerConfig);
  }

  const plans: PlannedAttachment[] = validatedFiles.map((file) => {
    const id = randomUUID();
    const createdAt = new Date();
    return {
      id,
      createdAt,
      storageKey: buildAttachmentStorageKey({
        applicationId: input.applicationId,
        attachmentId: id,
        createdAt,
      }),
      storedName: `${id}.bin`,
      file,
    };
  });

  try {
    await reserveAttachmentRows({
      applicationId: input.applicationId,
      userIdentityId: input.userIdentityId,
      username: input.username,
      displayName: input.displayName,
      providerId: storageConfig.id,
      plans,
      quotaBytes: policy.storageQuotaBytes,
      malwareScanEnabled: policy.malwareScanEnabled,
    });
  } catch (error) {
    if (
      error instanceof AppError &&
      error.code === "ATTACHMENT_STORAGE_QUOTA_EXCEEDED"
    ) {
      await writeAttachmentAuditSafe({
        applicationId: input.applicationId,
        actorUsername: input.username,
        action: "ATTACHMENT_QUOTA_EXCEEDED",
        level: "WARN",
        metadata: {
          incomingBytes: declaredTotalBytes.toString(),
          fileCount: input.files.length,
        },
      });
    }
    throw error;
  }

  const successful: Array<{ id: string; storageKey: string }> = [];
  const results: UploadedAttachmentDto[] = [];
  try {
    for (const plan of plans) {
      const dto = await processPlannedAttachment({
        plan,
        provider,
        scanner,
        policy,
        applicationId: input.applicationId,
        username: input.username,
      });
      successful.push({ id: plan.id, storageKey: plan.storageKey });
      results.push(dto);
    }
    return results;
  } catch (error) {
    if (successful.length > 0)
      await rollbackSuccessfulAttachments(provider, successful);
    throw error;
  }
}

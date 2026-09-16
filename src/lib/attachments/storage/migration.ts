import "server-only";

import { createHash } from "node:crypto";

import { AppError } from "@/lib/api/app-error";
import { writeAttachmentAuditSafe } from "@/lib/attachments/audit";
import { storageNamespaceFingerprint } from "@/lib/attachments/storage/config-schema";
import { createAttachmentStorageProvider } from "@/lib/attachments/storage/factory";
import { getAttachmentStorageConfigById } from "@/lib/attachments/storage/resolver";
import { prisma } from "@/lib/db/prisma";

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export type AttachmentStorageMigrationResult = {
  scanned: number;
  migrated: number;
  failed: number;
  nextAfterId: string | null;
  failures: Array<{ attachmentId: string; error: string }>;
};

export async function migrateAttachmentStorageBatch(input: {
  sourceProviderId: string;
  targetProviderId: string;
  applicationId?: string | null;
  afterId?: string | null;
  limit?: number;
  deleteSource?: boolean;
  dryRun?: boolean;
  actorUsername?: string;
}): Promise<AttachmentStorageMigrationResult> {
  if (input.sourceProviderId === input.targetProviderId) {
    throw new AppError(
      400,
      "ATTACHMENT_STORAGE_MIGRATION_SAME_PROVIDER",
      "Source and target storage providers must be different",
    );
  }

  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 25)));
  const [sourceConfig, targetConfig] = await Promise.all([
    getAttachmentStorageConfigById(input.sourceProviderId),
    getAttachmentStorageConfigById(input.targetProviderId),
  ]);

  if (!targetConfig.isActive) {
    throw new AppError(
      409,
      "ATTACHMENT_STORAGE_MIGRATION_TARGET_INACTIVE",
      "Target storage provider must be active",
    );
  }

  const sourceNamespace = storageNamespaceFingerprint(
    sourceConfig.type,
    sourceConfig.config,
  );
  const targetNamespace = storageNamespaceFingerprint(
    targetConfig.type,
    targetConfig.config,
  );
  if (sourceNamespace === targetNamespace) {
    throw new AppError(
      409,
      "ATTACHMENT_STORAGE_MIGRATION_SAME_NAMESPACE",
      "Source and target providers resolve to the same physical storage namespace",
    );
  }

  if (
    sourceConfig.applicationId &&
    targetConfig.applicationId &&
    sourceConfig.applicationId !== targetConfig.applicationId
  ) {
    throw new AppError(
      403,
      "ATTACHMENT_STORAGE_MIGRATION_SCOPE_DENIED",
      "Application-scoped source and target providers must belong to the same application",
    );
  }

  const providerApplicationId =
    sourceConfig.applicationId ?? targetConfig.applicationId ?? null;
  if (
    input.applicationId &&
    providerApplicationId &&
    input.applicationId !== providerApplicationId
  ) {
    throw new AppError(
      403,
      "ATTACHMENT_STORAGE_MIGRATION_SCOPE_DENIED",
      "Storage provider is outside the requested application scope",
    );
  }
  const effectiveApplicationId =
    input.applicationId ?? providerApplicationId;

  const source = createAttachmentStorageProvider(sourceConfig);
  const target = createAttachmentStorageProvider(targetConfig);

  const attachments = await prisma.messageAttachment.findMany({
    where: {
      storageProviderId: input.sourceProviderId,
      storageKey: { not: null },
      deletedAt: null,
      status: "READY",
      ...(effectiveApplicationId ? { applicationId: effectiveApplicationId } : {}),
      ...(input.afterId ? { id: { gt: input.afterId } } : {}),
    },
    orderBy: { id: "asc" },
    take: limit,
    select: {
      id: true,
      applicationId: true,
      storageKey: true,
      checksum: true,
      checksumAlgorithm: true,
      sizeBytes: true,
      detectedMimeType: true,
      mimeType: true,
      originalName: true,
    },
  });

  const failures: AttachmentStorageMigrationResult["failures"] = [];
  let migrated = 0;

  for (const attachment of attachments) {
    const key = attachment.storageKey;
    if (!key) continue;

    if (input.dryRun) {
      migrated += 1;
      continue;
    }

    let targetWasCreated = false;
    try {
      const sourceBytes = await source.read(key);
      if (BigInt(sourceBytes.byteLength) !== attachment.sizeBytes) {
        throw new Error(
          `Source size mismatch: expected ${attachment.sizeBytes.toString()}, got ${sourceBytes.byteLength}`,
        );
      }
      if (
        attachment.checksum &&
        (attachment.checksumAlgorithm ?? "SHA256").toUpperCase() === "SHA256" &&
        sha256(sourceBytes) !== attachment.checksum.toLowerCase()
      ) {
        throw new Error("Source SHA-256 checksum does not match attachment metadata");
      }

      if (await target.exists(key)) {
        const existingTargetBytes = await target.read(key);
        if (
          existingTargetBytes.byteLength !== sourceBytes.byteLength ||
          sha256(existingTargetBytes) !== sha256(sourceBytes)
        ) {
          throw new Error(
            "Target object already exists at the same logical key with different content",
          );
        }
      } else {
        await target.put({
          key,
          data: sourceBytes,
          contentType:
            attachment.detectedMimeType ||
            attachment.mimeType ||
            "application/octet-stream",
        });
        targetWasCreated = true;

        const verifyBytes = await target.read(key);
        if (
          verifyBytes.byteLength !== sourceBytes.byteLength ||
          sha256(verifyBytes) !== sha256(sourceBytes)
        ) {
          throw new Error("Target read-back verification failed after copy");
        }
      }

      const updateResult = await prisma.messageAttachment.updateMany({
        where: {
          id: attachment.id,
          storageProviderId: input.sourceProviderId,
          storageKey: key,
          status: "READY",
          deletedAt: null,
        },
        data: {
          storageProviderId: input.targetProviderId,
        },
      });

      if (updateResult.count !== 1) {
        if (targetWasCreated) {
          await target.delete(key).catch(() => undefined);
        }
        throw new Error(
          "Attachment changed concurrently while storage migration was running",
        );
      }

      if (input.deleteSource) {
        try {
          await source.delete(key);
        } catch (error) {
          await writeAttachmentAuditSafe({
            applicationId: attachment.applicationId,
            actorUsername: input.actorUsername ?? "system:storage-migration",
            action: "ATTACHMENT_STORAGE_SOURCE_DELETE_FAILED",
            attachmentId: attachment.id,
            level: "WARN",
            metadata: {
              sourceProviderId: input.sourceProviderId,
              targetProviderId: input.targetProviderId,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }

      await writeAttachmentAuditSafe({
        applicationId: attachment.applicationId,
        actorUsername: input.actorUsername ?? "system:storage-migration",
        action: "ATTACHMENT_STORAGE_MIGRATED",
        attachmentId: attachment.id,
        metadata: {
          sourceProviderId: input.sourceProviderId,
          targetProviderId: input.targetProviderId,
          sourceDeleted: Boolean(input.deleteSource),
          originalName: attachment.originalName,
          sizeBytes: attachment.sizeBytes.toString(),
        },
      });
      migrated += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ attachmentId: attachment.id, error: message });
      await writeAttachmentAuditSafe({
        applicationId: attachment.applicationId,
        actorUsername: input.actorUsername ?? "system:storage-migration",
        action: "ATTACHMENT_STORAGE_MIGRATION_FAILED",
        attachmentId: attachment.id,
        level: "ERROR",
        metadata: {
          sourceProviderId: input.sourceProviderId,
          targetProviderId: input.targetProviderId,
          error: message,
        },
      });
    }
  }

  return {
    scanned: attachments.length,
    migrated,
    failed: failures.length,
    nextAfterId:
      attachments.length === limit
        ? attachments[attachments.length - 1]?.id ?? null
        : null,
    failures,
  };
}

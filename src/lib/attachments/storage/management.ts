import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";

import { AppError } from "@/lib/api/app-error";
import {
  encryptAttachmentStorageCredentials,
  type AttachmentStorageStaticCredentials,
} from "@/lib/attachments/storage/credential-crypto";
import {
  localStorageConfigSchema,
  minioStorageConfigSchema,
  s3StorageConfigSchema,
  storageNamespaceFingerprint,
} from "@/lib/attachments/storage/config-schema";
import { createAttachmentStorageProvider } from "@/lib/attachments/storage/factory";
import { prisma } from "@/lib/db/prisma";

const staticCredentialsSchema = z.object({
  accessKeyId: z.string().trim().min(1).max(2048),
  secretAccessKey: z.string().min(1).max(4096),
  sessionToken: z.string().min(1).max(8192).optional(),
});

const providerInputSchema = z.object({
  key: z
    .string()
    .trim()
    .min(3)
    .max(160)
    .regex(/^[A-Za-z0-9._:-]+$/),
  applicationId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(2).max(160),
  type: z.enum(["LOCAL", "S3", "MINIO"]),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  config: z.unknown(),
  credentials: staticCredentialsSchema.nullable().optional(),
});

const providerPatchSchema = providerInputSchema
  .partial()
  .omit({ applicationId: true })
  .extend({
    clearCredentials: z.boolean().optional(),
  });

export type StorageProviderCreateInput = z.input<typeof providerInputSchema>;
export type StorageProviderPatchInput = z.input<typeof providerPatchSchema>;

function validateProviderConfig(
  type: "LOCAL" | "S3" | "MINIO",
  config: unknown,
): Prisma.InputJsonValue {
  if (type === "LOCAL")
    return localStorageConfigSchema.parse(config) as Prisma.InputJsonValue;
  if (type === "S3")
    return s3StorageConfigSchema.parse(config) as Prisma.InputJsonValue;
  return minioStorageConfigSchema.parse(config) as Prisma.InputJsonValue;
}

function requiresStaticCredentials(
  type: "LOCAL" | "S3" | "MINIO",
  config: unknown,
) {
  if (type === "S3") {
    return s3StorageConfigSchema.parse(config).credentialMode === "STATIC";
  }
  if (type === "MINIO") {
    return minioStorageConfigSchema.parse(config).credentialMode === "STATIC";
  }
  return false;
}

function providerDto(provider: {
  id: string;
  key: string;
  applicationId: string | null;
  name: string;
  type: string;
  isActive: boolean;
  isDefault: boolean;
  config: unknown;
  credentialEncrypted: string | null;
  lastHealthCheckAt: Date | null;
  lastHealthStatus: string | null;
  lastHealthError: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: provider.id,
    key: provider.key,
    applicationId: provider.applicationId,
    name: provider.name,
    type: provider.type,
    isActive: provider.isActive,
    isDefault: provider.isDefault,
    config: provider.config,
    hasCredentials: Boolean(provider.credentialEncrypted),
    lastHealthCheckAt: provider.lastHealthCheckAt,
    lastHealthStatus: provider.lastHealthStatus,
    lastHealthError: provider.lastHealthError,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

async function lockDefaultScope(
  tx: Prisma.TransactionClient,
  applicationId: string | null,
) {
  const lockKey = `attachment-storage-default:${applicationId ?? "GLOBAL"}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
}

export async function listAttachmentStorageProviders(input: {
  applicationId?: string | null;
  includeGlobal?: boolean;
}) {
  const where =
    input.applicationId === undefined
      ? undefined
      : input.includeGlobal
        ? {
            OR: [
              { applicationId: input.applicationId },
              { applicationId: null },
            ],
          }
        : { applicationId: input.applicationId };

  const rows = await prisma.storageProviderConfig.findMany({
    where,
    orderBy: [{ applicationId: "asc" }, { isDefault: "desc" }, { name: "asc" }],
  });
  return rows.map(providerDto);
}

export async function createAttachmentStorageProviderConfig(
  rawInput: StorageProviderCreateInput,
) {
  const input = providerInputSchema.parse(rawInput);
  const config = validateProviderConfig(input.type, input.config);
  if (input.type === "LOCAL" && input.credentials) {
    throw new AppError(
      400,
      "ATTACHMENT_STORAGE_CREDENTIAL_NOT_ALLOWED",
      "LOCAL storage does not accept static object-storage credentials",
    );
  }
  if (input.isDefault && !input.isActive) {
    throw new AppError(
      400,
      "ATTACHMENT_STORAGE_DEFAULT_MUST_BE_ACTIVE",
      "A default storage provider must be active",
    );
  }

  const credentials = input.credentials
    ? encryptAttachmentStorageCredentials(
        input.credentials as AttachmentStorageStaticCredentials,
      )
    : null;

  if (requiresStaticCredentials(input.type, config) && !credentials) {
    throw new AppError(
      400,
      "ATTACHMENT_STORAGE_CREDENTIAL_REQUIRED",
      `${input.type} provider configured for STATIC credentials requires credentials`,
    );
  }

  // Validate schema/decryption/factory compatibility before a DB row is created.
  // Network connectivity remains an explicit test-connection operation.
  createAttachmentStorageProvider({
    id: "attachment-storage-create-validation",
    applicationId: input.applicationId ?? null,
    type: input.type,
    config,
    credentialEncrypted: credentials,
  });

  const row = await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      if (input.isDefault) {
        await lockDefaultScope(tx, input.applicationId ?? null);
        await tx.storageProviderConfig.updateMany({
          where: {
            applicationId: input.applicationId ?? null,
            isDefault: true,
          },
          data: { isDefault: false },
        });
      }

      return tx.storageProviderConfig.create({
        data: {
          id: randomUUID(),
          key: input.key,
          applicationId: input.applicationId ?? null,
          name: input.name,
          type: input.type,
          isActive: input.isActive,
          isDefault: input.isDefault,
          config,
          credentialEncrypted: credentials,
        },
      });
    },
  );

  return providerDto(row);
}

async function activeAttachmentReferenceCount(providerId: string) {
  return prisma.messageAttachment.count({
    where: {
      storageProviderId: providerId,
      storageKey: { not: null },
      deletedAt: null,
      status: { notIn: ["DELETED", "EXPIRED"] },
    },
  });
}

export async function updateAttachmentStorageProviderConfig(
  providerId: string,
  rawPatch: StorageProviderPatchInput,
) {
  const patch = providerPatchSchema.parse(rawPatch);
  const existing = await prisma.storageProviderConfig.findUnique({
    where: { id: providerId },
  });
  if (!existing) {
    throw new AppError(
      404,
      "ATTACHMENT_STORAGE_PROVIDER_NOT_FOUND",
      "Attachment storage provider was not found",
    );
  }

  const nextType = patch.type ?? existing.type;
  if (nextType !== "LOCAL" && nextType !== "S3" && nextType !== "MINIO") {
    throw new AppError(
      400,
      "ATTACHMENT_STORAGE_PROVIDER_UNSUPPORTED",
      "Only LOCAL, S3 and MINIO providers can be managed by this package",
    );
  }

  const nextConfig = validateProviderConfig(
    nextType,
    patch.config ?? existing.config,
  );

  const references = await activeAttachmentReferenceCount(providerId);
  if (references > 0) {
    const oldFingerprint = storageNamespaceFingerprint(
      existing.type,
      existing.config,
    );
    const newFingerprint = storageNamespaceFingerprint(nextType, nextConfig);
    if (oldFingerprint !== newFingerprint) {
      throw new AppError(
        409,
        "ATTACHMENT_STORAGE_NAMESPACE_IN_USE",
        "Provider bucket/path/endpoint cannot be changed while active attachments still reference it. Migrate attachments first.",
        { activeAttachmentCount: references },
      );
    }
    if (patch.isActive === false) {
      throw new AppError(
        409,
        "ATTACHMENT_STORAGE_PROVIDER_IN_USE",
        "Provider cannot be disabled while active attachments still reference it. Migrate attachments first.",
        { activeAttachmentCount: references },
      );
    }
  }

  if (nextType === "LOCAL" && patch.credentials) {
    throw new AppError(
      400,
      "ATTACHMENT_STORAGE_CREDENTIAL_NOT_ALLOWED",
      "LOCAL storage does not accept static object-storage credentials",
    );
  }

  let credentialEncrypted = existing.credentialEncrypted;
  if (nextType === "LOCAL") credentialEncrypted = null;
  if (patch.clearCredentials) credentialEncrypted = null;
  if (patch.credentials) {
    credentialEncrypted = encryptAttachmentStorageCredentials(
      patch.credentials as AttachmentStorageStaticCredentials,
    );
  }

  if (requiresStaticCredentials(nextType, nextConfig) && !credentialEncrypted) {
    throw new AppError(
      400,
      "ATTACHMENT_STORAGE_CREDENTIAL_REQUIRED",
      `${nextType} provider configured for STATIC credentials requires credentials`,
    );
  }

  const nextIsActive = patch.isActive ?? existing.isActive;
  const nextIsDefault = patch.isDefault ?? existing.isDefault;
  if (nextIsDefault && !nextIsActive) {
    throw new AppError(
      400,
      "ATTACHMENT_STORAGE_DEFAULT_MUST_BE_ACTIVE",
      "A default storage provider must be active",
    );
  }

  createAttachmentStorageProvider({
    id: existing.id,
    applicationId: existing.applicationId,
    type: nextType,
    config: nextConfig,
    credentialEncrypted,
  });

  const row = await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      if (patch.isDefault === true) {
        await lockDefaultScope(tx, existing.applicationId);
        await tx.storageProviderConfig.updateMany({
          where: {
            applicationId: existing.applicationId,
            isDefault: true,
            id: { not: providerId },
          },
          data: { isDefault: false },
        });
      }

      return tx.storageProviderConfig.update({
        where: { id: providerId },
        data: {
          key: patch.key,
          name: patch.name,
          type: patch.type,
          isActive: patch.isActive,
          isDefault: patch.isDefault,
          config: patch.config === undefined ? undefined : nextConfig,
          credentialEncrypted,
        },
      });
    },
  );

  return providerDto(row);
}

export async function disableAttachmentStorageProvider(providerId: string) {
  const existing = await prisma.storageProviderConfig.findUnique({
    where: { id: providerId },
  });
  if (!existing) {
    throw new AppError(
      404,
      "ATTACHMENT_STORAGE_PROVIDER_NOT_FOUND",
      "Attachment storage provider was not found",
    );
  }

  const references = await activeAttachmentReferenceCount(providerId);
  if (references > 0) {
    throw new AppError(
      409,
      "ATTACHMENT_STORAGE_PROVIDER_IN_USE",
      "Provider cannot be disabled while active attachments still reference it. Migrate attachments first.",
      { activeAttachmentCount: references },
    );
  }

  const policyReferences = await prisma.attachmentPolicy.count({
    where: { storageProviderId: providerId },
  });
  if (policyReferences > 0) {
    throw new AppError(
      409,
      "ATTACHMENT_STORAGE_PROVIDER_POLICY_IN_USE",
      "Provider is still selected by an attachment policy",
      { policyReferenceCount: policyReferences },
    );
  }

  const row = await prisma.storageProviderConfig.update({
    where: { id: providerId },
    data: { isActive: false, isDefault: false },
  });
  return providerDto(row);
}

export { providerDto as toAttachmentStorageProviderDto };

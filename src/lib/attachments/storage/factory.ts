import "server-only";

import { ZodError } from "zod";

import { AppError } from "@/lib/api/app-error";
import { decryptAttachmentStorageCredentials } from "@/lib/attachments/storage/credential-crypto";
import {
  localStorageConfigSchema,
  minioStorageConfigSchema,
  s3StorageConfigSchema,
} from "@/lib/attachments/storage/config-schema";
import { LocalAttachmentStorageProvider } from "@/lib/attachments/storage/local-storage";
import { S3CompatibleAttachmentStorageProvider } from "@/lib/attachments/storage/s3-compatible";
import type { AttachmentStorageProvider } from "@/lib/attachments/storage/types";

export type StorageProviderConfigRecord = {
  id: string;
  applicationId: string | null;
  type: "LOCAL" | "S3" | "MINIO" | "AZURE_BLOB" | "CUSTOM";
  config: unknown;
  credentialEncrypted?: string | null;
};

function invalidConfig(message: string, error?: ZodError) {
  return new AppError(
    500,
    "ATTACHMENT_STORAGE_CONFIG_INVALID",
    message,
    error?.flatten(),
  );
}

export function createAttachmentStorageProvider(
  config: StorageProviderConfigRecord,
): AttachmentStorageProvider {
  if (config.type === "LOCAL") {
    const parsed = localStorageConfigSchema.safeParse(config.config);
    if (!parsed.success) {
      throw invalidConfig(
        "Local attachment storage configuration is invalid",
        parsed.error,
      );
    }
    return new LocalAttachmentStorageProvider(config.id, parsed.data.basePath);
  }

  if (config.type === "S3" || config.type === "MINIO") {
    const schema =
      config.type === "S3" ? s3StorageConfigSchema : minioStorageConfigSchema;
    const parsed = schema.safeParse(config.config);
    if (!parsed.success) {
      throw invalidConfig(
        `${config.type} attachment storage configuration is invalid`,
        parsed.error,
      );
    }

    const credentials = decryptAttachmentStorageCredentials(
      config.credentialEncrypted,
    );
    if (parsed.data.credentialMode === "STATIC" && !credentials) {
      throw new AppError(
        503,
        "ATTACHMENT_STORAGE_CREDENTIAL_MISSING",
        `${config.type} storage requires static credentials`,
      );
    }

    return new S3CompatibleAttachmentStorageProvider({
      providerId: config.id,
      providerType: config.type,
      bucket: parsed.data.bucket,
      region: parsed.data.region,
      endpoint: parsed.data.endpoint,
      forcePathStyle: parsed.data.forcePathStyle,
      prefix: parsed.data.prefix,
      credentials: parsed.data.credentialMode === "STATIC" ? credentials : null,
      signedUrlEnabled: parsed.data.signedUrlEnabled,
      signedUrlTtlSeconds: parsed.data.signedUrlTtlSeconds,
      serverSideEncryption: parsed.data.serverSideEncryption,
      sseKmsKeyId: parsed.data.sseKmsKeyId,
    });
  }

  throw new AppError(
    503,
    "ATTACHMENT_STORAGE_PROVIDER_NOT_IMPLEMENTED",
    `Attachment storage provider ${config.type} is configured but is not implemented yet`,
  );
}

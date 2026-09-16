import { z } from "zod";

const keyPrefixSchema = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((value: string | undefined) => normalizeObjectPrefix(value));

export const localStorageConfigSchema = z.object({
  basePath: z.string().trim().min(1),
});

const baseS3CompatibleSchema = z.object({
  bucket: z.string().trim().min(1).max(255),
  region: z.string().trim().min(1).max(100).default("us-east-1"),
  endpoint: z.string().url().optional(),
  forcePathStyle: z.boolean(),
  prefix: keyPrefixSchema,
  credentialMode: z.enum(["STATIC", "DEFAULT_CHAIN"]),
  signedUrlEnabled: z.boolean().default(true),
  signedUrlTtlSeconds: z.coerce.number().int().min(15).max(300).default(60),
  serverSideEncryption: z.enum(["AES256", "aws:kms"]).optional(),
  sseKmsKeyId: z.string().trim().min(1).max(2048).optional(),
});

export const s3StorageConfigSchema = baseS3CompatibleSchema.extend({
  forcePathStyle: z.boolean().default(false),
  credentialMode: z.enum(["STATIC", "DEFAULT_CHAIN"]).default("DEFAULT_CHAIN"),
});

export const minioStorageConfigSchema = baseS3CompatibleSchema.extend({
  endpoint: z.string().url(),
  forcePathStyle: z.boolean().default(true),
  credentialMode: z.enum(["STATIC", "DEFAULT_CHAIN"]).default("STATIC"),
});

export type S3CompatibleStorageConfig = z.infer<typeof s3StorageConfigSchema>;

export function normalizeObjectPrefix(value: string | undefined | null) {
  if (!value) return "";
  const trimmed = value.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "";
  const segments = trimmed.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Storage object prefix contains an unsafe path segment");
  }
  return `${segments.join("/")}/`;
}

export function storageNamespaceFingerprint(
  type: "LOCAL" | "S3" | "MINIO" | "AZURE_BLOB" | "CUSTOM",
  config: unknown,
) {
  if (type === "LOCAL") {
    const parsed = localStorageConfigSchema.parse(config);
    return JSON.stringify({ type, basePath: parsed.basePath });
  }

  if (type === "S3") {
    const parsed = s3StorageConfigSchema.parse(config);
    return JSON.stringify({
      type,
      bucket: parsed.bucket,
      region: parsed.region,
      endpoint: parsed.endpoint ?? null,
      forcePathStyle: parsed.forcePathStyle,
      prefix: parsed.prefix,
    });
  }

  if (type === "MINIO") {
    const parsed = minioStorageConfigSchema.parse(config);
    return JSON.stringify({
      type,
      bucket: parsed.bucket,
      region: parsed.region,
      endpoint: parsed.endpoint,
      forcePathStyle: parsed.forcePathStyle,
      prefix: parsed.prefix,
    });
  }

  return JSON.stringify({ type, config });
}

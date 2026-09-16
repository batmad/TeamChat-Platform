import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { AppError } from "@/lib/api/app-error";
import type { AttachmentStorageStaticCredentials } from "@/lib/attachments/storage/credential-crypto";
import { normalizeObjectPrefix } from "@/lib/attachments/storage/config-schema";
import type {
  AttachmentStorageHealth,
  AttachmentStorageProvider,
  AttachmentStoragePutInput,
  AttachmentStoragePutResult,
  AttachmentStorageSignedReadInput,
} from "@/lib/attachments/storage/types";

type ProviderType = "S3" | "MINIO";

export type S3CompatibleProviderOptions = {
  providerId: string;
  providerType: ProviderType;
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  prefix?: string;
  credentials?: AttachmentStorageStaticCredentials | null;
  signedUrlEnabled: boolean;
  signedUrlTtlSeconds: number;
  serverSideEncryption?: "AES256" | "aws:kms";
  sseKmsKeyId?: string;
};

function isNotFoundError(error: unknown) {
  const candidate = error as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate?.$metadata?.httpStatusCode === 404 ||
    candidate?.name === "NotFound" ||
    candidate?.name === "NoSuchKey" ||
    candidate?.Code === "NoSuchKey"
  );
}

function clampSignedUrlTtl(configuredSeconds: number, maxSeconds?: number | null) {
  const configured = Math.max(1, Math.min(300, Math.floor(configuredSeconds)));
  if (maxSeconds === null || maxSeconds === undefined) return configured;
  return Math.max(1, Math.min(configured, Math.floor(maxSeconds)));
}

export function buildS3CompatibleObjectKey(prefix: string | undefined, logicalKey: string) {
  if (
    !logicalKey ||
    logicalKey.startsWith("/") ||
    logicalKey.includes("\\") ||
    logicalKey.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new AppError(
      400,
      "ATTACHMENT_STORAGE_KEY_INVALID",
      "Attachment storage key is invalid",
    );
  }

  return `${normalizeObjectPrefix(prefix)}${logicalKey}`;
}

export function buildS3ClientConfig(
  options: Pick<
    S3CompatibleProviderOptions,
    "region" | "endpoint" | "forcePathStyle" | "credentials"
  >,
): S3ClientConfig {
  return {
    region: options.region,
    endpoint: options.endpoint,
    forcePathStyle: options.forcePathStyle,
    credentials: options.credentials
      ? {
          accessKeyId: options.credentials.accessKeyId,
          secretAccessKey: options.credentials.secretAccessKey,
          sessionToken: options.credentials.sessionToken,
        }
      : undefined,
  };
}

export class S3CompatibleAttachmentStorageProvider
  implements AttachmentStorageProvider
{
  readonly providerId: string;
  readonly providerType: ProviderType;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly signedUrlEnabled: boolean;
  private readonly signedUrlTtlSeconds: number;
  private readonly serverSideEncryption?: "AES256" | "aws:kms";
  private readonly sseKmsKeyId?: string;
  private readonly client: S3Client;

  constructor(options: S3CompatibleProviderOptions) {
    this.providerId = options.providerId;
    this.providerType = options.providerType;
    this.bucket = options.bucket;
    this.prefix = normalizeObjectPrefix(options.prefix);
    this.signedUrlEnabled = options.signedUrlEnabled;
    this.signedUrlTtlSeconds = Math.max(
      15,
      Math.min(300, Math.floor(options.signedUrlTtlSeconds)),
    );
    this.serverSideEncryption = options.serverSideEncryption;
    this.sseKmsKeyId = options.sseKmsKeyId;
    this.client = new S3Client(buildS3ClientConfig(options));
  }

  private physicalKey(logicalKey: string) {
    return buildS3CompatibleObjectKey(this.prefix, logicalKey);
  }

  async put(input: AttachmentStoragePutInput): Promise<AttachmentStoragePutResult> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.physicalKey(input.key),
        Body: Buffer.from(input.data),
        ContentType: input.contentType || undefined,
        ServerSideEncryption: this.serverSideEncryption,
        SSEKMSKeyId:
          this.serverSideEncryption === "aws:kms"
            ? this.sseKmsKeyId
            : undefined,
      }),
    );

    return { key: input.key, sizeBytes: input.data.byteLength };
  }

  async read(key: string): Promise<Uint8Array> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.physicalKey(key),
        }),
      );

      if (!result.Body) {
        throw new AppError(
          404,
          "ATTACHMENT_STORAGE_OBJECT_NOT_FOUND",
          "Attachment file was not found",
        );
      }
      return await result.Body.transformToByteArray();
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new AppError(
          404,
          "ATTACHMENT_STORAGE_OBJECT_NOT_FOUND",
          "Attachment file was not found",
        );
      }
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.physicalKey(key),
        }),
      );
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.physicalKey(key),
      }),
    );
  }

  async healthCheck(): Promise<AttachmentStorageHealth> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : `${this.providerType} attachment storage is unavailable`,
      };
    }
  }

  async createSignedReadUrl(
    input: AttachmentStorageSignedReadInput,
  ): Promise<string | null> {
    if (!this.signedUrlEnabled) return null;

    const expiresIn = clampSignedUrlTtl(
      this.signedUrlTtlSeconds,
      input.maxExpiresInSeconds,
    );

    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.physicalKey(input.key),
        ResponseContentType: input.responseContentType || undefined,
        ResponseContentDisposition:
          input.responseContentDisposition || undefined,
      }),
      { expiresIn },
    );
  }
}

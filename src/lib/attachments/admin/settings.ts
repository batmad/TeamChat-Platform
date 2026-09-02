import "server-only";

import { z } from "zod";
import type { AttachmentFileCategory, Prisma } from "@/generated/prisma/client";

import { AppError } from "@/lib/api/app-error";
import {
  applicationAttachmentFileTypeKey,
  applicationAttachmentPolicyKey,
  GLOBAL_ATTACHMENT_POLICY_KEY,
  globalAttachmentFileTypeKey,
  normalizeAttachmentExtension,
} from "@/lib/attachments/constants";
import { resolveAttachmentPolicy } from "@/lib/attachments/config";
import { mergeAttachmentPolicy } from "@/lib/attachments/policy";
import { listEffectiveAttachmentFileTypes } from "@/lib/attachments/file-types";
import { prisma } from "@/lib/db/prisma";

const bigintInput = z.union([
  z.string().regex(/^\d+$/),
  z.number().int().nonnegative(),
  z.bigint().nonnegative(),
]);
const nullableBigintInput = z.union([bigintInput, z.null()]);

export const attachmentPolicyPatchSchema = z.object({
  applicationId: z.string().uuid().nullable(),
  inheritGlobal: z.boolean().optional(),
  enabled: z.boolean().nullable().optional(),
  privateEnabled: z.boolean().nullable().optional(),
  groupEnabled: z.boolean().nullable().optional(),
  maxFileSizeBytes: nullableBigintInput.optional(),
  maxFilesPerMessage: z.number().int().min(1).max(20).nullable().optional(),
  maxTotalSizeBytes: nullableBigintInput.optional(),
  storageQuotaBytes: nullableBigintInput.optional(),
  imagePreviewEnabled: z.boolean().nullable().optional(),
  pdfPreviewEnabled: z.boolean().nullable().optional(),
  malwareScanEnabled: z.boolean().nullable().optional(),
  malwareScannerProviderId: z.string().uuid().nullable().optional(),
  validateMime: z.boolean().nullable().optional(),
  validateSignature: z.boolean().nullable().optional(),
  temporaryTtlMinutes: z.number().int().min(5).max(10080).nullable().optional(),
  failedCleanupHours: z.number().int().min(1).max(720).nullable().optional(),
  uploadRateLimitEnabled: z.boolean().nullable().optional(),
  uploadRateLimitWindowMs: z
    .number()
    .int()
    .min(1000)
    .max(3600000)
    .nullable()
    .optional(),
  uploadRateLimitMaxRequests: z
    .number()
    .int()
    .min(1)
    .max(10000)
    .nullable()
    .optional(),
  uploadRateLimitMaxBytes: nullableBigintInput.optional(),
  deleteRetryMaxAttempts: z
    .number()
    .int()
    .min(1)
    .max(100)
    .nullable()
    .optional(),
  deleteRetryBaseMinutes: z
    .number()
    .int()
    .min(1)
    .max(1440)
    .nullable()
    .optional(),
  auditDownloadEnabled: z.boolean().nullable().optional(),
  auditPreviewEnabled: z.boolean().nullable().optional(),
  storageProviderId: z.string().uuid().nullable().optional(),
});

const fileTypeInputSchema = z.object({
  extension: z.string().trim().min(1).max(20),
  category: z.enum([
    "IMAGE",
    "DOCUMENT",
    "SPREADSHEET",
    "ARCHIVE",
    "AUDIO",
    "VIDEO",
    "TEXT",
    "OTHER",
  ]),
  mimeTypes: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  maxSizeBytes: nullableBigintInput.optional().default(null),
  previewable: z.boolean().default(false),
  isAllowed: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

export const attachmentFileTypesBatchSchema = z.object({
  applicationId: z.string().uuid().nullable(),
  policies: z.array(fileTypeInputSchema).min(1).max(200),
});

function toBigInt(value: z.infer<typeof nullableBigintInput> | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return BigInt(value);
}

function serializeBigInts<T>(value: T): T {
  if (typeof value === "bigint") return value.toString() as T;
  if (Array.isArray(value)) return value.map(serializeBigInts) as T;
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      result[key] = serializeBigInts(item);
    }
    return result as T;
  }
  return value;
}

export async function getAttachmentAdminSettings(applicationId: string | null) {
  const [
    globalPolicy,
    applicationPolicy,
    effectivePolicy,
    fileTypes,
    providers,
    scanners,
  ] = await Promise.all([
    prisma.attachmentPolicy.findUnique({
      where: { key: GLOBAL_ATTACHMENT_POLICY_KEY },
    }),
    applicationId
      ? prisma.attachmentPolicy.findUnique({ where: { applicationId } })
      : Promise.resolve(null),
    applicationId
      ? resolveAttachmentPolicy(applicationId)
      : resolveGlobalPolicy(),
    applicationId
      ? listEffectiveAttachmentFileTypes(applicationId)
      : prisma.attachmentFileType.findMany({
          where: { applicationId: null, isActive: true },
          orderBy: [{ category: "asc" }, { extension: "asc" }],
        }),
    prisma.storageProviderConfig.findMany({
      where: applicationId
        ? { OR: [{ applicationId }, { applicationId: null }], isActive: true }
        : { applicationId: null, isActive: true },
      orderBy: [
        { applicationId: "asc" },
        { isDefault: "desc" },
        { name: "asc" },
      ],
      select: {
        id: true,
        key: true,
        applicationId: true,
        name: true,
        type: true,
        isActive: true,
        isDefault: true,
        config: true,
        lastHealthCheckAt: true,
        lastHealthStatus: true,
        lastHealthError: true,
        credentialEncrypted: true,
      },
    }),
    prisma.malwareScannerConfig.findMany({
      where: applicationId
        ? { OR: [{ applicationId }, { applicationId: null }], isActive: true }
        : { applicationId: null, isActive: true },
      orderBy: [
        { applicationId: "asc" },
        { isDefault: "desc" },
        { name: "asc" },
      ],
      select: {
        id: true,
        key: true,
        applicationId: true,
        name: true,
        type: true,
        isDefault: true,
        lastHealthStatus: true,
      },
    }),
  ]);

  return serializeBigInts({
    scope: applicationId ? "APPLICATION" : "GLOBAL",
    applicationId,
    globalPolicy,
    applicationPolicy,
    effectivePolicy,
    fileTypes,
    providers: providers.map(
      (provider: {
        credentialEncrypted: string | null;
        [key: string]: unknown;
      }) => {
        const { credentialEncrypted, ...safeProvider } = provider;
        return {
          ...safeProvider,
          hasCredentials: Boolean(credentialEncrypted),
        };
      },
    ),
    scanners,
  });
}

async function resolveGlobalPolicy() {
  const row = await prisma.attachmentPolicy.findUnique({
    where: { key: GLOBAL_ATTACHMENT_POLICY_KEY },
  });
  if (!row) {
    throw new AppError(
      500,
      "ATTACHMENT_GLOBAL_POLICY_MISSING",
      "Global attachment policy is missing",
    );
  }
  return { ...mergeAttachmentPolicy(null, row), source: "GLOBAL" as const };
}

export async function updateAttachmentAdminPolicy(raw: unknown) {
  const input = attachmentPolicyPatchSchema.parse(raw);
  const applicationId = input.applicationId;
  const data: Prisma.AttachmentPolicyUncheckedUpdateInput = {
    ...(input.inheritGlobal === undefined
      ? {}
      : { inheritGlobal: input.inheritGlobal }),
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    ...(input.privateEnabled === undefined
      ? {}
      : { privateEnabled: input.privateEnabled }),
    ...(input.groupEnabled === undefined
      ? {}
      : { groupEnabled: input.groupEnabled }),
    ...(input.maxFileSizeBytes === undefined
      ? {}
      : { maxFileSizeBytes: toBigInt(input.maxFileSizeBytes) }),
    ...(input.maxFilesPerMessage === undefined
      ? {}
      : { maxFilesPerMessage: input.maxFilesPerMessage }),
    ...(input.maxTotalSizeBytes === undefined
      ? {}
      : { maxTotalSizeBytes: toBigInt(input.maxTotalSizeBytes) }),
    ...(input.storageQuotaBytes === undefined
      ? {}
      : { storageQuotaBytes: toBigInt(input.storageQuotaBytes) }),
    ...(input.imagePreviewEnabled === undefined
      ? {}
      : { imagePreviewEnabled: input.imagePreviewEnabled }),
    ...(input.pdfPreviewEnabled === undefined
      ? {}
      : { pdfPreviewEnabled: input.pdfPreviewEnabled }),
    ...(input.malwareScanEnabled === undefined
      ? {}
      : { malwareScanEnabled: input.malwareScanEnabled }),
    ...(input.malwareScannerProviderId === undefined
      ? {}
      : { malwareScannerProviderId: input.malwareScannerProviderId }),
    ...(input.validateMime === undefined
      ? {}
      : { validateMime: input.validateMime }),
    ...(input.validateSignature === undefined
      ? {}
      : { validateSignature: input.validateSignature }),
    ...(input.temporaryTtlMinutes === undefined
      ? {}
      : { temporaryTtlMinutes: input.temporaryTtlMinutes }),
    ...(input.failedCleanupHours === undefined
      ? {}
      : { failedCleanupHours: input.failedCleanupHours }),
    ...(input.uploadRateLimitEnabled === undefined
      ? {}
      : { uploadRateLimitEnabled: input.uploadRateLimitEnabled }),
    ...(input.uploadRateLimitWindowMs === undefined
      ? {}
      : { uploadRateLimitWindowMs: input.uploadRateLimitWindowMs }),
    ...(input.uploadRateLimitMaxRequests === undefined
      ? {}
      : { uploadRateLimitMaxRequests: input.uploadRateLimitMaxRequests }),
    ...(input.uploadRateLimitMaxBytes === undefined
      ? {}
      : { uploadRateLimitMaxBytes: toBigInt(input.uploadRateLimitMaxBytes) }),
    ...(input.deleteRetryMaxAttempts === undefined
      ? {}
      : { deleteRetryMaxAttempts: input.deleteRetryMaxAttempts }),
    ...(input.deleteRetryBaseMinutes === undefined
      ? {}
      : { deleteRetryBaseMinutes: input.deleteRetryBaseMinutes }),
    ...(input.auditDownloadEnabled === undefined
      ? {}
      : { auditDownloadEnabled: input.auditDownloadEnabled }),
    ...(input.auditPreviewEnabled === undefined
      ? {}
      : { auditPreviewEnabled: input.auditPreviewEnabled }),
    ...(input.storageProviderId === undefined
      ? {}
      : { storageProviderId: input.storageProviderId }),
  };

  if (!applicationId) {
    const row = await prisma.attachmentPolicy.update({
      where: { key: GLOBAL_ATTACHMENT_POLICY_KEY },
      data,
    });
    return serializeBigInts(row);
  }

  const row = await prisma.attachmentPolicy.upsert({
    where: { applicationId },
    create: {
      key: applicationAttachmentPolicyKey(applicationId),
      applicationId,
      inheritGlobal: input.inheritGlobal ?? true,
      ...data,
    } as Prisma.AttachmentPolicyUncheckedCreateInput,
    update: data,
  });
  return serializeBigInts(row);
}

export async function upsertAttachmentFileTypes(raw: unknown) {
  const input = attachmentFileTypesBatchSchema.parse(raw);
  const applicationId = input.applicationId;

  await prisma.$transaction(
    input.policies.map((policy: z.infer<typeof fileTypeInputSchema>) => {
      const extension = normalizeAttachmentExtension(policy.extension);
      const key = applicationId
        ? applicationAttachmentFileTypeKey(applicationId, extension)
        : globalAttachmentFileTypeKey(extension);
      const row = {
        applicationId,
        category: policy.category as AttachmentFileCategory,
        extension,
        mimeTypes: policy.mimeTypes,
        maxSizeBytes: toBigInt(policy.maxSizeBytes),
        previewable: policy.previewable,
        isAllowed: policy.isAllowed,
        isActive: policy.isActive,
      };
      return prisma.attachmentFileType.upsert({
        where: { key },
        create: { key, ...row },
        update: row,
      });
    }),
  );

  return applicationId
    ? serializeBigInts(await listEffectiveAttachmentFileTypes(applicationId))
    : serializeBigInts(
        await prisma.attachmentFileType.findMany({
          where: { applicationId: null, isActive: true },
          orderBy: [{ category: "asc" }, { extension: "asc" }],
        }),
      );
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import {
  disableAttachmentStorageProvider,
  toAttachmentStorageProviderDto,
  updateAttachmentStorageProviderConfig,
} from "@/lib/attachments/storage/management";
import { getAttachmentStorageConfigById } from "@/lib/attachments/storage/resolver";
import { requireApiPermission } from "@/lib/rbac/guards";

export const runtime = "nodejs";

type Context = { params: Promise<{ providerId: string }> };

const patchSchema = z.object({
  key: z.string().trim().min(3).max(160).optional(),
  name: z.string().trim().min(2).max(160).optional(),
  type: z.enum(["LOCAL", "S3", "MINIO"]).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  config: z.unknown().optional(),
  credentials: z
    .object({
      accessKeyId: z.string().min(1),
      secretAccessKey: z.string().min(1),
      sessionToken: z.string().min(1).optional(),
    })
    .nullable()
    .optional(),
  clearCredentials: z.boolean().optional(),
});

async function requireProviderScope(providerId: string, permission: string) {
  const session = await requireApiPermission(permission);
  const provider = await getAttachmentStorageConfigById(providerId);

  if (!session.isRoot) {
    if (
      !session.applicationId ||
      provider.applicationId === null ||
      provider.applicationId !== session.applicationId
    ) {
      throw new AppError(
        403,
        "APPLICATION_SCOPE_DENIED",
        "Storage provider access is not allowed",
      );
    }
  }

  return { session, provider };
}

export const GET = withApiHandler(async (_request: Request, context: Context) => {
  const { providerId } = await context.params;
  const { provider } = await requireProviderScope(providerId, "settings.view");
  return NextResponse.json({
    success: true,
    data: { provider: toAttachmentStorageProviderDto(provider) },
  });
});

export const PATCH = withApiHandler(async (request: Request, context: Context) => {
  const { providerId } = await context.params;
  const { session, provider: before } = await requireProviderScope(
    providerId,
    "settings.manage",
  );
  if (!session.isRoot) {
    throw new AppError(
      403,
      "ATTACHMENT_STORAGE_ROOT_REQUIRED",
      "Only ROOT can create or change storage infrastructure",
    );
  }
  const patch = patchSchema.parse(await request.json());
  const provider = await updateAttachmentStorageProviderConfig(
    providerId,
    patch,
  );

  await writeAuditLog({
    session,
    applicationId: before.applicationId,
    action: "ATTACHMENT_STORAGE_PROVIDER_UPDATED",
    entityType: "StorageProviderConfig",
    entityId: providerId,
    beforeData: toAttachmentStorageProviderDto(before),
    afterData: provider,
  });

  return NextResponse.json({ success: true, data: { provider } });
});

export const DELETE = withApiHandler(async (_request: Request, context: Context) => {
  const { providerId } = await context.params;
  const { session, provider: before } = await requireProviderScope(
    providerId,
    "settings.manage",
  );
  if (!session.isRoot) {
    throw new AppError(
      403,
      "ATTACHMENT_STORAGE_ROOT_REQUIRED",
      "Only ROOT can create or change storage infrastructure",
    );
  }
  const provider = await disableAttachmentStorageProvider(providerId);

  await writeAuditLog({
    session,
    applicationId: before.applicationId,
    action: "ATTACHMENT_STORAGE_PROVIDER_DISABLED",
    entityType: "StorageProviderConfig",
    entityId: providerId,
    beforeData: toAttachmentStorageProviderDto(before),
    afterData: provider,
  });

  return NextResponse.json({ success: true, data: { provider } });
});

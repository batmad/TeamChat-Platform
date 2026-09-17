import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import {
  createAttachmentStorageProviderConfig,
  listAttachmentStorageProviders,
} from "@/lib/attachments/storage/management";
import { requireApiPermission } from "@/lib/rbac/guards";

const createSchema = z.object({
  key: z.string().trim().min(3).max(160),
  applicationId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(2).max(160),
  type: z.enum(["LOCAL", "S3", "MINIO"]),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  config: z.unknown(),
  credentials: z
    .object({
      accessKeyId: z.string().min(1),
      secretAccessKey: z.string().min(1),
      sessionToken: z.string().min(1).optional(),
    })
    .nullable()
    .optional(),
});

export const GET = withApiHandler(async (request: Request) => {
  const session = await requireApiPermission("settings.view");
  const url = new URL(request.url);

  if (session.isRoot) {
    const scope = url.searchParams.get("scope");
    const applicationId = url.searchParams.get("applicationId");
    const providers =
      scope === "global"
        ? await listAttachmentStorageProviders({
            applicationId: null,
            includeGlobal: false,
          })
        : applicationId
          ? await listAttachmentStorageProviders({
              applicationId,
              includeGlobal: true,
            })
          : await listAttachmentStorageProviders({});
    return NextResponse.json({ success: true, data: { providers } });
  }

  if (!session.applicationId) {
    throw new AppError(
      403,
      "APPLICATION_SCOPE_REQUIRED",
      "Application scope is required",
    );
  }

  const providers = await listAttachmentStorageProviders({
    applicationId: session.applicationId,
    includeGlobal: true,
  });
  return NextResponse.json({ success: true, data: { providers } });
});

export const POST = withApiHandler(async (request: Request) => {
  const session = await requireApiPermission("settings.manage");
  if (!session.isRoot) {
    throw new AppError(
      403,
      "ATTACHMENT_STORAGE_ROOT_REQUIRED",
      "Only ROOT can create or change storage infrastructure",
    );
  }
  const body = createSchema.parse(await request.json());
  const applicationId = body.applicationId ?? null;

  const provider = await createAttachmentStorageProviderConfig({
    ...body,
    applicationId,
  });

  await writeAuditLog({
    session,
    applicationId,
    action: "ATTACHMENT_STORAGE_PROVIDER_CREATED",
    entityType: "StorageProviderConfig",
    entityId: provider.id,
    afterData: provider,
  });

  return NextResponse.json(
    { success: true, data: { provider } },
    { status: 201 },
  );
});

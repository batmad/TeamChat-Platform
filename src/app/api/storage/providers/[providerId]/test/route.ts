import { NextResponse } from "next/server";

import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAttachmentStorageConfigById } from "@/lib/attachments/storage/resolver";
import { testAttachmentStorageConnection } from "@/lib/attachments/storage/test-connection";
import { requireApiPermission } from "@/lib/rbac/guards";

export const runtime = "nodejs";

type Context = { params: Promise<{ providerId: string }> };

export const POST = withApiHandler(async (_request: Request, context: Context) => {
  const { providerId } = await context.params;
  const session = await requireApiPermission("settings.manage");
  if (!session.isRoot) {
    throw new AppError(
      403,
      "ATTACHMENT_STORAGE_ROOT_REQUIRED",
      "Only ROOT can test storage infrastructure",
    );
  }
  const provider = await getAttachmentStorageConfigById(providerId);
  const result = await testAttachmentStorageConnection(provider);

  await writeAuditLog({
    session,
    applicationId: provider.applicationId,
    action: result.ok
      ? "ATTACHMENT_STORAGE_PROVIDER_TEST_SUCCEEDED"
      : "ATTACHMENT_STORAGE_PROVIDER_TEST_FAILED",
    entityType: "StorageProviderConfig",
    entityId: provider.id,
    metadata: {
      providerType: provider.type,
      ok: result.ok,
      message: result.ok ? null : result.message,
    },
  });

  if (!result.ok) {
    throw new AppError(
      503,
      "ATTACHMENT_STORAGE_TEST_FAILED",
      "Attachment storage provider test failed",
      { message: result.message },
    );
  }

  return NextResponse.json({ success: true, data: { result } });
});

import { NextResponse } from "next/server";

import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import {
  attachmentFileTypesBatchSchema,
  getAttachmentAdminSettings,
  upsertAttachmentFileTypes,
} from "@/lib/attachments/admin/settings";
import { writeAuditLog } from "@/lib/audit/audit";
import { requireApiPermission } from "@/lib/rbac/guards";

export const PUT = withApiHandler(async (request: Request) => {
  const session = await requireApiPermission("settings.manage");
  const parsed = attachmentFileTypesBatchSchema.parse(await request.json());
  const applicationId = session.isRoot ? parsed.applicationId : session.applicationId;

  if (!session.isRoot && !applicationId) {
    throw new AppError(403, "APPLICATION_SCOPE_REQUIRED", "Application scope is required");
  }
  if (!session.isRoot && parsed.applicationId !== applicationId) {
    throw new AppError(403, "APPLICATION_SCOPE_DENIED", "Application access is not allowed");
  }

  const before = await getAttachmentAdminSettings(applicationId ?? null);
  const fileTypes = await upsertAttachmentFileTypes({ ...parsed, applicationId: applicationId ?? null });
  const after = await getAttachmentAdminSettings(applicationId ?? null);

  await writeAuditLog({
    session,
    applicationId: applicationId ?? null,
    action: "ATTACHMENT_FILE_TYPES_UPDATED",
    entityType: "AttachmentFileType",
    entityId: applicationId ?? "GLOBAL",
    beforeData: before.fileTypes,
    afterData: after.fileTypes,
  });

  return NextResponse.json({ success: true, data: { fileTypes } });
});

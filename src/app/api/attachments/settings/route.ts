import { NextResponse } from "next/server";

import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import {
  getAttachmentAdminSettings,
  updateAttachmentAdminPolicy,
} from "@/lib/attachments/admin/settings";
import { writeAuditLog } from "@/lib/audit/audit";
import { requireApiPermission } from "@/lib/rbac/guards";

function resolveScope(session: Awaited<ReturnType<typeof requireApiPermission>>, request: Request) {
  const applicationId = new URL(request.url).searchParams.get("applicationId");
  if (session.isRoot) return applicationId || null;
  if (!session.applicationId) {
    throw new AppError(403, "APPLICATION_SCOPE_REQUIRED", "Application scope is required");
  }
  if (applicationId && applicationId !== session.applicationId) {
    throw new AppError(403, "APPLICATION_SCOPE_DENIED", "Application access is not allowed");
  }
  return session.applicationId;
}

export const GET = withApiHandler(async (request: Request) => {
  const session = await requireApiPermission("settings.view");
  const applicationId = resolveScope(session, request);
  const settings = await getAttachmentAdminSettings(applicationId);
  return NextResponse.json({ success: true, data: settings });
});

export const PATCH = withApiHandler(async (request: Request) => {
  const session = await requireApiPermission("settings.manage");
  const body = (await request.json()) as Record<string, unknown>;
  const applicationId = session.isRoot
    ? typeof body.applicationId === "string"
      ? body.applicationId
      : null
    : session.applicationId;

  if (!session.isRoot && !applicationId) {
    throw new AppError(403, "APPLICATION_SCOPE_REQUIRED", "Application scope is required");
  }
  if (!session.isRoot && body.applicationId && body.applicationId !== applicationId) {
    throw new AppError(403, "APPLICATION_SCOPE_DENIED", "Application access is not allowed");
  }

  const before = await getAttachmentAdminSettings(applicationId ?? null);
  const policy = await updateAttachmentAdminPolicy({ ...body, applicationId: applicationId ?? null });
  const after = await getAttachmentAdminSettings(applicationId ?? null);

  await writeAuditLog({
    session,
    applicationId: applicationId ?? null,
    action: "ATTACHMENT_POLICY_UPDATED",
    entityType: "AttachmentPolicy",
    entityId: String((policy as { id?: string }).id ?? applicationId ?? "GLOBAL"),
    beforeData: before,
    afterData: after,
  });

  return NextResponse.json({ success: true, data: after });
});

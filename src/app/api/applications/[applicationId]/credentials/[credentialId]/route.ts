import { NextResponse } from "next/server";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { requireApiPermission } from "@/lib/rbac/guards";

type Context = { params: Promise<{ applicationId: string; credentialId: string }> };

export const DELETE = withApiHandler(async (_request, context: Context) => {
  const { applicationId, credentialId } = await context.params;
  const session = await requireApiPermission("applications.manage", applicationId);

  const credential = await prisma.applicationCredential.findFirst({
    where: { id: credentialId, applicationId },
    select: { id: true, keyId: true, name: true, isActive: true },
  });
  if (!credential) throw new AppError(404, "APPLICATION_CREDENTIAL_NOT_FOUND", "Application credential was not found");

  await prisma.applicationCredential.update({
    where: { id: credential.id },
    data: { isActive: false },
  });

  await writeAuditLog({
    session,
    applicationId,
    action: "APPLICATION_CREDENTIAL_REVOKED",
    entityType: "ApplicationCredential",
    entityId: credential.id,
    beforeData: credential,
    afterData: { ...credential, isActive: false },
  });

  return NextResponse.json({ success: true, data: { revoked: true } });
});

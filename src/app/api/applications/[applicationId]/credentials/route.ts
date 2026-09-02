import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { createApplicationCredential } from "@/lib/application-credentials/service";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { requireApiPermission } from "@/lib/rbac/guards";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  expiresAt: z.iso.datetime().optional().nullable(),
});

type Context = { params: Promise<{ applicationId: string }> };

export const GET = withApiHandler(async (_request, context: Context) => {
  const { applicationId } = await context.params;
  await requireApiPermission("applications.view", applicationId);

  const credentials = await prisma.applicationCredential.findMany({
    where: { applicationId },
    select: {
      id: true,
      keyId: true,
      name: true,
      isActive: true,
      expiresAt: true,
      lastUsedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ success: true, data: { credentials } });
});

export const POST = withApiHandler(async (request, context: Context) => {
  const { applicationId } = await context.params;
  const session = await requireApiPermission("applications.manage", applicationId);
  const body = createSchema.parse(await request.json());

  const result = await createApplicationCredential({
    applicationId,
    name: body.name,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
  });

  await writeAuditLog({
    session,
    applicationId,
    action: "APPLICATION_CREDENTIAL_CREATED",
    entityType: "ApplicationCredential",
    entityId: result.credential.id,
    afterData: {
      keyId: result.credential.keyId,
      name: result.credential.name,
      expiresAt: result.credential.expiresAt,
    },
  });

  return NextResponse.json(
    {
      success: true,
      data: {
        ...result,
        warning: "The signing secret is shown only once. Store it securely in the host application.",
      },
    },
    { status: 201 },
  );
});

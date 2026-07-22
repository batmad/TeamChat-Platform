import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/api/app-error";
import { normalizeAllowedOrigins } from "@/lib/applications/origins";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { requireApiPermission, requireApiRoot } from "@/lib/rbac/guards";

type Context = { params: Promise<{ applicationId: string }> };

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  allowedOrigins: z.array(z.string().trim().min(1)).max(30).optional(),
});

async function getApplication(applicationId: string) {
  return prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      widgetConfig: true,
      integrations: {
        select: { id: true, name: true, type: true, status: true, isDefaultUserSource: true },
        orderBy: { name: "asc" },
      },
      retentionPolicies: {
        where: { isActive: true },
        orderBy: [{ dataType: "asc" }, { category: "asc" }],
      },
    },
  });
}

export const GET = withApiHandler(async (_request, context: Context) => {
  const { applicationId } = await context.params;
  await requireApiPermission("applications.view", applicationId);
  const application = await getApplication(applicationId);
  if (!application) throw new AppError(404, "APPLICATION_NOT_FOUND", "Application was not found");
  return NextResponse.json({ success: true, data: { application } });
});

export const PATCH = withApiHandler(async (request, context: Context) => {
  const { applicationId } = await context.params;
  const session = await requireApiPermission("applications.manage", applicationId);
  const body = updateSchema.parse(await request.json());

  const existing = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!existing) throw new AppError(404, "APPLICATION_NOT_FOUND", "Application was not found");

  const application = await prisma.application.update({
    where: { id: applicationId },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.allowedOrigins !== undefined ? { allowedOrigins: normalizeAllowedOrigins(body.allowedOrigins) } : {}),
    },
  });

  await writeAuditLog({
    session,
    applicationId,
    action: "APPLICATION_UPDATED",
    entityType: "Application",
    entityId: applicationId,
    beforeData: existing,
    afterData: application,
  });

  return NextResponse.json({ success: true, data: { application } });
});

export const DELETE = withApiHandler(async (_request, context: Context) => {
  const { applicationId } = await context.params;
  const session = await requireApiRoot();
  const existing = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!existing) throw new AppError(404, "APPLICATION_NOT_FOUND", "Application was not found");

  const [integrations, users, roles, groups, rooms, messages] = await Promise.all([
    prisma.integrationConfig.count({ where: { applicationId } }),
    prisma.userIdentity.count({ where: { applicationId } }),
    prisma.role.count({ where: { applicationId } }),
    prisma.group.count({ where: { applicationId } }),
    prisma.room.count({ where: { applicationId } }),
    prisma.message.count({ where: { applicationId } }),
  ]);

  if (integrations + users + roles + groups + rooms + messages > 0) {
    throw new AppError(
      409,
      "APPLICATION_HAS_DATA",
      "Application already contains business data. Set it to INACTIVE instead of deleting it.",
      { integrations, users, roles, groups, rooms, messages },
    );
  }

  await prisma.application.delete({ where: { id: applicationId } });

  await writeAuditLog({
    session,
    applicationId: null,
    action: "APPLICATION_DELETED",
    entityType: "Application",
    entityId: applicationId,
    beforeData: existing,
    metadata: { deletedApplicationId: applicationId },
  });

  return NextResponse.json({ success: true });
});

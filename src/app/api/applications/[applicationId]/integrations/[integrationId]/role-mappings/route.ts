import { NextResponse } from "next/server";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { roleMappingsSchema } from "@/lib/integrations/schemas";
import { requireApiPermission } from "@/lib/rbac/guards";

type Context = { params: Promise<{ applicationId: string; integrationId: string }> };

export const PUT = withApiHandler(async (request, context: Context) => {
  const { applicationId, integrationId } = await context.params;
  const session = await requireApiPermission("integrations.manage", applicationId);
  const body = roleMappingsSchema.parse(await request.json());
  const uniqueRoles = new Set(body.mappings.map((mapping) => mapping.sourceRole));
  if (uniqueRoles.size !== body.mappings.length) {
    throw new AppError(400, "DUPLICATE_SOURCE_ROLE", "Each source role can only be mapped once");
  }

  const [integration, roles] = await Promise.all([
    prisma.integrationConfig.findFirst({ where: { id: integrationId, applicationId }, select: { id: true } }),
    body.mappings.length
      ? prisma.role.findMany({
          where: { applicationId, id: { in: body.mappings.map((mapping) => mapping.roleId) }, isActive: true },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);
  if (!integration) throw new AppError(404, "INTEGRATION_NOT_FOUND", "Integration was not found");
  if (roles.length !== new Set(body.mappings.map((mapping) => mapping.roleId)).size) {
    throw new AppError(400, "INVALID_ROLE_MAPPING", "One or more mapped roles are invalid for this application");
  }

  const before = await prisma.integrationRoleMapping.findMany({ where: { integrationId } });
  await prisma.$transaction(async (tx) => {
    await tx.integrationRoleMapping.deleteMany({ where: { integrationId } });
    if (body.mappings.length) {
      await tx.integrationRoleMapping.createMany({ data: body.mappings.map((mapping) => ({ integrationId, ...mapping })) });
    }
  });
  const mappings = await prisma.integrationRoleMapping.findMany({
    where: { integrationId },
    orderBy: { sourceRole: "asc" },
    include: { role: { select: { id: true, code: true, name: true, isActive: true } } },
  });

  await writeAuditLog({
    session,
    applicationId,
    action: "INTEGRATION_ROLE_MAPPINGS_UPDATED",
    entityType: "IntegrationConfig",
    entityId: integrationId,
    beforeData: before,
    afterData: mappings,
  });
  return NextResponse.json({ success: true, data: { mappings } });
});

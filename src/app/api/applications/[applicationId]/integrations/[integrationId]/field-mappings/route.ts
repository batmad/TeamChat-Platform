import { NextResponse } from "next/server";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { validateMappingDefinition } from "@/lib/integrations/field-mapping";
import { getIntegrationRuntime } from "@/lib/integrations/repository";
import { fieldMappingsSchema } from "@/lib/integrations/schemas";
import { validateIntegrationFieldMappings } from "@/lib/integrations/service";
import { requireApiPermission } from "@/lib/rbac/guards";

 type Context = { params: Promise<{ applicationId: string; integrationId: string }> };

export const PUT = withApiHandler(async (request, context: Context) => {
  const { applicationId, integrationId } = await context.params;
  const session = await requireApiPermission("integrations.manage", applicationId);
  await requireApiPermission("integrations.test", applicationId);
  const body = fieldMappingsSchema.parse(await request.json());
  validateMappingDefinition(body.mappings);

  const integration = await prisma.integrationConfig.findFirst({
    where: { id: integrationId, applicationId },
    select: { id: true, status: true, mappingRevision: true },
  });
  if (!integration) throw new AppError(404, "INTEGRATION_NOT_FOUND", "Integration was not found");

  const runtime = await getIntegrationRuntime(applicationId, integrationId);
  await validateIntegrationFieldMappings(runtime, body.mappings, { lookupValue: body.lookupValue });

  const before = await prisma.integrationFieldMapping.findMany({ where: { integrationId }, orderBy: { targetField: "asc" } });
  await prisma.$transaction(async (tx) => {
    await tx.integrationFieldMapping.deleteMany({ where: { integrationId } });
    await tx.integrationFieldMapping.createMany({
      data: body.mappings.map((mapping) => ({
        integrationId,
        ...mapping,
        defaultValue: mapping.defaultValue ?? null,
      })),
    });
    await tx.integrationConfig.update({
      where: { id: integrationId },
      data: {
        mappingRevision: { increment: 1 },
        previewedMappingRevision: null,
        lastMappingPreviewAt: null,
        ...(integration.status === "ACTIVE" ? { status: "DRAFT" } : {}),
      },
    });
  });

  const [mappings, updatedIntegration] = await Promise.all([
    prisma.integrationFieldMapping.findMany({ where: { integrationId }, orderBy: { targetField: "asc" } }),
    prisma.integrationConfig.findUnique({
      where: { id: integrationId },
      select: { mappingRevision: true, previewedMappingRevision: true, lastMappingPreviewAt: true, status: true },
    }),
  ]);

  await writeAuditLog({
    session,
    applicationId,
    action: "INTEGRATION_FIELD_MAPPINGS_UPDATED",
    entityType: "IntegrationConfig",
    entityId: integrationId,
    beforeData: before,
    afterData: {
      mappings,
      mappingRevision: updatedIntegration?.mappingRevision,
      previewedMappingRevision: updatedIntegration?.previewedMappingRevision,
      status: updatedIntegration?.status,
    },
  });

  return NextResponse.json({
    success: true,
    data: {
      mappings,
      mappingRevision: updatedIntegration?.mappingRevision ?? integration.mappingRevision + 1,
      previewRequired: true,
      status: updatedIntegration?.status ?? integration.status,
    },
  });
});

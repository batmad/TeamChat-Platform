import { NextResponse } from "next/server";
import { getRequestId } from "@/lib/api/request-id";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { prisma } from "@/lib/db/prisma";
import { writeIntegrationLog } from "@/lib/integrations/logging";
import { getIntegrationRuntime } from "@/lib/integrations/repository";
import { fieldMappingPreviewSchema } from "@/lib/integrations/schemas";
import { previewIntegrationUsers } from "@/lib/integrations/service";
import { requireApiPermission } from "@/lib/rbac/guards";

 type Context = { params: Promise<{ applicationId: string; integrationId: string }> };

export const POST = withApiHandler(async (request, context: Context) => {
  const { applicationId, integrationId } = await context.params;
  await requireApiPermission("integrations.test", applicationId);
  const body = fieldMappingPreviewSchema.parse(await request.json());
  const integration = await getIntegrationRuntime(applicationId, integrationId);
  const users = await previewIntegrationUsers(integration, body);

  let persistedPreview = false;
  let previewedMappingRevision: number | null = null;
  let lastMappingPreviewAt: Date | null = null;

  if (!body.mappings) {
    const current = await prisma.integrationConfig.findFirst({
      where: { id: integrationId, applicationId },
      select: { mappingRevision: true },
    });
    if (current) {
      lastMappingPreviewAt = new Date();
      previewedMappingRevision = current.mappingRevision;
      await prisma.integrationConfig.update({
        where: { id: integrationId },
        data: {
          previewedMappingRevision: current.mappingRevision,
          lastMappingPreviewAt,
        },
      });
      persistedPreview = true;
    }
  }

  await writeIntegrationLog({
    applicationId,
    requestId: getRequestId(request),
    integrationType: integration.type,
    level: "INFO",
    action: "INTEGRATION_PREVIEW",
    message: "Integration user preview generated",
    metadata: {
      integrationId,
      resultCount: users.length,
      persistedPreview,
      previewedMappingRevision,
    },
  });

  return NextResponse.json({
    success: true,
    data: {
      users,
      preview: {
        persisted: persistedPreview,
        previewedMappingRevision,
        lastMappingPreviewAt,
      },
    },
  });
});

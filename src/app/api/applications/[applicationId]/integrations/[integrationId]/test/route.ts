import { NextResponse } from "next/server";
import { getRequestId } from "@/lib/api/request-id";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { writeIntegrationLog } from "@/lib/integrations/logging";
import { getIntegrationRuntime } from "@/lib/integrations/repository";
import { testIntegrationRuntime } from "@/lib/integrations/service";
import { requireApiPermission } from "@/lib/rbac/guards";

type Context = { params: Promise<{ applicationId: string; integrationId: string }> };

export const POST = withApiHandler(async (request, context: Context) => {
  const { applicationId, integrationId } = await context.params;
  const session = await requireApiPermission("integrations.test", applicationId);
  const requestId = getRequestId(request);
  const integration = await getIntegrationRuntime(applicationId, integrationId);
  const startedAt = performance.now();

  try {
    await testIntegrationRuntime(integration);
    const now = new Date();
    await prisma.integrationConfig.update({
      where: { id: integrationId },
      data: {
        lastTestedAt: now,
        lastSuccessAt: now,
        status: integration.status === "ACTIVE" ? "ACTIVE" : integration.status === "INACTIVE" ? "INACTIVE" : "DRAFT",
      },
    });
    await writeIntegrationLog({
      applicationId,
      requestId,
      integrationType: integration.type,
      level: "INFO",
      action: "INTEGRATION_TEST_SUCCESS",
      message: "Integration connection test succeeded",
      metadata: { integrationId, durationMs: Math.round(performance.now() - startedAt) },
    });
    await writeAuditLog({
      session,
      applicationId,
      action: "INTEGRATION_TESTED",
      entityType: "IntegrationConfig",
      entityId: integrationId,
      metadata: { result: "SUCCESS" },
    });
    return NextResponse.json({ success: true, data: { connected: true, durationMs: Math.round(performance.now() - startedAt) } });
  } catch (error) {
    const now = new Date();
    await prisma.integrationConfig.update({
      where: { id: integrationId },
      data: { lastTestedAt: now, lastErrorAt: now, status: "ERROR" },
    });
    await writeIntegrationLog({
      applicationId,
      requestId,
      integrationType: integration.type,
      level: "ERROR",
      action: "INTEGRATION_TEST_FAILED",
      message: error instanceof Error ? error.message : "Integration connection test failed",
      metadata: { integrationId, durationMs: Math.round(performance.now() - startedAt) },
    });
    throw error;
  }
});

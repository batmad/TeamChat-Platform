import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestId } from "@/lib/api/request-id";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeIntegrationLog } from "@/lib/integrations/logging";
import { getIntegrationRuntime } from "@/lib/integrations/repository";
import { validateIntegrationUser } from "@/lib/integrations/service";
import { requireApiPermission } from "@/lib/rbac/guards";

type Context = { params: Promise<{ applicationId: string; integrationId: string }> };
const schema = z.object({ username: z.string().trim().min(1).max(500) });

export const POST = withApiHandler(async (request, context: Context) => {
  const { applicationId, integrationId } = await context.params;
  await requireApiPermission("integrations.test", applicationId);
  const body = schema.parse(await request.json());
  const integration = await getIntegrationRuntime(applicationId, integrationId);
  const result = await validateIntegrationUser(integration, body.username);
  await writeIntegrationLog({
    applicationId,
    requestId: getRequestId(request),
    integrationType: integration.type,
    level: result.valid ? "INFO" : "WARN",
    action: "INTEGRATION_USER_VALIDATION",
    message: result.valid ? "External user validation succeeded" : "External user was not found",
    username: body.username,
    metadata: { integrationId, valid: result.valid, mappedRole: result.user?.mappedRole?.code ?? null },
  });
  return NextResponse.json({ success: true, data: result });
});

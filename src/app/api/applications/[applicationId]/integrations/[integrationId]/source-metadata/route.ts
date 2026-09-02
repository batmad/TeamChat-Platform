import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { getIntegrationRuntime } from "@/lib/integrations/repository";
import { readIntegrationSourceMetadata } from "@/lib/integrations/service";
import { requireApiPermission } from "@/lib/rbac/guards";

type Context = { params: Promise<{ applicationId: string; integrationId: string }> };

export const GET = withApiHandler(async (request, context: Context) => {
  const { applicationId, integrationId } = await context.params;
  await requireApiPermission("integrations.test", applicationId);
  const integration = await getIntegrationRuntime(applicationId, integrationId);
  const url = new URL(request.url);
  const data = await readIntegrationSourceMetadata(integration, {
    table: url.searchParams.get("table"),
    lookupValue: url.searchParams.get("lookupValue"),
  });
  return NextResponse.json({ success: true, data });
});

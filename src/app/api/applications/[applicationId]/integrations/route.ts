import { NextResponse } from "next/server";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { validateApiSecretForAuth } from "@/lib/integrations/config-helpers";
import { encryptIntegrationSecret } from "@/lib/integrations/crypto";
import { buildMappingReadiness } from "@/lib/integrations/field-mapping";
import { createIntegrationSchema } from "@/lib/integrations/schemas";
import { requireApiPermission } from "@/lib/rbac/guards";

type Context = { params: Promise<{ applicationId: string }> };

type IntegrationListRow = {
  id: string;
  applicationId: string;
  name: string;
  type: "DATABASE" | "API";
  status: "DRAFT" | "ACTIVE" | "INACTIVE" | "ERROR";
  timeoutMs: number;
  isDefaultUserSource: boolean;
  lastTestedAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  mappingRevision: number;
  previewedMappingRevision: number | null;
  lastMappingPreviewAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  databaseConfig: { databaseType: string; host: string; port: number; databaseName: string; userTable: string | null } | null;
  apiConfig: { baseUrl: string; endpoint: string; authenticationMode: string } | null;
  fieldMappings: Array<{ targetField: string }>;
  _count: { fieldMappings: number; roleMappings: number };
};

export const GET = withApiHandler(async (_request, context: Context) => {
  const { applicationId } = await context.params;
  await requireApiPermission("integrations.view", applicationId);

  const integrations = await prisma.integrationConfig.findMany({
    where: { applicationId },
    orderBy: { name: "asc" },
    include: {
      databaseConfig: { select: { databaseType: true, host: true, port: true, databaseName: true, userTable: true } },
      apiConfig: { select: { baseUrl: true, endpoint: true, authenticationMode: true } },
      fieldMappings: { select: { targetField: true } },
      _count: { select: { fieldMappings: true, roleMappings: true } },
    },
  });

  const safe = (integrations as unknown as IntegrationListRow[]).map((integration) => ({
    id: integration.id,
    applicationId: integration.applicationId,
    name: integration.name,
    type: integration.type,
    status: integration.status,
    timeoutMs: integration.timeoutMs,
    isDefaultUserSource: integration.isDefaultUserSource,
    lastTestedAt: integration.lastTestedAt,
    lastSuccessAt: integration.lastSuccessAt,
    lastErrorAt: integration.lastErrorAt,
    mappingRevision: integration.mappingRevision,
    previewedMappingRevision: integration.previewedMappingRevision,
    lastMappingPreviewAt: integration.lastMappingPreviewAt,
    mappingReadiness: buildMappingReadiness({
      mappings: integration.fieldMappings,
      mappingRevision: integration.mappingRevision,
      previewedMappingRevision: integration.previewedMappingRevision,
      lastMappingPreviewAt: integration.lastMappingPreviewAt,
    }),
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
    databaseConfig: integration.databaseConfig,
    apiConfig: integration.apiConfig,
    _count: integration._count,
  }));

  return NextResponse.json({ success: true, data: { integrations: safe } });
});

export const POST = withApiHandler(async (request, context: Context) => {
  const { applicationId } = await context.params;
  const session = await requireApiPermission("integrations.manage", applicationId);
  const body = createIntegrationSchema.parse(await request.json());

  const application = await prisma.application.findUnique({ where: { id: applicationId }, select: { id: true, status: true } });
  if (!application) throw new AppError(404, "APPLICATION_NOT_FOUND", "Application was not found");
  if (application.status !== "ACTIVE") throw new AppError(409, "APPLICATION_INACTIVE", "Integration cannot be created for an inactive application");

  if (body.type === "API") validateApiSecretForAuth(body.apiConfig, body.secret);
  const encryptedSecret = encryptIntegrationSecret(body.secret);

  const integration = await prisma.$transaction(async (tx) => {
    if (body.isDefaultUserSource) {
      await tx.integrationConfig.updateMany({ where: { applicationId, isDefaultUserSource: true }, data: { isDefaultUserSource: false } });
    }

    return tx.integrationConfig.create({
      data: {
        applicationId,
        name: body.name,
        type: body.type,
        timeoutMs: body.timeoutMs,
        isDefaultUserSource: body.isDefaultUserSource,
        status: "DRAFT",
        ...(body.type === "DATABASE"
          ? {
              databaseConfig: {
                create: {
                  databaseType: body.databaseConfig.databaseType,
                  host: body.databaseConfig.host,
                  port: body.databaseConfig.port,
                  databaseName: body.databaseConfig.databaseName,
                  username: body.databaseConfig.username,
                  passwordEncrypted: encryptedSecret,
                  schemaName: body.databaseConfig.schemaName ?? null,
                  sslMode: body.databaseConfig.sslMode,
                  userTable: body.databaseConfig.userTable ?? null,
                },
              },
            }
          : {
              apiConfig: {
                create: {
                  baseUrl: body.apiConfig.baseUrl,
                  endpoint: body.apiConfig.endpoint,
                  testEndpoint: body.apiConfig.testEndpoint ?? null,
                  authenticationMode: body.apiConfig.authenticationMode,
                  credentialEncrypted: body.apiConfig.authenticationMode === "NONE" ? null : encryptedSecret,
                  requestConfig: body.apiConfig.requestConfig as never,
                  responseMapping: body.apiConfig.responseMapping as never,
                },
              },
            }),
      },
      include: {
        databaseConfig: { select: { databaseType: true, host: true, port: true, databaseName: true, username: true, schemaName: true, sslMode: true, userTable: true } },
        apiConfig: { select: { baseUrl: true, endpoint: true, testEndpoint: true, authenticationMode: true, requestConfig: true, responseMapping: true } },
      },
    });
  });

  await writeAuditLog({
    session,
    applicationId,
    action: "INTEGRATION_CREATED",
    entityType: "IntegrationConfig",
    entityId: integration.id,
    afterData: {
      id: integration.id,
      name: integration.name,
      type: integration.type,
      status: integration.status,
      databaseConfig: integration.databaseConfig,
      apiConfig: integration.apiConfig,
      timeoutMs: integration.timeoutMs,
      isDefaultUserSource: integration.isDefaultUserSource,
    },
  });

  return NextResponse.json({ success: true, data: { integration } }, { status: 201 });
});

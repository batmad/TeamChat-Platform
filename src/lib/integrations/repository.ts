import "server-only";
import { AppError } from "@/lib/api/app-error";
import { prisma } from "@/lib/db/prisma";
import { apiSettingsToRuntime, databaseSettingsToRuntime } from "@/lib/integrations/config-helpers";
import { buildMappingReadiness } from "@/lib/integrations/field-mapping";
import type { IntegrationRuntimeRecord } from "@/lib/integrations/service";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function databaseSettings(row: Record<string, unknown>) {
  return {
    databaseType: row.databaseType,
    host: row.host,
    port: row.port,
    databaseName: row.databaseName,
    username: row.username,
    schemaName: row.schemaName ?? null,
    sslMode: row.sslMode,
    userTable: row.userTable ?? null,
  };
}

function apiSettings(row: Record<string, unknown>) {
  return {
    baseUrl: row.baseUrl,
    endpoint: row.endpoint,
    testEndpoint: row.testEndpoint ?? null,
    authenticationMode: row.authenticationMode,
    requestConfig: asRecord(row.requestConfig),
    responseMapping: asRecord(row.responseMapping),
  };
}

export async function getIntegrationRuntime(applicationId: string, integrationId: string): Promise<IntegrationRuntimeRecord> {
  const integration = await prisma.integrationConfig.findFirst({
    where: { id: integrationId, applicationId },
    include: {
      databaseConfig: true,
      apiConfig: true,
      fieldMappings: { orderBy: { targetField: "asc" } },
      roleMappings: {
        orderBy: { sourceRole: "asc" },
        include: { role: { select: { id: true, code: true, name: true, isActive: true } } },
      },
    },
  });
  if (!integration) throw new AppError(404, "INTEGRATION_NOT_FOUND", "Integration was not found");

  const source = integration as unknown as Record<string, unknown> & {
    databaseConfig?: Record<string, unknown> | null;
    apiConfig?: Record<string, unknown> | null;
    fieldMappings: IntegrationRuntimeRecord["fieldMappings"];
    roleMappings: IntegrationRuntimeRecord["roleMappings"];
  };

  if (source.type === "DATABASE") {
    if (!source.databaseConfig) throw new AppError(500, "DATABASE_CONFIG_MISSING", "Database integration configuration is missing");
    const settings = databaseSettings(source.databaseConfig);
    return {
      id: String(source.id),
      applicationId: String(source.applicationId),
      type: "DATABASE",
      status: source.status as IntegrationRuntimeRecord["status"],
      databaseType: settings.databaseType as IntegrationRuntimeRecord["databaseType"],
      config: databaseSettingsToRuntime(settings),
      secretEncrypted: (source.databaseConfig.passwordEncrypted as string | null | undefined) ?? null,
      timeoutMs: Number(source.timeoutMs),
      fieldMappings: source.fieldMappings,
      roleMappings: source.roleMappings,
    };
  }

  if (!source.apiConfig) throw new AppError(500, "API_CONFIG_MISSING", "API integration configuration is missing");
  const settings = apiSettings(source.apiConfig);
  return {
    id: String(source.id),
    applicationId: String(source.applicationId),
    type: "API",
    status: source.status as IntegrationRuntimeRecord["status"],
    databaseType: null,
    config: apiSettingsToRuntime(settings),
    secretEncrypted: (source.apiConfig.credentialEncrypted as string | null | undefined) ?? null,
    timeoutMs: Number(source.timeoutMs),
    fieldMappings: source.fieldMappings,
    roleMappings: source.roleMappings,
  };
}

export async function getIntegrationDetail(applicationId: string, integrationId: string) {
  const integration = await prisma.integrationConfig.findFirst({
    where: { id: integrationId, applicationId },
    include: {
      databaseConfig: true,
      apiConfig: true,
      fieldMappings: { orderBy: { targetField: "asc" } },
      roleMappings: {
        orderBy: { sourceRole: "asc" },
        select: { id: true, sourceRole: true, role: { select: { id: true, code: true, name: true, isActive: true } } },
      },
    },
  });
  if (!integration) throw new AppError(404, "INTEGRATION_NOT_FOUND", "Integration was not found");

  const source = integration as unknown as Record<string, unknown> & {
    databaseConfig?: Record<string, unknown> | null;
    apiConfig?: Record<string, unknown> | null;
  };

  const mappingReadiness = buildMappingReadiness({
    mappings: source.fieldMappings as Array<{ targetField: string }>,
    mappingRevision: Number(source.mappingRevision ?? 0),
    previewedMappingRevision: source.previewedMappingRevision == null ? null : Number(source.previewedMappingRevision),
    lastMappingPreviewAt: (source.lastMappingPreviewAt as Date | string | null | undefined) ?? null,
  });

  return {
    id: source.id,
    applicationId: source.applicationId,
    name: source.name,
    type: source.type,
    status: source.status,
    timeoutMs: source.timeoutMs,
    isDefaultUserSource: source.isDefaultUserSource,
    mappingRevision: mappingReadiness.mappingRevision,
    previewedMappingRevision: mappingReadiness.previewedMappingRevision,
    lastMappingPreviewAt: mappingReadiness.lastMappingPreviewAt,
    mappingReadiness,
    lastTestedAt: source.lastTestedAt,
    lastSuccessAt: source.lastSuccessAt,
    lastErrorAt: source.lastErrorAt,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    databaseConfig: source.databaseConfig ? {
      ...databaseSettings(source.databaseConfig),
      hasPassword: Boolean(source.databaseConfig.passwordEncrypted),
    } : null,
    apiConfig: source.apiConfig ? {
      ...apiSettings(source.apiConfig),
      hasCredential: Boolean(source.apiConfig.credentialEncrypted),
    } : null,
    fieldMappings: source.fieldMappings,
    roleMappings: source.roleMappings,
  };
}

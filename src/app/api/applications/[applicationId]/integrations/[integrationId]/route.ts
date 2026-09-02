import { NextResponse } from "next/server";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { validateApiSecretForAuth } from "@/lib/integrations/config-helpers";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "@/lib/integrations/crypto";
import { getIntegrationDetail } from "@/lib/integrations/repository";
import { buildMappingReadiness } from "@/lib/integrations/field-mapping";
import { apiSecretSchema, databaseSecretSchema, updateIntegrationSchema } from "@/lib/integrations/schemas";
import { requireApiPermission } from "@/lib/rbac/guards";

type Context = { params: Promise<{ applicationId: string; integrationId: string }> };

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function sameConfiguration(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

export const GET = withApiHandler(async (_request, context: Context) => {
  const { applicationId, integrationId } = await context.params;
  await requireApiPermission("integrations.view", applicationId);
  const integration = await getIntegrationDetail(applicationId, integrationId);
  return NextResponse.json({ success: true, data: { integration } });
});

export const PATCH = withApiHandler(async (request, context: Context) => {
  const { applicationId, integrationId } = await context.params;
  const session = await requireApiPermission("integrations.manage", applicationId);
  const body = updateIntegrationSchema.parse(await request.json());

  const existing = await prisma.integrationConfig.findFirst({
    where: { id: integrationId, applicationId },
    include: { databaseConfig: true, apiConfig: true, fieldMappings: true },
  });
  if (!existing) throw new AppError(404, "INTEGRATION_NOT_FOUND", "Integration was not found");
  if (existing.type === "DATABASE" && body.apiConfig) throw new AppError(400, "INTEGRATION_TYPE_MISMATCH", "API configuration cannot be applied to a database integration");
  if (existing.type === "API" && body.databaseConfig) throw new AppError(400, "INTEGRATION_TYPE_MISMATCH", "Database configuration cannot be applied to an API integration");

  const currentMappingReadiness = buildMappingReadiness({
    mappings: existing.fieldMappings,
    mappingRevision: existing.mappingRevision,
    previewedMappingRevision: existing.previewedMappingRevision,
    lastMappingPreviewAt: existing.lastMappingPreviewAt,
  });

  const sourceConfigurationChanged = existing.type === "DATABASE"
    ? body.databaseConfig !== undefined && !sameConfiguration({
        databaseType: existing.databaseConfig?.databaseType,
        host: existing.databaseConfig?.host,
        port: existing.databaseConfig?.port,
        databaseName: existing.databaseConfig?.databaseName,
        username: existing.databaseConfig?.username,
        schemaName: existing.databaseConfig?.schemaName ?? null,
        sslMode: existing.databaseConfig?.sslMode,
        userTable: existing.databaseConfig?.userTable ?? null,
      }, {
        databaseType: body.databaseConfig.databaseType,
        host: body.databaseConfig.host,
        port: body.databaseConfig.port,
        databaseName: body.databaseConfig.databaseName,
        username: body.databaseConfig.username,
        schemaName: body.databaseConfig.schemaName ?? null,
        sslMode: body.databaseConfig.sslMode,
        userTable: body.databaseConfig.userTable ?? null,
      })
    : body.apiConfig !== undefined && !sameConfiguration({
        baseUrl: existing.apiConfig?.baseUrl,
        endpoint: existing.apiConfig?.endpoint,
        testEndpoint: existing.apiConfig?.testEndpoint ?? null,
        authenticationMode: existing.apiConfig?.authenticationMode,
        requestConfig: existing.apiConfig?.requestConfig,
        responseMapping: existing.apiConfig?.responseMapping,
      }, {
        baseUrl: body.apiConfig.baseUrl,
        endpoint: body.apiConfig.endpoint,
        testEndpoint: body.apiConfig.testEndpoint ?? null,
        authenticationMode: body.apiConfig.authenticationMode,
        requestConfig: body.apiConfig.requestConfig,
        responseMapping: body.apiConfig.responseMapping,
      });

  if (body.status === "ACTIVE" && (sourceConfigurationChanged || !currentMappingReadiness.canActivate)) {
    throw new AppError(
      409,
      "INTEGRATION_MAPPING_PREVIEW_REQUIRED",
      sourceConfigurationChanged
        ? "Save source configuration, then preview the latest field mapping before activating the integration"
        : `Integration cannot be activated until all required mappings are configured and the current mapping revision has been previewed${currentMappingReadiness.missingTargets.length ? `; missing: ${currentMappingReadiness.missingTargets.join(", ")}` : ""}`,
    );
  }

  let nextEncryptedSecret: string | null | undefined;
  if (existing.type === "DATABASE") {
    if (!existing.databaseConfig) throw new AppError(500, "DATABASE_CONFIG_MISSING", "Database integration configuration is missing");
    if (body.secret !== undefined) {
      const parsed = databaseSecretSchema.parse(body.secret);
      nextEncryptedSecret = encryptIntegrationSecret(parsed);
    }
  } else {
    if (!existing.apiConfig) throw new AppError(500, "API_CONFIG_MISSING", "API integration configuration is missing");
    const nextApiConfig = body.apiConfig ?? {
      baseUrl: existing.apiConfig.baseUrl,
      endpoint: existing.apiConfig.endpoint,
      testEndpoint: existing.apiConfig.testEndpoint,
      authenticationMode: existing.apiConfig.authenticationMode,
      requestConfig: existing.apiConfig.requestConfig,
      responseMapping: existing.apiConfig.responseMapping,
    };
    const existingSecret = decryptIntegrationSecret<unknown>(existing.apiConfig.credentialEncrypted) ?? {};
    const nextSecret = body.secret !== undefined ? apiSecretSchema.parse(body.secret) : existingSecret;
    validateApiSecretForAuth(nextApiConfig, nextSecret);
    if (nextApiConfig.authenticationMode === "NONE") nextEncryptedSecret = null;
    else if (body.secret !== undefined) nextEncryptedSecret = encryptIntegrationSecret(nextSecret);
  }

  const beforeData = await getIntegrationDetail(applicationId, integrationId);

  await prisma.$transaction(async (tx) => {
    if (body.isDefaultUserSource === true) {
      await tx.integrationConfig.updateMany({
        where: { applicationId, isDefaultUserSource: true, id: { not: integrationId } },
        data: { isDefaultUserSource: false },
      });
    }

    await tx.integrationConfig.update({
      where: { id: integrationId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.status !== undefined
          ? { status: body.status }
          : sourceConfigurationChanged && existing.status === "ACTIVE"
            ? { status: "DRAFT" }
            : {}),
        ...(body.timeoutMs !== undefined ? { timeoutMs: body.timeoutMs } : {}),
        ...(body.isDefaultUserSource !== undefined ? { isDefaultUserSource: body.isDefaultUserSource } : {}),
        ...(sourceConfigurationChanged
          ? {
              mappingRevision: { increment: 1 },
              previewedMappingRevision: null,
              lastMappingPreviewAt: null,
            }
          : {}),
      },
    });

    if (existing.type === "DATABASE" && body.databaseConfig) {
      await tx.databaseIntegrationConfig.update({
        where: { integrationId },
        data: {
          databaseType: body.databaseConfig.databaseType,
          host: body.databaseConfig.host,
          port: body.databaseConfig.port,
          databaseName: body.databaseConfig.databaseName,
          username: body.databaseConfig.username,
          schemaName: body.databaseConfig.schemaName ?? null,
          sslMode: body.databaseConfig.sslMode,
          userTable: body.databaseConfig.userTable ?? null,
          ...(nextEncryptedSecret !== undefined ? { passwordEncrypted: nextEncryptedSecret } : {}),
        },
      });
    } else if (existing.type === "DATABASE" && nextEncryptedSecret !== undefined) {
      await tx.databaseIntegrationConfig.update({ where: { integrationId }, data: { passwordEncrypted: nextEncryptedSecret } });
    }

    if (existing.type === "API" && body.apiConfig) {
      await tx.apiIntegrationConfig.update({
        where: { integrationId },
        data: {
          baseUrl: body.apiConfig.baseUrl,
          endpoint: body.apiConfig.endpoint,
          testEndpoint: body.apiConfig.testEndpoint ?? null,
          authenticationMode: body.apiConfig.authenticationMode,
          requestConfig: body.apiConfig.requestConfig as never,
          responseMapping: body.apiConfig.responseMapping as never,
          ...(nextEncryptedSecret !== undefined ? { credentialEncrypted: nextEncryptedSecret } : {}),
        },
      });
    } else if (existing.type === "API" && nextEncryptedSecret !== undefined) {
      await tx.apiIntegrationConfig.update({ where: { integrationId }, data: { credentialEncrypted: nextEncryptedSecret } });
    }
  });

  const integration = await getIntegrationDetail(applicationId, integrationId);
  await writeAuditLog({
    session,
    applicationId,
    action: "INTEGRATION_UPDATED",
    entityType: "IntegrationConfig",
    entityId: integrationId,
    beforeData,
    afterData: integration,
  });

  return NextResponse.json({ success: true, data: { integration } });
});

export const DELETE = withApiHandler(async (_request, context: Context) => {
  const { applicationId, integrationId } = await context.params;
  const session = await requireApiPermission("integrations.manage", applicationId);
  const existing = await getIntegrationDetail(applicationId, integrationId);
  await prisma.integrationConfig.delete({ where: { id: integrationId } });
  await writeAuditLog({
    session,
    applicationId,
    action: "INTEGRATION_DELETED",
    entityType: "IntegrationConfig",
    entityId: integrationId,
    beforeData: existing,
  });
  return NextResponse.json({ success: true });
});

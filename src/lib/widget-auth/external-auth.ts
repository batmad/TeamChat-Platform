import "server-only";
import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/api/app-error";
import { prisma } from "@/lib/db/prisma";
import { synchronizeExternalGroups } from "@/lib/groups/synchronization";
import { resolveEffectiveUser } from "@/lib/users/effective-user";
import { buildMappingReadiness } from "@/lib/integrations/field-mapping";
import { getIntegrationRuntime } from "@/lib/integrations/repository";
import { validateIntegrationUser } from "@/lib/integrations/service";
import { createChatSessionToken } from "@/lib/widget-auth/chat-session";
import { getServerEnv } from "@/lib/env/server";
import { assertWidgetOriginAllowed } from "@/lib/widget-auth/origin";
import { verifyWidgetBootstrapToken } from "@/lib/widget-auth/bootstrap-token";

async function resolveUserIntegration(applicationId: string) {
  const integrations = await prisma.integrationConfig.findMany({
    where: { applicationId, status: "ACTIVE" },
    select: {
      id: true,
      type: true,
      isDefaultUserSource: true,
      mappingRevision: true,
      previewedMappingRevision: true,
      lastMappingPreviewAt: true,
      fieldMappings: { select: { targetField: true } },
    },
    orderBy: [{ isDefaultUserSource: "desc" }, { createdAt: "asc" }],
  });

  if (integrations.length === 0) {
    throw new AppError(409, "USER_INTEGRATION_UNAVAILABLE", "No active user integration is configured");
  }

  const defaults = integrations.filter((item: { isDefaultUserSource: boolean }) => item.isDefaultUserSource);
  if (defaults.length > 1) {
    throw new AppError(409, "MULTIPLE_DEFAULT_USER_INTEGRATIONS", "Multiple default user integrations are configured");
  }

  const selected = defaults[0] ?? (integrations.length === 1 ? integrations[0] : null);
  if (!selected) {
    throw new AppError(409, "DEFAULT_USER_INTEGRATION_REQUIRED", "Select a default user integration for this application");
  }

  const readiness = buildMappingReadiness({
    mappings: selected.fieldMappings,
    mappingRevision: selected.mappingRevision,
    previewedMappingRevision: selected.previewedMappingRevision,
    lastMappingPreviewAt: selected.lastMappingPreviewAt,
  });
  if (!readiness.canActivate) {
    throw new AppError(409, "USER_INTEGRATION_MAPPING_NOT_READY", "User integration mapping must be previewed and current");
  }

  return selected;
}

async function synchronizeExternalIdentity(input: {
  applicationId: string;
  integrationId: string;
  integrationType: "DATABASE" | "API";
  username: string;
  name: string;
  mappedRoleId: string;
  credentialKeyId: string;
  sessionReference: string;
}) {
  const now = new Date();

  const existing = await prisma.userIdentity.findUnique({
    where: {
      applicationId_username: {
        applicationId: input.applicationId,
        username: input.username,
      },
    },
    select: { id: true, source: true },
  });
  if (existing?.source === "INTERNAL") {
    throw new AppError(
      409,
      "EXTERNAL_USERNAME_CONFLICT",
      "This username is reserved by an internal user in the application",
    );
  }

  const identity = await prisma.userIdentity.upsert({
    where: {
      applicationId_username: {
        applicationId: input.applicationId,
        username: input.username,
      },
    },
    create: {
      applicationId: input.applicationId,
      username: input.username,
      source: input.integrationType,
      displayNameSnapshot: input.name,
      sourceReference: input.integrationId,
      isActive: true,
      lastSyncedAt: now,
    },
    update: {
      source: input.integrationType,
      displayNameSnapshot: input.name,
      sourceReference: input.integrationId,
      isActive: true,
      lastSyncedAt: now,
    },
    select: { id: true, source: true },
  });


  await prisma.userPresence.upsert({
    where: { userIdentityId: identity.id },
    create: {
      userIdentityId: identity.id,
      effectiveRoleId: input.mappedRoleId,
      status: "OFFLINE",
      connectionCount: 0,
      lastSeenAt: now,
      offlineAt: now,
      sessionReference: input.sessionReference,
      metadata: {
        authMethod: "SIGNED_BOOTSTRAP",
        integrationId: input.integrationId,
        credentialKeyId: input.credentialKeyId,
      },
    },
    update: {
      effectiveRoleId: input.mappedRoleId,
      lastSeenAt: now,
      sessionReference: input.sessionReference,
      metadata: {
        authMethod: "SIGNED_BOOTSTRAP",
        integrationId: input.integrationId,
        credentialKeyId: input.credentialKeyId,
      },
    },
  });

  return identity.id;
}

export async function exchangeExternalWidgetToken(input: {
  bootstrapToken: string;
  origin?: string | null;
}) {
  const bootstrap = await verifyWidgetBootstrapToken(input.bootstrapToken);
  assertWidgetOriginAllowed(bootstrap.application.allowedOrigins, input.origin ?? null);

  const integration = await resolveUserIntegration(bootstrap.application.id);
  const runtime = await getIntegrationRuntime(bootstrap.application.id, integration.id);
  const validation = await validateIntegrationUser(runtime, bootstrap.userIdentifier);

  if (!validation.valid) {
    throw new AppError(401, "EXTERNAL_USER_NOT_FOUND", "External user was not found");
  }
  if (!validation.readyForChat || !validation.standardUser || !validation.user?.mappedRole) {
    throw new AppError(403, "EXTERNAL_USER_NOT_READY", "External user mapping or role mapping is incomplete", {
      issues: validation.user?.normalizationIssues ?? [],
    });
  }

  const sessionReference = randomUUID();
  const identityId = await synchronizeExternalIdentity({
    applicationId: bootstrap.application.id,
    integrationId: integration.id,
    integrationType: integration.type,
    username: validation.standardUser.username,
    name: validation.standardUser.name,
    mappedRoleId: validation.user.mappedRole.id,
    credentialKeyId: bootstrap.credentialKeyId,
    sessionReference,
  });

  await synchronizeExternalGroups({
    applicationId: bootstrap.application.id,
    userIdentityId: identityId,
    externalGroupKeys: [validation.standardUser.group],
    primaryGroupKey: validation.standardUser.group,
  });

  const effectiveUser = await resolveEffectiveUser(identityId);
  const authorization = effectiveUser;
  if (!authorization || authorization.isAccessDisabled || !authorization.role) {
    throw new AppError(403, "EXTERNAL_USER_ACCESS_DENIED", "External user access is disabled or has no effective role");
  }

  const groups = effectiveUser.groups;

  const accessToken = await createChatSessionToken({
    sub: identityId,
    applicationId: bootstrap.application.id,
    applicationKey: bootstrap.application.key,
    username: validation.standardUser.username,
    sessionReference,
  });

  return {
    accessToken,
    tokenType: "Bearer" as const,
    expiresIn: getServerEnv().CHAT_SESSION_TTL_SECONDS,
    sessionReference,
    application: {
      id: bootstrap.application.id,
      key: bootstrap.application.key,
      name: bootstrap.application.name,
    },
    user: {
      identityId,
      username: validation.standardUser.username,
      name: validation.standardUser.name,
      role: authorization.role,
      permissions: authorization.permissions,
      groups,
      primaryGroup: effectiveUser.primaryGroup,
    },
    integration: {
      id: integration.id,
      type: integration.type,
    },
  };
}

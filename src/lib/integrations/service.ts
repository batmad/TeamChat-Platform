import "server-only";
import { AppError } from "@/lib/api/app-error";
import { decryptIntegrationSecret } from "@/lib/integrations/crypto";
import { fetchApiUser, testApiConnection } from "@/lib/integrations/api-adapter";
import {
  findDatabaseUser,
  listDatabaseFields,
  listDatabaseTables,
  previewDatabaseRows,
  testDatabaseConnection,
  type SupportedDatabaseType,
} from "@/lib/integrations/database-adapter";
import { flattenObjectPaths } from "@/lib/integrations/path";
import { validateMappingsAgainstSourceFields } from "@/lib/integrations/field-mapping";
import { normalizeExternalUser } from "@/lib/integrations/normalize";
import type { FieldMappingRecord, RoleMappingRecord, SourceField } from "@/lib/integrations/types";

export type IntegrationRuntimeRecord = {
  id: string;
  applicationId: string;
  type: "DATABASE" | "API";
  status: "DRAFT" | "ACTIVE" | "INACTIVE" | "ERROR";
  databaseType: SupportedDatabaseType | null;
  config: unknown;
  secretEncrypted: string | null;
  timeoutMs: number;
  fieldMappings: FieldMappingRecord[];
  roleMappings: RoleMappingRecord[];
};

function integrationSecret(integration: IntegrationRuntimeRecord): unknown {
  return decryptIntegrationSecret<unknown>(integration.secretEncrypted) ?? {};
}

export async function testIntegrationRuntime(integration: IntegrationRuntimeRecord): Promise<void> {
  const secret = integrationSecret(integration);
  if (integration.type === "DATABASE") {
    if (!integration.databaseType) throw new AppError(400, "DATABASE_TYPE_REQUIRED", "Database type is required");
    await testDatabaseConnection(integration.databaseType, integration.config, secret, integration.timeoutMs);
    return;
  }
  await testApiConnection(integration.config, secret, integration.timeoutMs);
}

export async function readIntegrationSourceMetadata(
  integration: IntegrationRuntimeRecord,
  input: { table?: string | null; lookupValue?: string | null },
) {
  const secret = integrationSecret(integration);
  if (integration.type === "DATABASE") {
    if (!integration.databaseType) throw new AppError(400, "DATABASE_TYPE_REQUIRED", "Database type is required");
    if (!input.table) {
      return { kind: "tables" as const, tables: await listDatabaseTables(integration.databaseType, integration.config, secret, integration.timeoutMs) };
    }
    return {
      kind: "fields" as const,
      fields: await listDatabaseFields(integration.databaseType, integration.config, secret, integration.timeoutMs, input.table),
    };
  }

  if (!input.lookupValue) {
    throw new AppError(400, "LOOKUP_VALUE_REQUIRED", "A sample user identifier is required to inspect API fields");
  }
  const source = await fetchApiUser(integration.config, secret, integration.timeoutMs, input.lookupValue);
  if (!source) throw new AppError(404, "EXTERNAL_USER_NOT_FOUND", "Sample external user was not found");
  return {
    kind: "fields" as const,
    fields: flattenObjectPaths(source).map((name) => ({ name, type: "dynamic", nullable: true })),
  };
}

function requireDatabaseType(integration: IntegrationRuntimeRecord): SupportedDatabaseType {
  if (!integration.databaseType) throw new AppError(400, "DATABASE_TYPE_REQUIRED", "Database type is required");
  return integration.databaseType;
}

export async function getIntegrationSourceFieldsForMapping(
  integration: IntegrationRuntimeRecord,
  input: { lookupValue?: string | null } = {},
): Promise<SourceField[]> {
  const secret = integrationSecret(integration);
  if (integration.type === "DATABASE") {
    const config = integration.config as { userTable?: string | null };
    if (!config.userTable) throw new AppError(400, "USER_TABLE_REQUIRED", "Select and save a user table first");
    return listDatabaseFields(
      requireDatabaseType(integration),
      integration.config,
      secret,
      integration.timeoutMs,
      config.userTable,
    );
  }

  if (!input.lookupValue) {
    throw new AppError(400, "LOOKUP_VALUE_REQUIRED", "A sample user identifier is required to validate API field mapping");
  }
  const source = await fetchApiUser(integration.config, secret, integration.timeoutMs, input.lookupValue);
  if (!source) throw new AppError(404, "EXTERNAL_USER_NOT_FOUND", "Sample external user was not found");
  return flattenObjectPaths(source).map((name) => ({ name, type: "dynamic", nullable: true }));
}

export async function validateIntegrationFieldMappings(
  integration: IntegrationRuntimeRecord,
  mappings: FieldMappingRecord[],
  input: { lookupValue?: string | null } = {},
): Promise<SourceField[]> {
  const fields = await getIntegrationSourceFieldsForMapping(integration, input);
  validateMappingsAgainstSourceFields(mappings, fields);
  return fields;
}

export async function previewIntegrationUsers(
  integration: IntegrationRuntimeRecord,
  input: { limit?: number; lookupValue?: string | null; mappings?: FieldMappingRecord[] },
) {
  const secret = integrationSecret(integration);
  const mappings = input.mappings ?? integration.fieldMappings;
  validateMappingsAgainstSourceFields(
    mappings,
    await getIntegrationSourceFieldsForMapping(integration, { lookupValue: input.lookupValue }),
  );

  let sources: Record<string, unknown>[];

  if (integration.type === "DATABASE") {
    sources = await previewDatabaseRows(
      requireDatabaseType(integration),
      integration.config,
      secret,
      integration.timeoutMs,
      input.limit ?? 5,
    );
  } else {
    if (!input.lookupValue) throw new AppError(400, "LOOKUP_VALUE_REQUIRED", "A sample user identifier is required");
    const user = await fetchApiUser(integration.config, secret, integration.timeoutMs, input.lookupValue);
    if (!user) throw new AppError(404, "EXTERNAL_USER_NOT_FOUND", "External user was not found");
    sources = [user];
  }

  return sources.map((source) => normalizeExternalUser(source, mappings, integration.roleMappings));
}

export async function validateIntegrationUser(integration: IntegrationRuntimeRecord, username: string) {
  const usernameMapping = integration.fieldMappings.find((mapping) => mapping.targetField === "username");
  if (!usernameMapping) throw new AppError(400, "USERNAME_MAPPING_REQUIRED", "Configure username field mapping first");
  const secret = integrationSecret(integration);
  const source = integration.type === "DATABASE"
    ? await findDatabaseUser(
        requireDatabaseType(integration),
        integration.config,
        secret,
        integration.timeoutMs,
        usernameMapping.sourceField,
        username,
      )
    : await fetchApiUser(integration.config, secret, integration.timeoutMs, username);

  if (!source) return { valid: false as const, readyForLogin: false, readyForChat: false, standardUser: null, user: null };
  const user = normalizeExternalUser(source, integration.fieldMappings, integration.roleMappings);
  return {
    valid: true as const,
    readyForLogin: user.readyForChat,
    readyForChat: user.readyForChat,
    standardUser: user.standardUser,
    user,
  };
}

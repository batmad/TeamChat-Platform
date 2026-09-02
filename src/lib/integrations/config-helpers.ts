import { AppError } from "@/lib/api/app-error";
import {
  apiConfigSchema,
  apiIntegrationSettingsSchema,
  apiRequestConfigSchema,
  apiResponseMappingSchema,
  apiSecretSchema,
  databaseConfigSchema,
  databaseIntegrationSettingsSchema,
  databaseSecretSchema,
} from "@/lib/integrations/schemas";

export function parseDatabaseSettings(value: unknown) {
  return databaseIntegrationSettingsSchema.parse(value);
}

export function parseApiSettings(value: unknown) {
  return apiIntegrationSettingsSchema.parse(value);
}

export function parseIntegrationSecret(type: "DATABASE" | "API", secret: unknown) {
  return type === "DATABASE" ? databaseSecretSchema.parse(secret ?? { password: "" }) : apiSecretSchema.parse(secret ?? {});
}

export function databaseSettingsToRuntime(settings: unknown) {
  const value = databaseIntegrationSettingsSchema.parse(settings);
  return databaseConfigSchema.parse({
    host: value.host,
    port: value.port,
    database: value.databaseName,
    username: value.username,
    schema: value.schemaName ?? null,
    sslMode: value.sslMode,
    userTable: value.userTable ?? null,
  });
}

export function apiSettingsToRuntime(settings: unknown) {
  const value = apiIntegrationSettingsSchema.parse(settings);
  const request = apiRequestConfigSchema.parse(value.requestConfig);
  const response = apiResponseMappingSchema.parse(value.responseMapping);
  return apiConfigSchema.parse({
    baseUrl: value.baseUrl,
    userPath: value.endpoint,
    testPath: value.testEndpoint ?? null,
    lookupMethod: request.lookupMethod,
    lookupParam: request.lookupParam,
    responseRoot: response.responseRoot ?? null,
    authType: value.authenticationMode,
    apiKeyHeader: request.apiKeyHeader ?? null,
    basicUsername: request.basicUsername ?? null,
    staticHeaders: request.staticHeaders,
  });
}

export function validateApiSecretForAuth(rawConfig: unknown, rawSecret: unknown) {
  const config = apiIntegrationSettingsSchema.parse(rawConfig);
  const secret = apiSecretSchema.parse(rawSecret ?? {});
  if (config.authenticationMode === "BEARER" && !secret.bearerToken) throw new AppError(400, "API_SECRET_REQUIRED", "Bearer token is required for BEARER authentication");
  if (config.authenticationMode === "API_KEY" && !secret.apiKey) throw new AppError(400, "API_SECRET_REQUIRED", "API key is required for API_KEY authentication");
  if (config.authenticationMode === "BASIC" && (!config.requestConfig.basicUsername || !secret.basicPassword)) {
    throw new AppError(400, "API_SECRET_REQUIRED", "Basic username and password are required for BASIC authentication");
  }
}

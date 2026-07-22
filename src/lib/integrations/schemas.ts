import { z } from "zod";

const sensitiveHeaderNames = new Set(["authorization", "cookie", "proxy-authorization", "set-cookie"]);

export const staticHeadersSchema = z.record(z.string(), z.string()).default({}).superRefine((headers, ctx) => {
  for (const header of Object.keys(headers)) {
    if (sensitiveHeaderNames.has(header.toLowerCase())) {
      ctx.addIssue({ code: "custom", path: [header], message: `Sensitive header ${header} must use encrypted authentication fields` });
    }
  }
});

// Runtime adapter schemas.
export const databaseConfigSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  database: z.string().trim().min(1).max(255),
  username: z.string().trim().min(1).max(255),
  schema: z.string().trim().min(1).max(255).nullable().optional(),
  sslMode: z.enum(["DISABLE", "REQUIRE"]).default("DISABLE"),
  userTable: z.string().trim().min(1).max(255).nullable().optional(),
});

export const databaseSecretSchema = z.object({ password: z.string().max(2048) });

export const apiRequestConfigSchema = z.object({
  lookupMethod: z.enum(["GET", "POST"]).default("GET"),
  lookupParam: z.string().trim().min(1).max(100),
  apiKeyHeader: z.string().trim().min(1).max(200).nullable().optional(),
  basicUsername: z.string().trim().max(255).nullable().optional(),
  staticHeaders: staticHeadersSchema,
});

export const apiResponseMappingSchema = z.object({
  responseRoot: z.string().trim().max(500).nullable().optional(),
});

export const apiConfigSchema = z.object({
  baseUrl: z.string().trim().url(),
  userPath: z.string().trim().min(1).max(1000),
  testPath: z.string().trim().max(1000).nullable().optional(),
  lookupMethod: z.enum(["GET", "POST"]).default("GET"),
  lookupParam: z.string().trim().min(1).max(100),
  responseRoot: z.string().trim().max(500).nullable().optional(),
  authType: z.enum(["NONE", "BEARER", "API_KEY", "BASIC"]).default("NONE"),
  apiKeyHeader: z.string().trim().min(1).max(200).nullable().optional(),
  basicUsername: z.string().trim().max(255).nullable().optional(),
  staticHeaders: staticHeadersSchema,
});

export const apiSecretSchema = z.object({
  bearerToken: z.string().max(8192).optional(),
  apiKey: z.string().max(8192).optional(),
  basicPassword: z.string().max(8192).optional(),
});

export const databaseIntegrationSettingsSchema = z.object({
  databaseType: z.enum(["POSTGRESQL", "MYSQL", "MARIADB", "SQLSERVER"]),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  databaseName: z.string().trim().min(1).max(255),
  username: z.string().trim().min(1).max(255),
  schemaName: z.string().trim().min(1).max(255).nullable().optional(),
  sslMode: z.enum(["DISABLE", "REQUIRE"]).default("DISABLE"),
  userTable: z.string().trim().min(1).max(255).nullable().optional(),
});

export const apiIntegrationSettingsSchema = z.object({
  baseUrl: z.string().trim().url(),
  endpoint: z.string().trim().min(1).max(1000),
  testEndpoint: z.string().trim().max(1000).nullable().optional(),
  authenticationMode: z.enum(["NONE", "BEARER", "API_KEY", "BASIC"]).default("NONE"),
  requestConfig: apiRequestConfigSchema,
  responseMapping: apiResponseMappingSchema,
});

const commonCreateFields = {
  name: z.string().trim().min(2).max(120),
  timeoutMs: z.number().int().min(1000).max(60000).default(10000),
  isDefaultUserSource: z.boolean().default(false),
};

export const createIntegrationSchema = z.discriminatedUnion("type", [
  z.object({
    ...commonCreateFields,
    type: z.literal("DATABASE"),
    databaseConfig: databaseIntegrationSettingsSchema,
    secret: databaseSecretSchema,
  }),
  z.object({
    ...commonCreateFields,
    type: z.literal("API"),
    apiConfig: apiIntegrationSettingsSchema,
    secret: apiSecretSchema.default({}),
  }),
]);

export const updateIntegrationSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ERROR"]).optional(),
  databaseConfig: databaseIntegrationSettingsSchema.optional(),
  apiConfig: apiIntegrationSettingsSchema.optional(),
  secret: z.unknown().optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  isDefaultUserSource: z.boolean().optional(),
});

export const fieldMappingItemSchema = z.object({
  targetField: z.enum(["username", "name", "role", "primary_group"]),
  sourceField: z.string().trim().min(1).max(500),
  defaultValue: z.string().max(1000).nullable().optional(),
  isRequired: z.boolean().default(true),
});

export const fieldMappingsSchema = z.object({
  mappings: z.array(fieldMappingItemSchema).length(4),
  lookupValue: z.string().trim().min(1).max(500).optional(),
});

export const fieldMappingPreviewSchema = z.object({
  limit: z.number().int().min(1).max(20).default(5),
  lookupValue: z.string().trim().min(1).max(500).optional(),
  mappings: z.array(fieldMappingItemSchema).length(4).optional(),
});

export const roleMappingsSchema = z.object({
  mappings: z.array(z.object({ sourceRole: z.string().trim().min(1).max(255), roleId: z.string().uuid() })),
});

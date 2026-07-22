import type { StandardUser, StandardUserIssue } from "@/lib/users/standard-user";

export const INTEGRATION_TARGET_FIELDS = ["username", "name", "role", "primary_group"] as const;
export type IntegrationTargetField = (typeof INTEGRATION_TARGET_FIELDS)[number];

export type DatabaseIntegrationConfig = {
  host: string;
  port: number;
  database: string;
  username: string;
  schema?: string | null;
  sslMode?: "DISABLE" | "REQUIRE";
  userTable?: string | null;
};

export type DatabaseIntegrationSecret = { password: string };

export type ApiAuthType = "NONE" | "BEARER" | "API_KEY" | "BASIC";
export type ApiLookupMethod = "GET" | "POST";

export type ApiRequestConfig = {
  lookupMethod: ApiLookupMethod;
  lookupParam: string;
  apiKeyHeader?: string | null;
  basicUsername?: string | null;
  staticHeaders: Record<string, string>;
};

export type ApiResponseMapping = {
  responseRoot?: string | null;
};

export type ApiIntegrationConfig = {
  baseUrl: string;
  userPath: string;
  testPath?: string | null;
  lookupMethod: ApiLookupMethod;
  lookupParam: string;
  responseRoot?: string | null;
  authType: ApiAuthType;
  apiKeyHeader?: string | null;
  basicUsername?: string | null;
  staticHeaders?: Record<string, string>;
};

export type ApiIntegrationSecret = {
  bearerToken?: string;
  apiKey?: string;
  basicPassword?: string;
};

export type IntegrationSecret = DatabaseIntegrationSecret | ApiIntegrationSecret;

export type SourceField = { name: string; type: string; nullable?: boolean };
export type SourceTable = { schema?: string | null; name: string };

export type NormalizedExternalUser = {
  username: string;
  name: string;
  sourceRole: string;
  primaryGroup: string;
  mappedRole: { id: string; code: string; name: string } | null;
  standardUser: StandardUser | null;
  readyForChat: boolean;
  normalizationIssues: StandardUserIssue[];
  sourceSnapshot: Record<string, unknown>;
};

export type FieldMappingRecord = {
  targetField: string;
  sourceField: string;
  defaultValue?: string | null;
  isRequired: boolean;
};

export type RoleMappingRecord = {
  sourceRole: string;
  role: { id: string; code: string; name: string; isActive: boolean };
};

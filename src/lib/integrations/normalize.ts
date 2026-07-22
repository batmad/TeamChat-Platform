import { AppError } from "@/lib/api/app-error";
import { getValueAtPath, toMappedString } from "@/lib/integrations/path";
import type { FieldMappingRecord, NormalizedExternalUser, RoleMappingRecord } from "@/lib/integrations/types";
import { buildStandardUserReadiness } from "@/lib/users/standard-user";

function mappedValue(source: Record<string, unknown>, mapping: FieldMappingRecord | undefined): string | null {
  if (!mapping) return null;
  const raw = getValueAtPath(source, mapping.sourceField);
  const value = toMappedString(raw) ?? mapping.defaultValue ?? null;
  return value?.trim() || null;
}

export function normalizeExternalUser(
  source: Record<string, unknown>,
  fieldMappings: FieldMappingRecord[],
  roleMappings: RoleMappingRecord[],
): NormalizedExternalUser {
  const mappingByTarget = new Map(fieldMappings.map((mapping) => [mapping.targetField, mapping]));
  const username = mappedValue(source, mappingByTarget.get("username"));
  const name = mappedValue(source, mappingByTarget.get("name"));
  const sourceRole = mappedValue(source, mappingByTarget.get("role"));
  const primaryGroup = mappedValue(source, mappingByTarget.get("primary_group"));

  const requiredCandidates: Array<[string, string | null]> = [
    ["username", username],
    ["name", name],
    ["role", sourceRole],
    ["primary_group", primaryGroup],
  ];
  const requiredMissing = requiredCandidates.filter(
    ([field, value]) => mappingByTarget.get(field)?.isRequired !== false && !value,
  );

  if (requiredMissing.length) {
    throw new AppError(
      422,
      "MAPPING_REQUIRED_VALUE_MISSING",
      `Required mapped values are missing: ${requiredMissing.map(([field]) => field).join(", ")}`,
    );
  }

  if (!username || !name || !sourceRole || !primaryGroup) {
    throw new AppError(422, "INCOMPLETE_NORMALIZED_USER", "Normalized user is incomplete");
  }

  const roleMapping = roleMappings.find((mapping) => mapping.sourceRole === sourceRole && mapping.role.isActive) ?? null;
  const standardUserReadiness = buildStandardUserReadiness({
    username,
    name,
    role: roleMapping?.role.code ?? null,
    group: primaryGroup,
  });
  const sourceSnapshot = Object.fromEntries(
    fieldMappings.map((mapping) => [mapping.targetField, getValueAtPath(source, mapping.sourceField) ?? mapping.defaultValue ?? null]),
  );

  return {
    username,
    name,
    sourceRole,
    primaryGroup,
    mappedRole: roleMapping ? roleMapping.role : null,
    standardUser: standardUserReadiness.user,
    readyForChat: standardUserReadiness.readyForChat,
    normalizationIssues: standardUserReadiness.issues,
    sourceSnapshot,
  };
}

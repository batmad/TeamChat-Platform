export const RESERVED_ROLE_CODES = new Set(["root"]);

export type RoleUsageSummary = {
  integrationMappings: number;
  userOverrides: number;
  presenceRecords: number;
  reportScopes: number;
};

export function normalizeRoleCode(value: string): string {
  return value.trim().toLowerCase();
}

export function isReservedRoleCode(value: string): boolean {
  return RESERVED_ROLE_CODES.has(normalizeRoleCode(value));
}

export function totalRoleUsage(usage: RoleUsageSummary): number {
  return (
    usage.integrationMappings +
    usage.userOverrides +
    usage.presenceRecords +
    usage.reportScopes
  );
}

export function roleUsageBlockers(usage: RoleUsageSummary): string[] {
  const blockers: string[] = [];
  if (usage.integrationMappings > 0) blockers.push("integrationMappings");
  if (usage.userOverrides > 0) blockers.push("userOverrides");
  if (usage.presenceRecords > 0) blockers.push("presenceRecords");
  if (usage.reportScopes > 0) blockers.push("reportScopes");
  return blockers;
}

export function canDeactivateRole(usage: RoleUsageSummary): boolean {
  return totalRoleUsage(usage) === 0;
}

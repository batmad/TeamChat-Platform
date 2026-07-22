import "server-only";
import { AppError } from "@/lib/api/app-error";
import { prisma } from "@/lib/db/prisma";
import {
  canDeactivateRole,
  isReservedRoleCode,
  normalizeRoleCode,
  roleUsageBlockers,
  type RoleUsageSummary,
} from "@/lib/rbac/role-rules";

export type DynamicRoleInput = {
  code: string;
  name: string;
  description?: string | null;
};

export function validateBusinessRoleCode(code: string): string {
  const normalized = normalizeRoleCode(code);
  if (isReservedRoleCode(normalized)) {
    throw new AppError(
      400,
      "ROLE_CODE_RESERVED",
      "The ROOT identifier is reserved for the protected system account and cannot be used as a business role",
    );
  }
  return normalized;
}

export async function assertUniqueRoleCode(
  applicationId: string,
  code: string,
  excludeRoleId?: string,
): Promise<string> {
  const normalized = validateBusinessRoleCode(code);
  const duplicate = await prisma.role.findFirst({
    where: {
      applicationId,
      code: { equals: normalized, mode: "insensitive" },
      ...(excludeRoleId ? { NOT: { id: excludeRoleId } } : {}),
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new AppError(409, "ROLE_CODE_EXISTS", "Role code already exists in this application");
  }

  return normalized;
}

export async function getRoleUsage(roleId: string): Promise<RoleUsageSummary> {
  const [integrationMappings, userOverrides, presenceRecords, reportScopes] = await Promise.all([
    prisma.integrationRoleMapping.count({ where: { roleId } }),
    prisma.userOverride.count({ where: { roleOverrideId: roleId } }),
    prisma.userPresence.count({ where: { effectiveRoleId: roleId } }),
    prisma.reportScopeAssignment.count({ where: { roleId } }),
  ]);

  return {
    integrationMappings,
    userOverrides,
    presenceRecords,
    reportScopes,
  };
}

export async function assertRoleCanDeactivate(roleId: string): Promise<RoleUsageSummary> {
  const usage = await getRoleUsage(roleId);
  if (!canDeactivateRole(usage)) {
    throw new AppError(
      409,
      "ROLE_IN_USE",
      `Role is still referenced by: ${roleUsageBlockers(usage).join(", ")}`,
      { usage },
    );
  }
  return usage;
}

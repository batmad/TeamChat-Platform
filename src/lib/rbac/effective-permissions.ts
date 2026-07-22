export type PermissionOverrideInput = {
  code: string;
  effect: "ALLOW" | "DENY";
};

export function resolveEffectivePermissions(
  rolePermissions: Iterable<string>,
  overrides: Iterable<PermissionOverrideInput>,
): string[] {
  const effective = new Set(rolePermissions);
  const explicitAllow = new Set<string>();
  const explicitDeny = new Set<string>();

  for (const override of overrides) {
    if (override.effect === "DENY") {
      explicitDeny.add(override.code);
      explicitAllow.delete(override.code);
    } else if (!explicitDeny.has(override.code)) {
      explicitAllow.add(override.code);
    }
  }

  for (const code of explicitAllow) effective.add(code);
  for (const code of explicitDeny) effective.delete(code);

  return [...effective].sort();
}

export function hasEffectivePermission(
  permissions: readonly string[],
  permissionCode: string,
  isRoot = false,
): boolean {
  return isRoot || permissions.includes(permissionCode);
}

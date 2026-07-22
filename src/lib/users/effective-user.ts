import "server-only";
import { resolveEffectiveGroups } from "@/lib/groups/effective-groups";
import { resolveIdentityAuthorization } from "@/lib/rbac/authorization";

export async function resolveEffectiveUser(userIdentityId: string) {
  const [authorization, groups] = await Promise.all([
    resolveIdentityAuthorization(userIdentityId),
    resolveEffectiveGroups(userIdentityId),
  ]);

  if (!authorization) return null;

  return {
    ...authorization,
    groups,
    primaryGroup: groups.find((group) => group.isPrimary) ?? null,
  };
}

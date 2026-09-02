import "server-only";
import { prisma } from "@/lib/db/prisma";
import { resolveEffectivePermissions } from "@/lib/rbac/effective-permissions";

export type EffectiveRole = {
  id: string;
  code: string;
  name: string;
};

export type IdentityAuthorization = {
  userIdentityId: string;
  applicationId: string;
  applicationKey: string;
  applicationName: string;
  username: string;
  displayName: string | null;
  role: EffectiveRole | null;
  permissions: string[];
  isAccessDisabled: boolean;
};

export async function resolveIdentityAuthorization(
  userIdentityId: string,
): Promise<IdentityAuthorization | null> {
  const identity = await prisma.userIdentity.findUnique({
    where: { id: userIdentityId },
    select: {
      id: true,
      applicationId: true,
      username: true,
      displayNameSnapshot: true,
      isActive: true,
      application: {
        select: {
          id: true,
          key: true,
          name: true,
          status: true,
        },
      },
      userOverride: {
        select: {
          isAccessDisabled: true,
          roleOverride: {
            select: {
              id: true,
              applicationId: true,
              code: true,
              name: true,
              isActive: true,
              permissions: {
                select: {
                  permission: {
                    select: {
                      code: true,
                      isActive: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      presence: {
        select: {
          effectiveRole: {
            select: {
              id: true,
              applicationId: true,
              code: true,
              name: true,
              isActive: true,
              permissions: {
                select: {
                  permission: {
                    select: {
                      code: true,
                      isActive: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      permissionOverrides: {
        select: {
          effect: true,
          permission: {
            select: {
              code: true,
              isActive: true,
            },
          },
        },
      },
    },
  });

  if (!identity || !identity.isActive || identity.application.status !== "ACTIVE") {
    return null;
  }

  const overrideRole = identity.userOverride?.roleOverride;
  const cachedRole = identity.presence?.effectiveRole;
  const candidateRole = overrideRole ?? cachedRole ?? null;
  const role =
    candidateRole &&
    candidateRole.isActive &&
    candidateRole.applicationId === identity.applicationId
      ? candidateRole
      : null;

  const rolePermissions =
    role?.permissions
      .filter(({ permission }: { permission: { code: string; isActive: boolean } }) => permission.isActive)
      .map(({ permission }: { permission: { code: string; isActive: boolean } }) => permission.code) ?? [];

  const userOverrides = identity.permissionOverrides
    .filter(({ permission }: { permission: { code: string; isActive: boolean } }) => permission.isActive)
    .map(({ permission, effect }: { permission: { code: string; isActive: boolean }; effect: string }) => ({
      code: permission.code,
      effect: effect as "ALLOW" | "DENY",
    }));

  return {
    userIdentityId: identity.id,
    applicationId: identity.applicationId,
    applicationKey: identity.application.key,
    applicationName: identity.application.name,
    username: identity.username,
    displayName: identity.displayNameSnapshot,
    role: role
      ? {
          id: role.id,
          code: role.code,
          name: role.name,
        }
      : null,
    permissions: resolveEffectivePermissions(rolePermissions, userOverrides),
    isAccessDisabled: identity.userOverride?.isAccessDisabled ?? false,
  };
}

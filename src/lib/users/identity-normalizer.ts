import "server-only";
import { prisma } from "@/lib/db/prisma";
import { buildStandardUserReadiness, type StandardUserReadiness } from "@/lib/users/standard-user";

export type IdentityStandardUserResult = StandardUserReadiness & {
  userIdentityId: string;
  applicationId: string;
  source: "DATABASE" | "API" | "INTERNAL";
};

export async function resolveStandardUserFromIdentity(
  userIdentityId: string,
): Promise<IdentityStandardUserResult | null> {
  const identity = await prisma.userIdentity.findUnique({
    where: { id: userIdentityId },
    select: {
      id: true,
      applicationId: true,
      username: true,
      source: true,
      displayNameSnapshot: true,
      isActive: true,
      internalUser: {
        select: {
          name: true,
          isActive: true,
        },
      },
      application: {
        select: {
          status: true,
        },
      },
      userOverride: {
        select: {
          isAccessDisabled: true,
          roleOverride: {
            select: {
              code: true,
              isActive: true,
              applicationId: true,
            },
          },
        },
      },
      presence: {
        select: {
          effectiveRole: {
            select: {
              code: true,
              isActive: true,
              applicationId: true,
            },
          },
        },
      },
      groupMemberships: {
        where: {
          group: { isActive: true },
        },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        select: {
          isPrimary: true,
          group: {
            select: {
              code: true,
            },
          },
        },
      },
    },
  });

  if (
    !identity ||
    !identity.isActive ||
    identity.application.status !== "ACTIVE" ||
    identity.userOverride?.isAccessDisabled ||
    (identity.source === "INTERNAL" && identity.internalUser && !identity.internalUser.isActive)
  ) {
    return null;
  }

  const overrideRole = identity.userOverride?.roleOverride;
  const presenceRole = identity.presence?.effectiveRole;
  const role = [overrideRole, presenceRole].find(
    (candidate) => candidate?.isActive && candidate.applicationId === identity.applicationId,
  );

  const primaryGroup =
    identity.groupMemberships.find((membership: { isPrimary: boolean; group: { code: string } }) => membership.isPrimary)?.group.code ??
    identity.groupMemberships[0]?.group.code ??
    null;

  const readiness = buildStandardUserReadiness({
    username: identity.username,
    name: identity.displayNameSnapshot ?? identity.internalUser?.name ?? null,
    role: role?.code ?? null,
    group: primaryGroup,
  });

  return {
    userIdentityId: identity.id,
    applicationId: identity.applicationId,
    source: identity.source,
    ...readiness,
  };
}

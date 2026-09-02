import "server-only";
import { prisma } from "@/lib/db/prisma";

type MembershipRow = {
  isPrimary: boolean;
  source: "EXTERNAL" | "INTERNAL";
  createdAt: Date;
  group: { id: string; code: string; name: string; source: "EXTERNAL" | "INTERNAL" };
};

export type EffectiveGroup = {
  id: string;
  code: string;
  name: string;
  groupSource: "EXTERNAL" | "INTERNAL";
  membershipSource: "EXTERNAL" | "INTERNAL";
  isPrimary: boolean;
};

export async function resolveEffectiveGroups(userIdentityId: string): Promise<EffectiveGroup[]> {
  const memberships = await prisma.userGroup.findMany({
    where: {
      userIdentityId,
      group: { isActive: true },
    },
    select: {
      isPrimary: true,
      source: true,
      createdAt: true,
      group: {
        select: {
          id: true,
          code: true,
          name: true,
          source: true,
        },
      },
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  }) as MembershipRow[];

  let primarySeen = false;
  return memberships.map((membership) => {
    const isPrimary = membership.isPrimary && !primarySeen;
    if (isPrimary) primarySeen = true;
    return {
      id: membership.group.id,
      code: membership.group.code,
      name: membership.group.name,
      groupSource: membership.group.source,
      membershipSource: membership.source,
      isPrimary,
    };
  });
}

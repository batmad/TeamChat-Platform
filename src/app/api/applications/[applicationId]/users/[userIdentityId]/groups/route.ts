import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { resolveEffectiveGroups } from "@/lib/groups/effective-groups";
import { requireApiPermission } from "@/lib/rbac/guards";

type Context = { params: Promise<{ applicationId: string; userIdentityId: string }> };

const updateSchema = z.object({
  internalGroupIds: z.array(z.string().uuid()).max(100),
  primaryGroupId: z.string().uuid().nullable().optional(),
});

async function getIdentity(applicationId: string, userIdentityId: string) {
  return prisma.userIdentity.findFirst({
    where: { id: userIdentityId, applicationId },
    select: { id: true, username: true, source: true },
  });
}

export const GET = withApiHandler(async (_request, context: Context) => {
  const { applicationId, userIdentityId } = await context.params;
  await requireApiPermission("groups.view", applicationId);
  const identity = await getIdentity(applicationId, userIdentityId);
  if (!identity) throw new AppError(404, "USER_NOT_FOUND", "User identity was not found");

  const groups = await resolveEffectiveGroups(userIdentityId);
  return NextResponse.json({ success: true, data: { identity, groups } });
});

export const PUT = withApiHandler(async (request, context: Context) => {
  const { applicationId, userIdentityId } = await context.params;
  const session = await requireApiPermission("groups.manage", applicationId);
  const body = updateSchema.parse(await request.json());
  const identity = await getIdentity(applicationId, userIdentityId);
  if (!identity) throw new AppError(404, "USER_NOT_FOUND", "User identity was not found");

  const uniqueInternalIds = [...new Set(body.internalGroupIds)];
  if (uniqueInternalIds.length !== body.internalGroupIds.length) {
    throw new AppError(400, "DUPLICATE_GROUP", "Each internal group can only be assigned once");
  }

  const groups = uniqueInternalIds.length
    ? await prisma.group.findMany({
        where: {
          id: { in: uniqueInternalIds },
          applicationId,
          source: "INTERNAL",
          isActive: true,
        },
        select: { id: true },
      })
    : [];
  if (groups.length !== uniqueInternalIds.length) {
    throw new AppError(400, "INVALID_INTERNAL_GROUP", "One or more internal groups are invalid for this application");
  }

  if (identity.source !== "INTERNAL" && body.primaryGroupId !== undefined) {
    throw new AppError(409, "EXTERNAL_PRIMARY_GROUP_MANAGED_BY_SOURCE", "Primary group for external users is managed by the external source");
  }

  if (identity.source === "INTERNAL" && body.primaryGroupId) {
    if (!uniqueInternalIds.includes(body.primaryGroupId)) {
      throw new AppError(400, "PRIMARY_GROUP_NOT_ASSIGNED", "Primary group must be included in the internal group assignments");
    }
  }

  const before = await resolveEffectiveGroups(userIdentityId);

  await prisma.$transaction(async (tx) => {
    await tx.userGroup.deleteMany({
      where: {
        userIdentityId,
        source: "INTERNAL",
        ...(uniqueInternalIds.length ? { groupId: { notIn: uniqueInternalIds } } : {}),
      },
    });
    if (uniqueInternalIds.length === 0) {
      await tx.userGroup.deleteMany({ where: { userIdentityId, source: "INTERNAL" } });
    }

    for (const groupId of uniqueInternalIds) {
      await tx.userGroup.upsert({
        where: { userIdentityId_groupId: { userIdentityId, groupId } },
        create: {
          userIdentityId,
          groupId,
          source: "INTERNAL",
          isPrimary: identity.source === "INTERNAL" && body.primaryGroupId === groupId,
        },
        update: {
          source: "INTERNAL",
          ...(identity.source === "INTERNAL" ? { isPrimary: body.primaryGroupId === groupId } : {}),
        },
      });
    }

    if (identity.source === "INTERNAL") {
      await tx.userGroup.updateMany({
        where: {
          userIdentityId,
          groupId: { not: body.primaryGroupId ?? "__none__" },
          isPrimary: true,
        },
        data: { isPrimary: false },
      });
    }
  });

  const after = await resolveEffectiveGroups(userIdentityId);
  await writeAuditLog({
    session,
    applicationId,
    action: "USER_GROUP_MEMBERSHIPS_UPDATED",
    entityType: "UserIdentity",
    entityId: userIdentityId,
    beforeData: before,
    afterData: after,
  });

  return NextResponse.json({ success: true, data: { groups: after } });
});

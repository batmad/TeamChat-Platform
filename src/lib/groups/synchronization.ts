import "server-only";
import { AppError } from "@/lib/api/app-error";
import { prisma } from "@/lib/db/prisma";
import { normalizeExternalGroupKey, normalizeGroupCode } from "@/lib/groups/rules";

export async function synchronizeExternalGroups(input: {
  applicationId: string;
  userIdentityId: string;
  externalGroupKeys: string[];
  primaryGroupKey: string;
}) {
  const normalizedKeys = [...new Set(input.externalGroupKeys.map(normalizeExternalGroupKey))];
  const primaryKey = normalizeExternalGroupKey(input.primaryGroupKey);
  if (!normalizedKeys.includes(primaryKey)) normalizedKeys.unshift(primaryKey);

  const externalKeyByCode = new Map<string, string>();
  for (const externalKey of normalizedKeys) {
    const code = normalizeGroupCode(externalKey);
    const previous = externalKeyByCode.get(code);
    if (previous && previous !== externalKey) {
      throw new AppError(409, "EXTERNAL_GROUP_NORMALIZATION_CONFLICT", `External groups '${previous}' and '${externalKey}' normalize to the same group code`);
    }
    externalKeyByCode.set(code, externalKey);
  }

  return prisma.$transaction(async (tx) => {
    const identity = await tx.userIdentity.findFirst({
      where: { id: input.userIdentityId, applicationId: input.applicationId },
      select: { id: true, source: true },
    });
    if (!identity) throw new AppError(404, "USER_NOT_FOUND", "User identity was not found");
    if (identity.source === "INTERNAL") {
      throw new AppError(409, "INTERNAL_USER_EXTERNAL_GROUP_SYNC", "Internal users cannot be synchronized from an external group source");
    }

    const groups: Array<{ id: string; externalKey: string }> = [];
    for (const externalKey of normalizedKeys) {
      const code = normalizeGroupCode(externalKey);
      const existing = await tx.group.findFirst({
        where: {
          applicationId: input.applicationId,
          source: "EXTERNAL",
          OR: [{ externalKey }, { code }],
        },
        select: { id: true, externalKey: true },
      });
      const conflictingCodeOwner = !existing
        ? await tx.group.findUnique({
            where: { applicationId_code: { applicationId: input.applicationId, code } },
            select: { id: true, source: true },
          })
        : null;
      if (conflictingCodeOwner && conflictingCodeOwner.source !== "EXTERNAL") {
        throw new AppError(409, "EXTERNAL_GROUP_CODE_CONFLICT", `External group '${externalKey}' conflicts with an internal group code`);
      }

      const group = existing
        ? await tx.group.update({
            where: { id: existing.id },
            data: { externalKey, isActive: true },
            select: { id: true },
          })
        : await tx.group.create({
            data: {
              applicationId: input.applicationId,
              code,
              name: externalKey,
              source: "EXTERNAL",
              externalKey,
              isActive: true,
            },
            select: { id: true },
          });
      groups.push({ id: group.id, externalKey });
    }

    const activeExternalGroupIds = groups.map((group) => group.id);
    await tx.userGroup.deleteMany({
      where: {
        userIdentityId: input.userIdentityId,
        source: "EXTERNAL",
        groupId: { notIn: activeExternalGroupIds },
      },
    });

    await tx.userGroup.updateMany({
      where: { userIdentityId: input.userIdentityId, isPrimary: true },
      data: { isPrimary: false },
    });

    const now = new Date();
    for (const group of groups) {
      await tx.userGroup.upsert({
        where: {
          userIdentityId_groupId: {
            userIdentityId: input.userIdentityId,
            groupId: group.id,
          },
        },
        create: {
          userIdentityId: input.userIdentityId,
          groupId: group.id,
          source: "EXTERNAL",
          isPrimary: group.externalKey === primaryKey,
          syncedAt: now,
        },
        update: {
          source: "EXTERNAL",
          isPrimary: group.externalKey === primaryKey,
          syncedAt: now,
        },
      });
    }

    return {
      groupIds: activeExternalGroupIds,
      primaryGroupId: groups.find((group) => group.externalKey === primaryKey)?.id ?? null,
    };
  });
}

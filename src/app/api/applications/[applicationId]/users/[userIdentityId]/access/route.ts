import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { resolveIdentityAuthorization } from "@/lib/rbac/authorization";
import { requireApiPermission } from "@/lib/rbac/guards";

type Context = { params: Promise<{ applicationId: string; userIdentityId: string }> };

const updateSchema = z.object({
  roleOverrideId: z.string().uuid().nullable().optional(),
  isAccessDisabled: z.boolean().optional(),
  permissionOverrides: z
    .array(
      z.object({
        permissionCode: z.string().trim().min(1),
        effect: z.enum(["ALLOW", "DENY"]),
      }),
    )
    .optional(),
});

async function getTarget(applicationId: string, userIdentityId: string) {
  return prisma.userIdentity.findFirst({
    where: { id: userIdentityId, applicationId },
    select: {
      id: true,
      username: true,
      internalUser: { select: { isProtectedRoot: true } },
      userOverride: {
        select: { roleOverrideId: true, isAccessDisabled: true, metadata: true },
      },
      permissionOverrides: {
        select: { effect: true, permission: { select: { code: true } } },
      },
    },
  });
}

export const GET = withApiHandler(async (_request, context: Context) => {
  const { applicationId, userIdentityId } = await context.params;
  await requireApiPermission("users.view", applicationId);

  const target = await getTarget(applicationId, userIdentityId);
  if (!target) throw new AppError(404, "USER_NOT_FOUND", "User identity was not found");

  const effective = await resolveIdentityAuthorization(userIdentityId);
  return NextResponse.json({ success: true, data: { access: effective } });
});

export const PUT = withApiHandler(async (request, context: Context) => {
  const { applicationId, userIdentityId } = await context.params;
  const session = await requireApiPermission("users.override", applicationId);
  const body = updateSchema.parse(await request.json());

  const target = await getTarget(applicationId, userIdentityId);
  if (!target) throw new AppError(404, "USER_NOT_FOUND", "User identity was not found");
  if (target.internalUser?.isProtectedRoot) {
    throw new AppError(403, "PROTECTED_ROOT", "Protected ROOT access cannot be overridden");
  }

  if (body.roleOverrideId) {
    const role = await prisma.role.findFirst({
      where: { id: body.roleOverrideId, applicationId, isActive: true },
      select: { id: true },
    });
    if (!role) throw new AppError(400, "INVALID_ROLE", "Role override is invalid for this application");
  }

  const requestedOverrides = body.permissionOverrides ?? null;
  const uniquePermissionCodes = requestedOverrides
    ? [...new Set(requestedOverrides.map((item) => item.permissionCode))]
    : [];
  if (requestedOverrides && uniquePermissionCodes.length !== requestedOverrides.length) {
    throw new AppError(400, "DUPLICATE_PERMISSION_OVERRIDE", "Each permission can only be overridden once");
  }

  const permissions = uniquePermissionCodes.length
    ? await prisma.permission.findMany({
        where: { code: { in: uniquePermissionCodes }, isActive: true },
        select: { id: true, code: true },
      })
    : [];

  if (requestedOverrides && permissions.length !== uniquePermissionCodes.length) {
    throw new AppError(400, "INVALID_PERMISSION", "One or more permissions are invalid");
  }

  const permissionByCode = new Map(permissions.map((permission: { id: string; code: string }) => [permission.code, permission.id]));

  await prisma.$transaction(async (tx) => {
    await tx.userOverride.upsert({
      where: { userIdentityId },
      update: {
        ...(body.roleOverrideId !== undefined ? { roleOverrideId: body.roleOverrideId } : {}),
        ...(body.isAccessDisabled !== undefined ? { isAccessDisabled: body.isAccessDisabled } : {}),
      },
      create: {
        userIdentityId,
        roleOverrideId: body.roleOverrideId ?? null,
        isAccessDisabled: body.isAccessDisabled ?? false,
      },
    });

    if (requestedOverrides) {
      await tx.userPermissionOverride.deleteMany({ where: { userIdentityId } });
      if (requestedOverrides.length) {
        await tx.userPermissionOverride.createMany({
          data: requestedOverrides.map((override) => ({
            userIdentityId,
            permissionId: permissionByCode.get(override.permissionCode)!,
            effect: override.effect,
          })),
        });
      }
    }
  });

  const after = await resolveIdentityAuthorization(userIdentityId);

  await writeAuditLog({
    session,
    applicationId,
    action: "USER_ACCESS_OVERRIDE_UPDATED",
    entityType: "UserIdentity",
    entityId: userIdentityId,
    beforeData: {
      roleOverrideId: target.userOverride?.roleOverrideId ?? null,
      isAccessDisabled: target.userOverride?.isAccessDisabled ?? false,
      permissionOverrides: target.permissionOverrides.map((item: { effect: string; permission: { code: string } }) => ({
        permissionCode: item.permission.code,
        effect: item.effect,
      })),
    },
    afterData: body,
  });

  return NextResponse.json({ success: true, data: { access: after } });
});

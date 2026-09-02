import argon2 from "argon2";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { requireApiPermission } from "@/lib/rbac/guards";

type Context = { params: Promise<{ applicationId: string }> };

const createSchema = z.object({
  username: z.string().trim().min(3).max(100),
  name: z.string().trim().min(2).max(150),
  password: z.string().min(12).max(512),
  roleId: z.string().uuid(),
  primaryGroupId: z.string().uuid().nullable().optional(),
});

export const GET = withApiHandler(async (_request, context: Context) => {
  const { applicationId } = await context.params;
  await requireApiPermission("users.view", applicationId);

  const users = await prisma.userIdentity.findMany({
    where: { applicationId, source: "INTERNAL" },
    orderBy: { username: "asc" },
    select: {
      id: true,
      username: true,
      displayNameSnapshot: true,
      isActive: true,
      internalUser: {
        select: { id: true, isActive: true, isProtectedRoot: true, lastLoginAt: true },
      },
      userOverride: {
        select: {
          isAccessDisabled: true,
          roleOverride: { select: { id: true, code: true, name: true, isActive: true } },
        },
      },
      permissionOverrides: {
        select: { effect: true, permission: { select: { code: true } } },
      },
    },
  });

  return NextResponse.json({ success: true, data: { users } });
});

export const POST = withApiHandler(async (request, context: Context) => {
  const { applicationId } = await context.params;
  const session = await requireApiPermission("users.manage", applicationId);
  const body = createSchema.parse(await request.json());

  const [application, role] = await Promise.all([
    prisma.application.findUnique({ where: { id: applicationId }, select: { id: true, status: true } }),
    prisma.role.findFirst({ where: { id: body.roleId, applicationId, isActive: true }, select: { id: true } }),
  ]);

  if (!application || application.status !== "ACTIVE") {
    throw new AppError(404, "APPLICATION_NOT_FOUND", "Active application was not found");
  }
  if (!role) throw new AppError(400, "INVALID_ROLE", "Role is invalid for this application");

  if (body.primaryGroupId) {
    const primaryGroup = await prisma.group.findFirst({
      where: { id: body.primaryGroupId, applicationId, source: "INTERNAL", isActive: true },
      select: { id: true },
    });
    if (!primaryGroup) throw new AppError(400, "INVALID_PRIMARY_GROUP", "Primary group is invalid for this application");
  }

  const duplicateUser = await prisma.internalUser.findUnique({
    where: { username: body.username },
    select: { id: true },
  });
  if (duplicateUser) throw new AppError(409, "USERNAME_EXISTS", "Username already exists");

  const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.internalUser.create({
      data: {
        username: body.username,
        name: body.name,
        passwordHash,
        isProtectedRoot: false,
        isActive: true,
      },
    });

    const identity = await tx.userIdentity.create({
      data: {
        applicationId,
        username: body.username,
        source: "INTERNAL",
        internalUserId: user.id,
        displayNameSnapshot: body.name,
        isActive: true,
      },
    });

    await tx.userOverride.create({
      data: { userIdentityId: identity.id, roleOverrideId: body.roleId },
    });

    await tx.notificationSetting.create({ data: { userIdentityId: identity.id } });

    if (body.primaryGroupId) {
      await tx.userGroup.create({
        data: {
          userIdentityId: identity.id,
          groupId: body.primaryGroupId,
          source: "INTERNAL",
          isPrimary: true,
        },
      });
    }

    return { user, identity };
  });

  await writeAuditLog({
    session,
    applicationId,
    action: "INTERNAL_USER_CREATED",
    entityType: "UserIdentity",
    entityId: created.identity.id,
    afterData: {
      username: created.identity.username,
      name: created.identity.displayNameSnapshot,
      roleId: body.roleId,
      primaryGroupId: body.primaryGroupId ?? null,
    },
  });

  return NextResponse.json(
    {
      success: true,
      data: {
        user: {
          id: created.identity.id,
          username: created.identity.username,
          name: created.identity.displayNameSnapshot,
          roleId: body.roleId,
        },
      },
    },
    { status: 201 },
  );
});

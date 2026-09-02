import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { requireApiPermission } from "@/lib/rbac/guards";
import { assertUniqueRoleCode } from "@/lib/rbac/role-service";


type Context = { params: Promise<{ applicationId: string }> };

type RoleListRow = {
  id: string; code: string; name: string; description: string | null; isActive: boolean;
  _count: { integrationMappings: number; userOverrides: number; presenceRecords: number; reportScopes: number };
};

const createRoleSchema = z.object({
  code: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  permissionCodes: z.array(z.string().trim().min(1)).default([]),
});

export const GET = withApiHandler(async (_request, context: Context) => {
  const { applicationId } = await context.params;
  await requireApiPermission("roles.view", applicationId);

  const roles = await prisma.role.findMany({
    where: { applicationId },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: {
      permissions: {
        select: { permission: { select: { code: true, name: true, module: true } } },
      },
      _count: {
        select: {
          integrationMappings: true,
          userOverrides: true,
          presenceRecords: true,
          reportScopes: true,
        },
      },
    },
  }) as RoleListRow[];

  return NextResponse.json({
    success: true,
    data: {
      roles: roles.map((role) => ({
        ...role,
        usage: {
          integrationMappings: role._count.integrationMappings,
          userOverrides: role._count.userOverrides,
          presenceRecords: role._count.presenceRecords,
          reportScopes: role._count.reportScopes,
        },
        _count: undefined,
      })),
    },
  });
});

export const POST = withApiHandler(async (request, context: Context) => {
  const { applicationId } = await context.params;
  const session = await requireApiPermission("roles.manage", applicationId);
  const body = createRoleSchema.parse(await request.json());

  const [application, normalizedCode] = await Promise.all([
    prisma.application.findUnique({ where: { id: applicationId }, select: { id: true } }),
    assertUniqueRoleCode(applicationId, body.code),
  ]);
  if (!application) throw new AppError(404, "APPLICATION_NOT_FOUND", "Application was not found");

  const permissions = body.permissionCodes.length
    ? await prisma.permission.findMany({
        where: { code: { in: [...new Set(body.permissionCodes)] }, isActive: true },
        select: { id: true, code: true },
      })
    : [];

  if (permissions.length !== new Set(body.permissionCodes).size) {
    throw new AppError(400, "INVALID_PERMISSION", "One or more permissions are invalid");
  }

  const role = await prisma.$transaction(async (tx) => {
    const created = await tx.role.create({
      data: {
        applicationId,
        code: normalizedCode,
        name: body.name,
        description: body.description ?? null,
      },
    });

    if (permissions.length) {
      await tx.rolePermission.createMany({
        data: permissions.map((permission: { id: string; code: string }) => ({ roleId: created.id, permissionId: permission.id })),
      });
    }

    return created;
  });

  await writeAuditLog({
    session,
    applicationId,
    action: "RBAC_ROLE_CREATED",
    entityType: "Role",
    entityId: role.id,
    afterData: { ...role, permissionCodes: permissions.map((permission: { id: string; code: string }) => permission.code) },
  });

  return NextResponse.json({ success: true, data: { role } }, { status: 201 });
});

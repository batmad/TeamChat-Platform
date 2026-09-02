import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { requireApiPermission } from "@/lib/rbac/guards";

type Context = { params: Promise<{ applicationId: string; roleId: string }> };
const schema = z.object({ permissionCodes: z.array(z.string().trim().min(1)) });

export const PUT = withApiHandler(async (request, context: Context) => {
  const { applicationId, roleId } = await context.params;
  const session = await requireApiPermission("roles.manage", applicationId);
  const body = schema.parse(await request.json());
  const uniqueCodes = [...new Set(body.permissionCodes)];

  const role = await prisma.role.findFirst({
    where: { id: roleId, applicationId },
    include: { permissions: { select: { permission: { select: { code: true } } } } },
  });
  if (!role) throw new AppError(404, "ROLE_NOT_FOUND", "Role was not found");

  const permissions = uniqueCodes.length
    ? await prisma.permission.findMany({
        where: { code: { in: uniqueCodes }, isActive: true },
        select: { id: true, code: true },
      })
    : [];

  if (permissions.length !== uniqueCodes.length) {
    throw new AppError(400, "INVALID_PERMISSION", "One or more permissions are invalid");
  }

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    if (permissions.length) {
      await tx.rolePermission.createMany({
        data: permissions.map((permission: { id: string; code: string }) => ({ roleId, permissionId: permission.id })),
      });
    }
  });

  await writeAuditLog({
    session,
    applicationId,
    action: "RBAC_ROLE_PERMISSIONS_REPLACED",
    entityType: "Role",
    entityId: roleId,
    beforeData: { permissionCodes: role.permissions.map(({ permission }: { permission: { code: string } }) => permission.code) },
    afterData: { permissionCodes: permissions.map((permission: { id: string; code: string }) => permission.code) },
  });

  return NextResponse.json({
    success: true,
    data: { roleId, permissionCodes: permissions.map((permission: { id: string; code: string }) => permission.code).sort() },
  });
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { requireApiPermission } from "@/lib/rbac/guards";
import { assertRoleCanDeactivate, assertUniqueRoleCode, getRoleUsage } from "@/lib/rbac/role-service";


type Context = { params: Promise<{ applicationId: string; roleId: string }> };

const updateSchema = z.object({
  code: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9._-]+$/).optional(),
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "At least one role field is required" });

export const GET = withApiHandler(async (_request, context: Context) => {
  const { applicationId, roleId } = await context.params;
  await requireApiPermission("roles.view", applicationId);

  const role = await prisma.role.findFirst({
    where: { id: roleId, applicationId },
    include: {
      permissions: { select: { permission: { select: { code: true, name: true, module: true } } } },
    },
  });
  if (!role) throw new AppError(404, "ROLE_NOT_FOUND", "Role was not found");

  const usage = await getRoleUsage(roleId);
  return NextResponse.json({ success: true, data: { role: { ...role, usage } } });
});

export const PATCH = withApiHandler(async (request, context: Context) => {
  const { applicationId, roleId } = await context.params;
  const session = await requireApiPermission("roles.manage", applicationId);
  const body = updateSchema.parse(await request.json());

  const existing = await prisma.role.findFirst({ where: { id: roleId, applicationId } });
  if (!existing) throw new AppError(404, "ROLE_NOT_FOUND", "Role was not found");

  if (body.isActive === false && existing.isActive) {
    await assertRoleCanDeactivate(roleId);
  }

  const normalizedCode = body.code
    ? await assertUniqueRoleCode(applicationId, body.code, roleId)
    : undefined;

  const role = await prisma.role.update({
    where: { id: roleId },
    data: {
      ...(normalizedCode !== undefined ? { code: normalizedCode } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    },
  });

  await writeAuditLog({
    session,
    applicationId,
    action: body.isActive === true && !existing.isActive
      ? "RBAC_ROLE_ACTIVATED"
      : body.isActive === false && existing.isActive
        ? "RBAC_ROLE_DEACTIVATED"
        : "RBAC_ROLE_UPDATED",
    entityType: "Role",
    entityId: roleId,
    beforeData: existing,
    afterData: role,
  });

  return NextResponse.json({ success: true, data: { role } });
});

export const DELETE = withApiHandler(async (_request, context: Context) => {
  const { applicationId, roleId } = await context.params;
  const session = await requireApiPermission("roles.manage", applicationId);

  const existing = await prisma.role.findFirst({ where: { id: roleId, applicationId } });
  if (!existing) throw new AppError(404, "ROLE_NOT_FOUND", "Role was not found");

  if (!existing.isActive) {
    return NextResponse.json({ success: true, data: { role: existing } });
  }

  const usage = await assertRoleCanDeactivate(roleId);
  const role = await prisma.role.update({ where: { id: roleId }, data: { isActive: false } });

  await writeAuditLog({
    session,
    applicationId,
    action: "RBAC_ROLE_DEACTIVATED",
    entityType: "Role",
    entityId: roleId,
    beforeData: existing,
    afterData: { ...role, usageAtDeactivation: usage },
  });

  return NextResponse.json({ success: true, data: { role } });
});

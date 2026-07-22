import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { canDeleteInternalGroup, normalizeGroupCode } from "@/lib/groups/rules";
import { requireApiPermission } from "@/lib/rbac/guards";

type Context = { params: Promise<{ applicationId: string; groupId: string }> };

const updateSchema = z.object({
  code: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(150).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});

async function getGroup(applicationId: string, groupId: string) {
  return prisma.group.findFirst({
    where: { id: groupId, applicationId },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      source: true,
      externalKey: true,
      isActive: true,
      _count: {
        select: {
          members: true,
          rooms: true,
          forbiddenWords: true,
          reportScopeGroups: true,
          messageContexts: true,
        },
      },
    },
  });
}

export const PATCH = withApiHandler(async (request, context: Context) => {
  const { applicationId, groupId } = await context.params;
  const session = await requireApiPermission("groups.manage", applicationId);
  const body = updateSchema.parse(await request.json());
  const current = await getGroup(applicationId, groupId);
  if (!current) throw new AppError(404, "GROUP_NOT_FOUND", "Group was not found");
  if (current.source === "EXTERNAL") {
    throw new AppError(409, "EXTERNAL_GROUP_READ_ONLY", "External groups are managed by integration synchronization");
  }

  const code = body.code !== undefined ? normalizeGroupCode(body.code) : undefined;
  if (code && code !== current.code) {
    const duplicate = await prisma.group.findUnique({
      where: { applicationId_code: { applicationId, code } },
      select: { id: true },
    });
    if (duplicate) throw new AppError(409, "GROUP_CODE_EXISTS", "Group code already exists in this application");
  }

  const updated = await prisma.group.update({
    where: { id: groupId },
    data: {
      ...(code !== undefined ? { code } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    },
    select: { id: true, code: true, name: true, description: true, source: true, isActive: true },
  });

  await writeAuditLog({
    session,
    applicationId,
    action: "GROUP_UPDATED",
    entityType: "Group",
    entityId: groupId,
    beforeData: current,
    afterData: updated,
  });

  return NextResponse.json({ success: true, data: { group: updated } });
});

export const DELETE = withApiHandler(async (_request, context: Context) => {
  const { applicationId, groupId } = await context.params;
  const session = await requireApiPermission("groups.manage", applicationId);
  const current = await getGroup(applicationId, groupId);
  if (!current) throw new AppError(404, "GROUP_NOT_FOUND", "Group was not found");
  if (current.source === "EXTERNAL") {
    throw new AppError(409, "EXTERNAL_GROUP_READ_ONLY", "External groups are managed by integration synchronization");
  }
  if (!canDeleteInternalGroup(current._count)) {
    throw new AppError(409, "GROUP_IN_USE", "Group is still referenced and cannot be deleted", current._count);
  }

  await prisma.group.delete({ where: { id: groupId } });
  await writeAuditLog({
    session,
    applicationId,
    action: "GROUP_DELETED",
    entityType: "Group",
    entityId: groupId,
    beforeData: current,
  });
  return NextResponse.json({ success: true });
});

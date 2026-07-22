import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { normalizeGroupCode } from "@/lib/groups/rules";
import { requireApiPermission } from "@/lib/rbac/guards";

type Context = { params: Promise<{ applicationId: string }> };

const createSchema = z.object({
  code: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(500).nullable().optional(),
});

export const GET = withApiHandler(async (_request, context: Context) => {
  const { applicationId } = await context.params;
  await requireApiPermission("groups.view", applicationId);

  const groups = await prisma.group.findMany({
    where: { applicationId },
    orderBy: [{ source: "asc" }, { name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      source: true,
      externalKey: true,
      isActive: true,
      _count: { select: { members: true, rooms: true } },
    },
  });

  return NextResponse.json({ success: true, data: { groups } });
});

export const POST = withApiHandler(async (request, context: Context) => {
  const { applicationId } = await context.params;
  const session = await requireApiPermission("groups.manage", applicationId);
  const body = createSchema.parse(await request.json());
  const code = normalizeGroupCode(body.code);

  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { id: true, status: true },
  });
  if (!application || application.status !== "ACTIVE") {
    throw new AppError(404, "APPLICATION_NOT_FOUND", "Active application was not found");
  }

  const existing = await prisma.group.findUnique({
    where: { applicationId_code: { applicationId, code } },
    select: { id: true },
  });
  if (existing) throw new AppError(409, "GROUP_CODE_EXISTS", "Group code already exists in this application");

  const group = await prisma.group.create({
    data: {
      applicationId,
      code,
      name: body.name,
      description: body.description ?? null,
      source: "INTERNAL",
      isActive: true,
    },
    select: { id: true, code: true, name: true, description: true, source: true, isActive: true },
  });

  await writeAuditLog({
    session,
    applicationId,
    action: "GROUP_CREATED",
    entityType: "Group",
    entityId: group.id,
    afterData: group,
  });

  return NextResponse.json({ success: true, data: { group } }, { status: 201 });
});

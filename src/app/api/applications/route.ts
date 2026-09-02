import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { generateApplicationKey, normalizeApplicationKey } from "@/lib/applications/application-key";
import { APPLICATION_RETENTION_DEFINITIONS, applicationRetentionKey } from "@/lib/applications/constants";
import { normalizeAllowedOrigins } from "@/lib/applications/origins";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { requireApiPermission, requireApiRoot } from "@/lib/rbac/guards";

const createSchema = z.object({
  key: z.string().trim().min(6).max(100).regex(/^[A-Za-z0-9._-]+$/).optional(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  allowedOrigins: z.array(z.string().trim().min(1)).max(30).default([]),
});

export const GET = withApiHandler(async () => {
  const session = await requireApiPermission("applications.view");

  const applications = await prisma.application.findMany({
    where: session.isRoot ? undefined : { id: session.applicationId ?? "__none__" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      status: true,
      allowedOrigins: true,
      createdAt: true,
      updatedAt: true,
      widgetConfig: true,
      integrations: {
        select: { id: true, name: true, type: true, status: true, isDefaultUserSource: true },
        orderBy: { name: "asc" },
      },
      retentionPolicies: {
        where: { isActive: true },
        select: { id: true, dataType: true, category: true, retentionDays: true, keepForever: true },
        orderBy: [{ dataType: "asc" }, { category: "asc" }],
      },
    },
  });

  return NextResponse.json({ success: true, data: { applications } });
});

export const POST = withApiHandler(async (request) => {
  const session = await requireApiRoot();
  const body = createSchema.parse(await request.json());
  const applicationId = randomUUID();
  const key = normalizeApplicationKey(body.key ?? generateApplicationKey());
  const allowedOrigins = normalizeAllowedOrigins(body.allowedOrigins);

  const existingKey = await prisma.application.findUnique({ where: { key }, select: { id: true } });
  if (existingKey) throw new AppError(409, "APPLICATION_KEY_EXISTS", "Application key is already in use");

  const application = await prisma.$transaction(async (tx) => {
    const created = await tx.application.create({
      data: {
        id: applicationId,
        key,
        name: body.name,
        description: body.description ?? null,
        allowedOrigins,
        widgetConfig: { create: {} },
        retentionPolicies: {
          create: APPLICATION_RETENTION_DEFINITIONS.map((definition) => ({
            key: applicationRetentionKey(applicationId, definition.dataType, definition.category),
            dataType: definition.dataType,
            category: definition.category,
            retentionDays: definition.retentionDays,
            keepForever: definition.keepForever,
            isActive: true,
          })),
        },
      },
      include: { widgetConfig: true, retentionPolicies: true },
    });
    return created;
  });

  await writeAuditLog({
    session,
    applicationId,
    action: "APPLICATION_CREATED",
    entityType: "Application",
    entityId: application.id,
    afterData: {
      id: application.id,
      key: application.key,
      name: application.name,
      status: application.status,
      allowedOrigins: application.allowedOrigins,
    },
  });

  return NextResponse.json({ success: true, data: { application } }, { status: 201 });
});

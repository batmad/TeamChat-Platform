import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/api/app-error";
import { APPLICATION_RETENTION_DEFINITIONS, applicationRetentionKey } from "@/lib/applications/constants";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { requireApiPermission } from "@/lib/rbac/guards";

type Context = { params: Promise<{ applicationId: string }> };

const retentionSchema = z.object({
  policies: z.array(
    z.object({
      dataType: z.enum(["LOG", "CHAT"]),
      category: z.string().trim().min(1),
      keepForever: z.boolean(),
      retentionDays: z.number().int().min(1).max(36500).nullable(),
    }).superRefine((value, ctx) => {
      if (value.keepForever && value.retentionDays !== null) {
        ctx.addIssue({ code: "custom", message: "retentionDays must be null when keepForever is true" });
      }
      if (!value.keepForever && value.retentionDays === null) {
        ctx.addIssue({ code: "custom", message: "retentionDays is required when keepForever is false" });
      }
    }),
  ).min(1),
});

function validDefinition(dataType: "LOG" | "CHAT", category: string) {
  return APPLICATION_RETENTION_DEFINITIONS.find((item) => item.dataType === dataType && item.category === category);
}

export const GET = withApiHandler(async (_request, context: Context) => {
  const { applicationId } = await context.params;
  await requireApiPermission("applications.view", applicationId);
  const policies = await prisma.retentionPolicy.findMany({
    where: { applicationId, isActive: true },
    orderBy: [{ dataType: "asc" }, { category: "asc" }],
  });
  return NextResponse.json({ success: true, data: { policies } });
});

export const PUT = withApiHandler(async (request, context: Context) => {
  const { applicationId } = await context.params;
  const session = await requireApiPermission("applications.manage", applicationId);
  const body = retentionSchema.parse(await request.json());

  const application = await prisma.application.findUnique({ where: { id: applicationId }, select: { id: true } });
  if (!application) throw new AppError(404, "APPLICATION_NOT_FOUND", "Application was not found");

  const uniqueKeys = new Set(body.policies.map((item) => `${item.dataType}:${item.category}`));
  if (uniqueKeys.size !== body.policies.length) {
    throw new AppError(400, "DUPLICATE_RETENTION_POLICY", "Each retention category can only be configured once");
  }

  for (const policy of body.policies) {
    if (!validDefinition(policy.dataType, policy.category)) {
      throw new AppError(400, "INVALID_RETENTION_CATEGORY", `Unsupported retention category: ${policy.dataType}:${policy.category}`);
    }
  }

  const before = await prisma.retentionPolicy.findMany({ where: { applicationId, isActive: true } });

  await prisma.$transaction(
    body.policies.map((policy) =>
      prisma.retentionPolicy.upsert({
        where: { key: applicationRetentionKey(applicationId, policy.dataType, policy.category) },
        update: {
          retentionDays: policy.retentionDays,
          keepForever: policy.keepForever,
          isActive: true,
        },
        create: {
          key: applicationRetentionKey(applicationId, policy.dataType, policy.category),
          applicationId,
          dataType: policy.dataType,
          category: policy.category,
          retentionDays: policy.retentionDays,
          keepForever: policy.keepForever,
          isActive: true,
        },
      }),
    ),
  );

  const after = await prisma.retentionPolicy.findMany({
    where: { applicationId, isActive: true },
    orderBy: [{ dataType: "asc" }, { category: "asc" }],
  });

  await writeAuditLog({
    session,
    applicationId,
    action: "APPLICATION_RETENTION_UPDATED",
    entityType: "RetentionPolicy",
    entityId: applicationId,
    beforeData: before,
    afterData: after,
  });

  return NextResponse.json({ success: true, data: { policies: after } });
});

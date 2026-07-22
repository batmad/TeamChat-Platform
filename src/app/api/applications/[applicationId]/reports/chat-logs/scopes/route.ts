import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { requireApiPermission } from "@/lib/rbac/guards";
import { CHAT_LOGS_REPORT_CODE } from "@/lib/reports/chat-logs-scope";
import { getChatLogsScopeCatalog } from "@/lib/reports/scope-admin";

type Context = { params: Promise<{ applicationId: string }> };

const upsertSchema = z.object({
  subjectType: z.enum(["ROLE", "USER"]),
  subjectId: z.string().uuid(),
  scopeType: z.enum(["OWN_GROUP", "SELECTED_GROUPS", "ALL_GROUPS"]),
  groupIds: z.array(z.string().uuid()).max(500).default([]),
});

const deleteSchema = z.object({
  subjectType: z.enum(["ROLE", "USER"]),
  subjectId: z.string().uuid(),
});

async function requireReport() {
  const report = await prisma.reportDefinition.findUnique({ where: { code: CHAT_LOGS_REPORT_CODE }, select: { id: true } });
  if (!report) throw new AppError(503, "REPORT_UNAVAILABLE", "Chat Logs Report is not configured");
  return report;
}

function subjectKey(type: "ROLE" | "USER", id: string) {
  return `${type}:${id}`;
}

export const GET = withApiHandler(async (_request, context: Context) => {
  const { applicationId } = await context.params;
  await requireApiPermission("reports.chat_logs.scope.manage", applicationId);
  const data = await getChatLogsScopeCatalog(applicationId);
  return NextResponse.json({ success: true, data });
});

export const PUT = withApiHandler(async (request, context: Context) => {
  const { applicationId } = await context.params;
  const session = await requireApiPermission("reports.chat_logs.scope.manage", applicationId);
  const input = upsertSchema.parse(await request.json());
  const report = await requireReport();

  if (input.subjectType === "ROLE") {
    const role = await prisma.role.findFirst({ where: { id: input.subjectId, applicationId, isActive: true }, select: { id: true } });
    if (!role) throw new AppError(404, "REPORT_SCOPE_SUBJECT_NOT_FOUND", "Role was not found");
  } else {
    const user = await prisma.userIdentity.findFirst({ where: { id: input.subjectId, applicationId, isActive: true }, select: { id: true } });
    if (!user) throw new AppError(404, "REPORT_SCOPE_SUBJECT_NOT_FOUND", "User was not found");
  }

  const uniqueGroupIds = [...new Set(input.groupIds)];
  if (input.scopeType === "SELECTED_GROUPS" && !uniqueGroupIds.length) {
    throw new AppError(400, "REPORT_SCOPE_GROUP_REQUIRED", "Selected Groups scope requires at least one group");
  }
  if (uniqueGroupIds.length) {
    const count = await prisma.group.count({ where: { applicationId, isActive: true, id: { in: uniqueGroupIds } } });
    if (count !== uniqueGroupIds.length) {
      throw new AppError(400, "REPORT_SCOPE_GROUP_INVALID", "One or more selected groups are invalid");
    }
  }

  const key = subjectKey(input.subjectType, input.subjectId);
  const before = await prisma.reportScopeAssignment.findUnique({
    where: { reportId_applicationId_subjectKey: { reportId: report.id, applicationId, subjectKey: key } },
    include: { groups: true },
  });

  const assignment = await prisma.$transaction(async (tx) => {
    const saved = await tx.reportScopeAssignment.upsert({
      where: { reportId_applicationId_subjectKey: { reportId: report.id, applicationId, subjectKey: key } },
      update: {
        subjectType: input.subjectType,
        roleId: input.subjectType === "ROLE" ? input.subjectId : null,
        userIdentityId: input.subjectType === "USER" ? input.subjectId : null,
        scopeType: input.scopeType,
      },
      create: {
        reportId: report.id,
        applicationId,
        subjectType: input.subjectType,
        subjectKey: key,
        roleId: input.subjectType === "ROLE" ? input.subjectId : null,
        userIdentityId: input.subjectType === "USER" ? input.subjectId : null,
        scopeType: input.scopeType,
      },
    });
    await tx.reportScopeGroup.deleteMany({ where: { scopeAssignmentId: saved.id } });
    if (input.scopeType === "SELECTED_GROUPS" && uniqueGroupIds.length) {
      await tx.reportScopeGroup.createMany({ data: uniqueGroupIds.map((groupId) => ({ scopeAssignmentId: saved.id, groupId })) });
    }
    return saved;
  });

  await writeAuditLog({
    session,
    applicationId,
    action: "CHAT_LOG_REPORT_SCOPE_UPDATED",
    entityType: "ReportScopeAssignment",
    entityId: assignment.id,
    beforeData: before,
    afterData: { ...input, subjectKey: key },
  });
  return NextResponse.json({ success: true, data: { assignment } });
});

export const DELETE = withApiHandler(async (request, context: Context) => {
  const { applicationId } = await context.params;
  const session = await requireApiPermission("reports.chat_logs.scope.manage", applicationId);
  const input = deleteSchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  const report = await requireReport();
  const key = subjectKey(input.subjectType, input.subjectId);
  const current = await prisma.reportScopeAssignment.findUnique({
    where: { reportId_applicationId_subjectKey: { reportId: report.id, applicationId, subjectKey: key } },
    include: { groups: true },
  });
  if (!current) throw new AppError(404, "REPORT_SCOPE_NOT_FOUND", "Report scope assignment was not found");
  await prisma.reportScopeAssignment.delete({ where: { id: current.id } });
  await writeAuditLog({
    session,
    applicationId,
    action: "CHAT_LOG_REPORT_SCOPE_DELETED",
    entityType: "ReportScopeAssignment",
    entityId: current.id,
    beforeData: current,
  });
  return NextResponse.json({ success: true });
});

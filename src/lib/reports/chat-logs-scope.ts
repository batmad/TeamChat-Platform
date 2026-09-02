import "server-only";
import { AppError } from "@/lib/api/app-error";
import type { CurrentSession } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { resolveEffectiveGroups } from "@/lib/groups/effective-groups";
import { sessionHasPermission } from "@/lib/rbac/guards";
import { chooseReportScopeAssignment, reportScopeAllowsGroup } from "@/lib/reports/rules";

export const CHAT_LOGS_REPORT_CODE = "chat_logs";

export type ChatLogsScope = {
  reportId: string;
  applicationId: string;
  scopeType: "OWN_GROUP" | "SELECTED_GROUPS" | "ALL_GROUPS";
  source: "ROOT" | "USER" | "ROLE" | "DEFAULT";
  unrestricted: boolean;
  allowedGroups: Array<{ id: string; code: string; name: string }>;
};

async function requireReportDefinition() {
  const report = await prisma.reportDefinition.findUnique({
    where: { code: CHAT_LOGS_REPORT_CODE },
    select: { id: true, code: true, name: true, isActive: true },
  });
  if (!report?.isActive) {
    throw new AppError(503, "REPORT_UNAVAILABLE", "Chat Logs Report is not available");
  }
  return report;
}

async function getActiveGroups(applicationId: string, ids?: string[]) {
  return prisma.group.findMany({
    where: {
      applicationId,
      isActive: true,
      ...(ids ? { id: { in: ids.length ? ids : ["__none__"] } } : {}),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, code: true, name: true },
  });
}

export async function resolveChatLogsScope(
  session: CurrentSession,
  applicationId: string,
): Promise<ChatLogsScope> {
  const report = await requireReportDefinition();
  const application = await prisma.application.findFirst({
    where: { id: applicationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!application) throw new AppError(404, "APPLICATION_NOT_FOUND", "Application was not found");

  if (session.isRoot) {
    return {
      reportId: report.id,
      applicationId,
      scopeType: "ALL_GROUPS",
      source: "ROOT",
      unrestricted: true,
      allowedGroups: await getActiveGroups(applicationId),
    };
  }

  if (session.applicationId !== applicationId) {
    throw new AppError(403, "APPLICATION_SCOPE_DENIED", "Application access is not allowed");
  }
  if (!sessionHasPermission(session, "reports.chat_logs.view")) {
    throw new AppError(403, "FORBIDDEN", "Chat Logs Report access is not allowed");
  }
  if (!session.userIdentityId) {
    throw new AppError(403, "REPORT_IDENTITY_REQUIRED", "A user identity is required for report scope resolution");
  }

  const [userAssignment, roleAssignment] = await Promise.all([
    prisma.reportScopeAssignment.findFirst({
      where: {
        reportId: report.id,
        applicationId,
        subjectType: "USER",
        userIdentityId: session.userIdentityId,
      },
      include: {
        groups: { include: { group: { select: { id: true, code: true, name: true, isActive: true, applicationId: true } } } },
      },
    }),
    session.role?.id
      ? prisma.reportScopeAssignment.findFirst({
          where: {
            reportId: report.id,
            applicationId,
            subjectType: "ROLE",
            roleId: session.role.id,
          },
          include: {
            groups: { include: { group: { select: { id: true, code: true, name: true, isActive: true, applicationId: true } } } },
          },
        })
      : Promise.resolve(null),
  ]);

  const selected = chooseReportScopeAssignment(userAssignment, roleAssignment);
  const assignment = selected.assignment;
  const source: ChatLogsScope["source"] = selected.source;
  const scopeType = assignment?.scopeType ?? "OWN_GROUP";

  if (scopeType === "ALL_GROUPS") {
    return {
      reportId: report.id,
      applicationId,
      scopeType,
      source,
      unrestricted: true,
      allowedGroups: await getActiveGroups(applicationId),
    };
  }

  if (scopeType === "SELECTED_GROUPS") {
    const ids = (assignment?.groups ?? [])
      .map((entry: { group: { id: string; applicationId: string; isActive: boolean } }) => entry.group)
      .filter((group: { applicationId: string; isActive: boolean }) => group.applicationId === applicationId && group.isActive)
      .map((group: { id: string }) => group.id);
    return {
      reportId: report.id,
      applicationId,
      scopeType,
      source,
      unrestricted: false,
      allowedGroups: await getActiveGroups(applicationId, ids),
    };
  }

  const ownGroups = await resolveEffectiveGroups(session.userIdentityId);
  const ids = ownGroups.map((group) => group.id);
  return {
    reportId: report.id,
    applicationId,
    scopeType: "OWN_GROUP",
    source,
    unrestricted: false,
    allowedGroups: await getActiveGroups(applicationId, ids),
  };
}

export function ensureRequestedGroupInScope(scope: ChatLogsScope, groupId?: string | null) {
  if (!groupId || scope.unrestricted) return;
  if (!reportScopeAllowsGroup({ unrestricted: scope.unrestricted, allowedGroupIds: scope.allowedGroups.map((group) => group.id), groupId })) {
    throw new AppError(403, "REPORT_GROUP_SCOPE_DENIED", "The selected group is outside your report data scope");
  }
}

import "server-only";
import { AppError } from "@/lib/api/app-error";
import { prisma } from "@/lib/db/prisma";
import { CHAT_LOGS_REPORT_CODE } from "@/lib/reports/chat-logs-scope";

export async function getChatLogsScopeCatalog(applicationId: string) {
  const report = await prisma.reportDefinition.findUnique({ where: { code: CHAT_LOGS_REPORT_CODE }, select: { id: true } });
  if (!report) throw new AppError(503, "REPORT_UNAVAILABLE", "Chat Logs Report is not configured");
  const [roles, users, groups, assignments] = await Promise.all([
    prisma.role.findMany({
      where: { applicationId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.userIdentity.findMany({
      where: { applicationId, isActive: true },
      orderBy: { username: "asc" },
      take: 500,
      select: { id: true, username: true, displayNameSnapshot: true, source: true },
    }),
    prisma.group.findMany({
      where: { applicationId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.reportScopeAssignment.findMany({
      where: { reportId: report.id, applicationId },
      orderBy: [{ subjectType: "asc" }, { subjectKey: "asc" }],
      include: {
        role: { select: { id: true, code: true, name: true } },
        userIdentity: { select: { id: true, username: true, displayNameSnapshot: true } },
        groups: { include: { group: { select: { id: true, code: true, name: true } } } },
      },
    }),
  ]);
  return { roles, users, groups, assignments };
}

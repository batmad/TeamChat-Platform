import { redirect } from "next/navigation";
import { ModerationManager } from "@/components/moderation/moderation-manager";
import { requireSession } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { sessionHasPermission } from "@/lib/rbac/guards";

type Rule = {
  id: string;
  applicationId: string | null;
  groupId: string | null;
  scope: "GLOBAL" | "APPLICATION" | "GROUP";
  pattern: string;
  matchMode: "EXACT_WORD" | "CONTAINS";
  isActive: boolean;
  createdAt: Date;
  group: { id: string; code: string; name: string } | null;
  _count: { violationLogs: number };
};

type App = {
  id: string;
  key: string;
  name: string;
  groups: Array<{ id: string; code: string; name: string }>;
  forbiddenWords: Rule[];
};

export default async function ModerationPage() {
  const session = await requireSession();
  if (!sessionHasPermission(session, "moderation.view")) redirect("/unauthorized");

  const applications = (await prisma.application.findMany({
    where: session.isRoot ? { status: "ACTIVE" } : { id: session.applicationId ?? "__none__", status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: {
      id: true, key: true, name: true,
      groups: { where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } },
      forbiddenWords: {
        orderBy: [{ scope: "asc" }, { pattern: "asc" }],
        select: { id: true, applicationId: true, groupId: true, scope: true, pattern: true, matchMode: true, isActive: true, createdAt: true, group: { select: { id: true, code: true, name: true } }, _count: { select: { violationLogs: true } } },
      },
    },
  })) as App[];

  const globalRules = (await prisma.forbiddenWord.findMany({
    where: { scope: "GLOBAL", applicationId: null, groupId: null },
    orderBy: { pattern: "asc" },
    select: { id: true, applicationId: true, groupId: true, scope: true, pattern: true, matchMode: true, isActive: true, createdAt: true, _count: { select: { violationLogs: true } } },
  })) as Array<Omit<Rule, "group">>;

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <p className="text-sm font-medium text-slate-500">Content Moderation</p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-950">Forbidden Words</h1>
          <p className="mt-2 text-slate-600">Kelola rule GLOBAL, APPLICATION, dan GROUP. Pesan yang cocok diblokir sebelum disimpan.</p>
        </div>
        <ModerationManager
          applications={applications.map((application) => ({
            id: application.id,
            key: application.key,
            name: application.name,
            groups: application.groups,
            rules: application.forbiddenWords.map((rule) => ({ ...rule, createdAt: rule.createdAt.toISOString(), violationCount: rule._count.violationLogs })),
          }))}
          globalRules={globalRules.map((rule) => ({ ...rule, group: null, createdAt: rule.createdAt.toISOString(), violationCount: rule._count.violationLogs }))}
          isRoot={session.isRoot}
          canManage={sessionHasPermission(session, "moderation.manage")}
        />
      </div>
    </main>
  );
}

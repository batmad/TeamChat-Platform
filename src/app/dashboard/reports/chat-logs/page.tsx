import { redirect } from "next/navigation";
import { ChatLogsReportManager } from "@/components/reports/chat-logs-report-manager";
import { requireSession } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { sessionHasPermission } from "@/lib/rbac/guards";
import { resolveChatLogsScope } from "@/lib/reports/chat-logs-scope";
import { getChatLogsScopeCatalog } from "@/lib/reports/scope-admin";

export default async function ChatLogsReportPage() {
  const session = await requireSession();
  if (!sessionHasPermission(session, "reports.chat_logs.view"))
    redirect("/unauthorized");
  const applications = await prisma.application.findMany({
    where: session.isRoot
      ? { status: "ACTIVE" }
      : { id: session.applicationId ?? "__none__", status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, key: true, name: true },
  });
  const initialApplicationId = applications[0]?.id ?? null;
  const canManageScopes = sessionHasPermission(
    session,
    "reports.chat_logs.scope.manage",
  );
  const [initialScope, initialCatalog] = initialApplicationId
    ? await Promise.all([
        resolveChatLogsScope(session, initialApplicationId).then((scope) => ({
          type: scope.scopeType,
          source: scope.source,
          unrestricted: scope.unrestricted,
          groups: scope.allowedGroups,
        })),
        canManageScopes
          ? getChatLogsScopeCatalog(initialApplicationId)
          : Promise.resolve(null),
      ])
    : [null, null];
  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <p className="text-sm font-medium text-slate-500">Reporting</p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-950">
            Chat Logs Report
          </h1>
          <p className="mt-2 text-slate-600">
            Tarik histori private dan group chat berdasarkan tanggal, group,
            username, dan tipe chat. Semua query dibatasi oleh permission dan
            data scope efektif.
          </p>
        </div>
        <ChatLogsReportManager
          applications={applications}
          canExport={sessionHasPermission(session, "reports.chat_logs.export")}
          canManageScopes={canManageScopes}
          initialScope={initialScope}
          initialCatalog={initialCatalog}
        />
      </div>
    </main>
  );
}

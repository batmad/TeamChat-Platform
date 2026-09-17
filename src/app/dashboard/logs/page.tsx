import { redirect } from "next/navigation";
import { LogsManager } from "@/components/logs/logs-manager";
import { requireSession } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { sessionHasPermission } from "@/lib/rbac/guards";
import { RetentionDataType } from "@/generated/prisma/enums";

export default async function LogsPage() {
  const session = await requireSession();
  if (!sessionHasPermission(session, "logs.view")) redirect("/unauthorized");

  const applicationsResult = await prisma.application.findMany({
    where: session.isRoot
      ? { status: "ACTIVE" }
      : { id: session.applicationId ?? "__none__", status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      key: true,
      name: true,
      retentionPolicies: {
        where: { dataType: RetentionDataType.LOG, isActive: true },
        orderBy: { category: "asc" },
        select: {
          dataType: true,
          category: true,
          retentionDays: true,
          keepForever: true,
        },
      },
    },
  });

  const applications = applicationsResult.map((application) => ({
    ...application,
    retentionPolicies: application.retentionPolicies.map((policy) => ({
      ...policy,
      dataType: "LOG" as const,
    })),
  }));

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <p className="text-sm font-medium text-slate-500">Observability</p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-950">
            Logs & Audit
          </h1>
          <p className="mt-2 text-slate-600">
            Telusuri integration, authentication, API/error, activity,
            violation, dan audit trail dengan filter terpusat.
          </p>
        </div>
        <LogsManager
          applications={applications}
          permissions={{
            integration: sessionHasPermission(session, "logs.integration.view"),
            authentication: sessionHasPermission(
              session,
              "logs.authentication.view",
            ),
            error: sessionHasPermission(session, "logs.error.view"),
            activity: sessionHasPermission(session, "logs.activity.view"),
            violation: sessionHasPermission(session, "logs.violation.view"),
            audit: sessionHasPermission(session, "logs.audit.view"),
            manageRetention: sessionHasPermission(
              session,
              "applications.manage",
            ),
          }}
        />
      </div>
    </main>
  );
}

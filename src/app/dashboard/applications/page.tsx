import { redirect } from "next/navigation";
import { ApplicationManager } from "@/components/applications/application-manager";
import { APPLICATION_RETENTION_DEFINITIONS } from "@/lib/applications/constants";
import { requireSession } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { sessionHasPermission } from "@/lib/rbac/guards";

export default async function ApplicationsPage() {
  const session = await requireSession();
  if (!sessionHasPermission(session, "applications.view")) redirect("/unauthorized");

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
      widgetConfig: {
        select: {
          position: true,
          bubbleIconUrl: true,
          bubbleSize: true,
          primaryColor: true,
          windowWidth: true,
          windowHeight: true,
          soundEnabledByDefault: true,
          browserNotificationEnabledByDefault: true,
          config: true,
        },
      },
      integrations: {
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
          isDefaultUserSource: true,
        },
      },
      retentionPolicies: {
        where: { isActive: true },
        select: {
          dataType: true,
          category: true,
          retentionDays: true,
          keepForever: true,
        },
      },
      _count: {
        select: {
          userIdentities: true,
          roles: true,
          groups: true,
          rooms: true,
          messages: true,
        },
      },
    },
  });

  const data = applications.map((application: (typeof applications)[number]) => ({
    ...application,
    widgetConfig: application.widgetConfig ? {
      ...application.widgetConfig,
      theme: application.widgetConfig.config && typeof application.widgetConfig.config === "object" && !Array.isArray(application.widgetConfig.config) &&
        ((application.widgetConfig.config as { theme?: string }).theme === "dark" || (application.widgetConfig.config as { theme?: string }).theme === "auto")
        ? (application.widgetConfig.config as { theme: "dark" | "auto" }).theme
        : "light" as const,
    } : null,
    retentionPolicies: APPLICATION_RETENTION_DEFINITIONS.map((definition) => {
      const current = application.retentionPolicies.find(
        (policy: (typeof application.retentionPolicies)[number]) =>
          policy.dataType === definition.dataType && policy.category === definition.category,
      );
      return {
        dataType: definition.dataType,
        category: definition.category,
        label: definition.label,
        retentionDays: current?.retentionDays ?? definition.retentionDays,
        keepForever: current?.keepForever ?? definition.keepForever,
      };
    }),
  }));

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <p className="text-sm font-medium text-slate-500">Multi-application management</p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-950">Applications</h1>
          <p className="mt-2 max-w-3xl text-slate-600">
            Kelola application key, status, allowed origins, konfigurasi widget awal, retention, dan status integrasi setiap tenant.
          </p>
        </div>
        <ApplicationManager
          applications={data}
          canCreate={session.isRoot}
          canManage={sessionHasPermission(session, "applications.manage")}
          canDelete={session.isRoot}
        />
      </div>
    </main>
  );
}

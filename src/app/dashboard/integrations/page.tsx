import { redirect } from "next/navigation";
import { IntegrationManager } from "@/components/integrations/integration-manager";
import { requireSession } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { sessionHasPermission } from "@/lib/rbac/guards";

export default async function IntegrationsPage() {
  const session = await requireSession();
  if (!sessionHasPermission(session, "integrations.view")) redirect("/unauthorized");

  const applications = await prisma.application.findMany({
    where: session.isRoot ? { status: "ACTIVE" } : { id: session.applicationId ?? "__none__", status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      key: true,
      name: true,
      roles: {
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true },
      },
      integrations: {
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
          databaseConfig: { select: { databaseType: true, host: true, port: true, databaseName: true, userTable: true } },
          apiConfig: { select: { baseUrl: true, endpoint: true, authenticationMode: true } },
          isDefaultUserSource: true,
          lastTestedAt: true,
          lastSuccessAt: true,
          lastErrorAt: true,
          _count: { select: { fieldMappings: true, roleMappings: true } },
        },
      },
    },
  });

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <p className="text-sm font-medium text-slate-500">External identity integration</p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-950">Integration Engine</h1>
          <p className="mt-2 max-w-3xl text-slate-600">
            Hubungkan user source melalui database atau API, petakan field dan role, lalu preview dan validasi user sebelum integrasi digunakan untuk login chat.
          </p>
        </div>
        <IntegrationManager
          applications={applications}
          canManage={sessionHasPermission(session, "integrations.manage")}
          canTest={sessionHasPermission(session, "integrations.test")}
        />
      </div>
    </main>
  );
}

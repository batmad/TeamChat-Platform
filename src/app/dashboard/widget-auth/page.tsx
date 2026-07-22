import { redirect } from "next/navigation";
import { WidgetAuthManager } from "@/components/widget-auth/widget-auth-manager";
import { requireSession } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { buildMappingReadiness } from "@/lib/integrations/field-mapping";
import { sessionHasPermission } from "@/lib/rbac/guards";

export default async function WidgetAuthPage() {
  const session = await requireSession();
  if (!sessionHasPermission(session, "applications.view"))
    redirect("/unauthorized");

  const applications = await prisma.application.findMany({
    where: session.isRoot
      ? undefined
      : { id: session.applicationId ?? "__none__" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      key: true,
      name: true,
      status: true,
      allowedOrigins: true,
      credentials: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          keyId: true,
          name: true,
          isActive: true,
          expiresAt: true,
          lastUsedAt: true,
          createdAt: true,
        },
      },
      integrations: {
        orderBy: [{ isDefaultUserSource: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
          isDefaultUserSource: true,
          mappingRevision: true,
          previewedMappingRevision: true,
          lastMappingPreviewAt: true,
          fieldMappings: { select: { targetField: true } },
        },
      },
    },
  });

  const data = applications.map(
    (application: (typeof applications)[number]) => ({
      ...application,
      credentials: application.credentials.map(
        (credential: (typeof application.credentials)[number]) => ({
          ...credential,
          expiresAt: credential.expiresAt?.toISOString() ?? null,
          lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
          createdAt: credential.createdAt.toISOString(),
        }),
      ),
      integrations: application.integrations.map(
        (integration: (typeof application.integrations)[number]) => ({
          id: integration.id,
          name: integration.name,
          type: integration.type,
          status: integration.status,
          isDefaultUserSource: integration.isDefaultUserSource,
          readiness: buildMappingReadiness({
            mappings: integration.fieldMappings,
            mappingRevision: integration.mappingRevision,
            previewedMappingRevision: integration.previewedMappingRevision,
            lastMappingPreviewAt: integration.lastMappingPreviewAt,
          }),
        }),
      ),
    }),
  );

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <p className="text-sm font-medium text-slate-500">
            Host application authentication bridge
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-950">
            Widget Authentication
          </h1>
          <p className="mt-2 max-w-3xl text-slate-600">
            Kelola signing credential, periksa kesiapan user integration, dan
            gunakan browser auth SDK untuk menukar signed bootstrap token
            menjadi chat session tanpa login ulang.
          </p>
        </div>
        <WidgetAuthManager
          applications={data}
          canManage={sessionHasPermission(session, "applications.manage")}
        />
      </div>
    </main>
  );
}

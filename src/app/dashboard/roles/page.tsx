import { redirect } from "next/navigation";
import { RoleManager } from "@/components/rbac/role-manager";
import { requireSession } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { sessionHasPermission } from "@/lib/rbac/guards";

type RolesPageApplication = {
  id: string; key: string; name: string;
  roles: Array<{
    id: string; code: string; name: string; description: string | null; isActive: boolean;
    permissions: Array<{ permission: { code: string } }>;
    _count: { integrationMappings: number; userOverrides: number; presenceRecords: number; reportScopes: number };
  }>;
};

export default async function RolesPage() {
  const session = await requireSession();
  if (!sessionHasPermission(session, "roles.view")) redirect("/unauthorized");

  const permissions = await prisma.permission.findMany({
    where: { isActive: true },
    orderBy: [{ module: "asc" }, { code: "asc" }],
    select: { id: true, code: true, name: true, module: true },
  });

  const applications = await prisma.application.findMany({
    where: session.isRoot ? { status: "ACTIVE" } : { id: session.applicationId ?? "__none__", status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      key: true,
      name: true,
      roles: {
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          isActive: true,
          permissions: { select: { permission: { select: { code: true } } } },
          _count: {
            select: {
              integrationMappings: true,
              userOverrides: true,
              presenceRecords: true,
              reportScopes: true,
            },
          },
        },
      },
    },
  }) as RolesPageApplication[];

  const data = applications.map((application) => ({
    id: application.id,
    key: application.key,
    name: application.name,
    roles: application.roles.map((role) => ({
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      isActive: role.isActive,
      permissionCodes: role.permissions.map(({ permission }: { permission: { code: string } }) => permission.code),
      usage: {
        integrationMappings: role._count.integrationMappings,
        userOverrides: role._count.userOverrides,
        presenceRecords: role._count.presenceRecords,
        reportScopes: role._count.reportScopes,
      },
    })),
  }));

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <p className="text-sm font-medium text-slate-500">Dynamic RBAC</p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-950">Roles & Permissions</h1>
          <p className="mt-2 text-slate-600">
            Role bisnis dibuat dinamis per application. ROOT tetap merupakan protected system account dan bukan role bisnis.
          </p>
        </div>
        <RoleManager applications={data} permissions={permissions} canManage={sessionHasPermission(session, "roles.manage")} />
      </div>
    </main>
  );
}

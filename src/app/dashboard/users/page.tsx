import { redirect } from "next/navigation";
import { UserAccessManager } from "@/components/rbac/user-access-manager";
import { requireSession } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { sessionHasPermission } from "@/lib/rbac/guards";

type UsersPageApplication = {
  id: string; key: string; name: string;
  roles: Array<{ id: string; code: string; name: string; isActive: boolean }>;
  groups: Array<{ id: string; code: string; name: string }>;
  userIdentities: Array<{
    id: string; username: string; source: "DATABASE" | "API" | "INTERNAL"; displayNameSnapshot: string | null; isActive: boolean;
    internalUser: { isProtectedRoot: boolean } | null;
    userOverride: { roleOverrideId: string | null; isAccessDisabled: boolean } | null;
    permissionOverrides: Array<{ effect: "ALLOW" | "DENY"; permission: { code: string } }>;
    presence: { status: "ONLINE" | "OFFLINE"; connectionCount: number; lastSeenAt: Date | null } | null;
    groupMemberships: Array<{ isPrimary: boolean; source: "EXTERNAL" | "INTERNAL"; group: { id: string; code: string; name: string } }>;
  }>;
};

export default async function UsersPage() {
  const session = await requireSession();
  if (!sessionHasPermission(session, "users.view")) redirect("/unauthorized");

  const [permissions, applications] = await Promise.all([
    prisma.permission.findMany({
      where: { isActive: true },
      orderBy: [{ module: "asc" }, { code: "asc" }],
      select: { code: true, name: true, module: true },
    }),
    prisma.application.findMany({
      where: session.isRoot ? { status: "ACTIVE" } : { id: session.applicationId ?? "__none__", status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        key: true,
        name: true,
        roles: { orderBy: { name: "asc" }, select: { id: true, code: true, name: true, isActive: true } },
        groups: {
          where: { source: "INTERNAL", isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, code: true, name: true },
        },
        userIdentities: {
          where: { isActive: true },
          orderBy: { username: "asc" },
          select: {
            id: true,
            username: true,
            source: true,
            displayNameSnapshot: true,
            isActive: true,
            internalUser: { select: { isProtectedRoot: true } },
            userOverride: { select: { roleOverrideId: true, isAccessDisabled: true } },
            permissionOverrides: { select: { effect: true, permission: { select: { code: true } } } },
            presence: { select: { status: true, connectionCount: true, lastSeenAt: true } },
            groupMemberships: {
              where: { group: { isActive: true } },
              orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
              select: { isPrimary: true, source: true, group: { select: { id: true, code: true, name: true } } },
            },
          },
        },
      },
    }),
  ]);
  const typedApplications = applications as UsersPageApplication[];

  const data = typedApplications.map((application) => ({
    id: application.id,
    key: application.key,
    name: application.name,
    roles: application.roles,
    groups: application.groups,
    users: application.userIdentities
      .filter((identity) => !identity.internalUser?.isProtectedRoot)
      .map((identity) => ({
        id: identity.id,
        username: identity.username,
        name: identity.displayNameSnapshot,
        source: identity.source,
        isActive: identity.isActive,
        accessDisabled: identity.userOverride?.isAccessDisabled ?? false,
        roleOverrideId: identity.userOverride?.roleOverrideId ?? null,
        permissionOverrides: identity.permissionOverrides.map((item) => ({
          permissionCode: item.permission.code,
          effect: item.effect as "ALLOW" | "DENY",
        })),
        presence: identity.presence
          ? {
              status: identity.presence.status,
              connectionCount: identity.presence.connectionCount,
              lastSeenAt: identity.presence.lastSeenAt?.toISOString() ?? null,
            }
          : null,
        groups: identity.groupMemberships.map((membership) => ({
          ...membership.group,
          membershipSource: membership.source,
          isPrimary: membership.isPrimary,
        })),
      })),
  }));

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <p className="text-sm font-medium text-slate-500">Identity & access</p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-950">Users & Access</h1>
          <p className="mt-2 text-slate-600">Kelola internal user serta role/permission override untuk internal maupun external identity.</p>
        </div>
        <UserAccessManager
          applications={data}
          permissions={permissions}
          canManageUsers={sessionHasPermission(session, "users.manage")}
          canOverride={sessionHasPermission(session, "users.override")}
        />
      </div>
    </main>
  );
}

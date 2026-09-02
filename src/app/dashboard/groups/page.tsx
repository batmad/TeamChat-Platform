import { redirect } from "next/navigation";
import { GroupManager } from "@/components/groups/group-manager";
import { requireSession } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { sessionHasPermission } from "@/lib/rbac/guards";

type GroupsPageApplication = {
  id: string; key: string; name: string;
  groups: Array<{
    id: string; code: string; name: string; description: string | null; source: "EXTERNAL" | "INTERNAL"; externalKey: string | null; isActive: boolean;
    _count: { members: number; rooms: number };
  }>;
  userIdentities: Array<{
    id: string; username: string; displayNameSnapshot: string | null; source: "DATABASE" | "API" | "INTERNAL";
    groupMemberships: Array<{ isPrimary: boolean; source: "EXTERNAL" | "INTERNAL"; group: { id: string; code: string; name: string } }>;
  }>;
};

export default async function GroupsPage() {
  const session = await requireSession();
  if (!sessionHasPermission(session, "groups.view")) redirect("/unauthorized");

  const applications = await prisma.application.findMany({
    where: session.isRoot ? { status: "ACTIVE" } : { id: session.applicationId ?? "__none__", status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      key: true,
      name: true,
      groups: {
        orderBy: [{ source: "asc" }, { name: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          source: true,
          externalKey: true,
          isActive: true,
          _count: { select: { members: true, rooms: true } },
        },
      },
      userIdentities: {
        where: { isActive: true },
        orderBy: { username: "asc" },
        select: {
          id: true,
          username: true,
          displayNameSnapshot: true,
          source: true,
          groupMemberships: {
            where: { group: { isActive: true } },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            select: {
              isPrimary: true,
              source: true,
              group: { select: { id: true, code: true, name: true } },
            },
          },
        },
      },
    },
  }) as GroupsPageApplication[];

  const data = applications.map((application) => ({
    id: application.id,
    key: application.key,
    name: application.name,
    groups: application.groups.map((group) => ({
      id: group.id,
      code: group.code,
      name: group.name,
      description: group.description,
      source: group.source,
      externalKey: group.externalKey,
      isActive: group.isActive,
      memberCount: group._count.members,
      roomCount: group._count.rooms,
    })),
    users: application.userIdentities.map((identity) => ({
      id: identity.id,
      username: identity.username,
      name: identity.displayNameSnapshot,
      source: identity.source,
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
          <p className="text-sm font-medium text-slate-500">User & Group</p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-950">Groups & Memberships</h1>
          <p className="mt-2 text-slate-600">Kelola internal group, lihat external group hasil sinkronisasi, multi-group user, dan primary group.</p>
        </div>
        <GroupManager
          applications={data}
          canManage={sessionHasPermission(session, "groups.manage")}
        />
      </div>
    </main>
  );
}

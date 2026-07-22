import type { ReactNode } from "react";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { LogoutButton } from "@/components/auth/logout-button";
import { requireSession } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireSession();
  const identities = session.isRoot
    ? []
    : await prisma.userIdentity.findMany({
        where: {
          internalUserId: session.userId,
          source: "INTERNAL",
          isActive: true,
          application: { status: "ACTIVE" },
        },
        orderBy: { application: { name: "asc" } },
        select: { application: { select: { key: true, name: true } } },
      });
  const applications = identities.map(
    ({ application }: { application: { key: string; name: string } }) =>
      application,
  );

  return (
    <div className="min-h-screen bg-slate-100 lg:flex">
      <DashboardSidebar session={session} applications={applications} />
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 lg:px-8">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {process.env.NEXT_PUBLIC_METADATA_TITLE}
            </p>
            <p className="text-sm font-medium text-slate-700">
              Management Console
            </p>
          </div>
          <LogoutButton />
        </header>
        {children}
      </div>
    </div>
  );
}

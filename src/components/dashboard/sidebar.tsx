import Link from "next/link";
import type { CurrentSession } from "@/lib/auth/dal";
import { getAllowedDashboardMenu } from "@/lib/rbac/menu";
import { ApplicationSwitcher } from "@/components/dashboard/application-switcher";

export function DashboardSidebar({
  session,
  applications,
}: {
  session: CurrentSession;
  applications: { key: string; name: string }[];
}) {
  const items = getAllowedDashboardMenu(session);

  return (
    <aside className="w-full border-b border-slate-200 bg-slate-950 text-white lg:min-h-screen lg:w-72 lg:border-b-0 lg:border-r lg:border-slate-800">
      <div className="p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          {process.env.NEXT_PUBLIC_METADATA_TITLE}
        </p>
        <h2 className="mt-2 text-xl font-semibold">Access Console</h2>
        <div className="mt-5 rounded-2xl bg-slate-900 p-4 text-sm">
          <p className="font-medium">{session.name}</p>
          <p className="mt-1 text-slate-400">
            {session.isRoot
              ? "Protected ROOT"
              : (session.role?.name ?? "No role")}
          </p>
          {!session.isRoot && session.applicationName ? (
            <p className="mt-1 text-xs text-slate-500">
              {session.applicationName}
            </p>
          ) : null}
          {!session.isRoot ? (
            <ApplicationSwitcher
              applications={applications}
              currentKey={session.applicationKey}
            />
          ) : null}
        </div>
      </div>
      <nav className="flex gap-2 overflow-x-auto px-4 pb-4 lg:block lg:space-y-1 lg:overflow-visible">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="block whitespace-nowrap rounded-xl px-4 py-3 text-sm font-medium text-slate-300 transition hover:bg-slate-900 hover:text-white"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}

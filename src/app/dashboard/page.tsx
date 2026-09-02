import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/dal";
import { getAllowedDashboardMenu } from "@/lib/rbac/menu";
import { sessionHasPermission } from "@/lib/rbac/guards";

export default async function DashboardPage() {
  const session = await requireSession();

  if (!sessionHasPermission(session, "dashboard.view")) {
    const firstAllowed = getAllowedDashboardMenu(session).find((item) => item.href !== "/dashboard");
    redirect(firstAllowed?.href ?? "/unauthorized");
  }

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-3xl bg-white p-8 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Secure access foundation</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-950">Dashboard</h1>
          <p className="mt-4 max-w-3xl text-slate-600">
            Login aktif sebagai <strong>{session.name}</strong>. Role dan permission efektif selalu dihitung ulang dari database pada request server.
          </p>
          <dl className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl bg-slate-50 p-5">
              <dt className="text-sm text-slate-500">Account</dt>
              <dd className="mt-1 font-semibold text-slate-950">{session.username}</dd>
            </div>
            <div className="rounded-2xl bg-slate-50 p-5">
              <dt className="text-sm text-slate-500">Application</dt>
              <dd className="mt-1 font-semibold text-slate-950">{session.isRoot ? "Global" : session.applicationName}</dd>
            </div>
            <div className="rounded-2xl bg-slate-50 p-5">
              <dt className="text-sm text-slate-500">Effective Role</dt>
              <dd className="mt-1 font-semibold text-slate-950">{session.isRoot ? "ROOT" : session.role?.name ?? "No role"}</dd>
            </div>
            <div className="rounded-2xl bg-slate-50 p-5">
              <dt className="text-sm text-slate-500">Permissions</dt>
              <dd className="mt-1 font-semibold text-slate-950">{session.isRoot ? "Full access" : session.permissions.length}</dd>
            </div>
          </dl>
        </div>
      </div>
    </main>
  );
}

"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiUrl } from "@/lib/api/api-url";

type Permission = { id: string; code: string; name: string; module: string };
type RoleUsage = {
  integrationMappings: number;
  userOverrides: number;
  presenceRecords: number;
  reportScopes: number;
};
type Role = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  permissionCodes: string[];
  usage: RoleUsage;
};
type ApplicationRoles = {
  id: string;
  key: string;
  name: string;
  roles: Role[];
};

function totalUsage(usage: RoleUsage) {
  return (
    usage.integrationMappings +
    usage.userOverrides +
    usage.presenceRecords +
    usage.reportScopes
  );
}

export function RoleManager({
  applications,
  permissions,
  canManage,
}: {
  applications: ApplicationRoles[];
  permissions: Permission[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [applicationId, setApplicationId] = useState(applications[0]?.id ?? "");
  const [selectedRoleId, setSelectedRoleId] = useState(
    applications[0]?.roles[0]?.id ?? "",
  );
  const [saving, setSaving] = useState(false);

  const application =
    applications.find((item) => item.id === applicationId) ?? applications[0];
  const selectedRole =
    application?.roles.find((role) => role.id === selectedRoleId) ??
    application?.roles[0];

  const groupedPermissions = useMemo(() => {
    const groups = new Map<string, Permission[]>();
    for (const permission of permissions) {
      const list = groups.get(permission.module) ?? [];
      list.push(permission);
      groups.set(permission.module, list);
    }
    return [...groups.entries()];
  }, [permissions]);

  async function parseResponse(response: Response) {
    const result = await response.json();
    if (!response.ok) {
      const details = result?.error?.details?.usage as RoleUsage | undefined;
      if (details) {
        throw new Error(
          `${result?.error?.message ?? "Operasi role gagal"}. Usage: ${details.integrationMappings} mapping integrasi, ${details.userOverrides} override user, ${details.presenceRecords} presence, ${details.reportScopes} scope report.`,
        );
      }
      throw new Error(result?.error?.message ?? "Operasi role gagal");
    }
    return result;
  }

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!applicationId) return;

    // Simpan referensi form sebelum proses async
    const formElement = event.currentTarget;
    const formData = new FormData(formElement);

    setSaving(true);

    try {
      const response = await fetch(
        apiUrl(`/api/applications/${applicationId}/roles`),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code: String(formData.get("code") ?? ""),
            name: String(formData.get("name") ?? ""),
            description: String(formData.get("description") ?? "") || null,
            permissionCodes: [],
          }),
        },
      );

      const result = await parseResponse(response);

      // Reset menggunakan referensi form yang sudah disimpan
      formElement.reset();

      setSelectedRoleId(result.data.role.id);
      toast.success("Role berhasil dibuat.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal membuat role",
      );
    } finally {
      setSaving(false);
    }
  }

  async function updateRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!applicationId || !selectedRole) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(
        apiUrl(`/api/applications/${applicationId}/roles/${selectedRole.id}`),
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code: String(form.get("code") ?? ""),
            name: String(form.get("name") ?? ""),
            description: String(form.get("description") ?? "") || null,
          }),
        },
      );
      await parseResponse(response);
      toast.success("Detail role berhasil diperbarui.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal memperbarui role",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleRoleStatus() {
    if (!applicationId || !selectedRole) return;
    setSaving(true);
    try {
      const response = await fetch(
        apiUrl(`/api/applications/${applicationId}/roles/${selectedRole.id}`),
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isActive: !selectedRole.isActive }),
        },
      );
      await parseResponse(response);
      toast.success(
        selectedRole.isActive
          ? "Role berhasil dinonaktifkan."
          : "Role berhasil diaktifkan.",
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal mengubah status role",
      );
    } finally {
      setSaving(false);
    }
  }

  async function savePermissions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!applicationId || !selectedRole) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const permissionCodes = permissions
      .filter(
        (permission) => form.get(`permission:${permission.code}`) === "on",
      )
      .map((permission) => permission.code);

    try {
      const response = await fetch(
        apiUrl(
          `/api/applications/${applicationId}/roles/${selectedRole.id}/permissions`,
        ),
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ permissionCodes }),
        },
      );
      await parseResponse(response);
      toast.success("Permission role berhasil diperbarui.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal menyimpan permission",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!applications.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-slate-600">
        Belum ada application.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-950">
        <strong>ROOT bukan role bisnis.</strong> Role seperti Administrator,
        Supervisor, Manager, Agent, Auditor, Viewer, atau IT Support dibuat
        dinamis untuk masing-masing application.
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <label className="text-sm font-medium text-slate-700">
          Application
        </label>
        <select
          value={application?.id ?? ""}
          onChange={(event) => {
            const nextId = event.target.value;
            setApplicationId(nextId);
            const next = applications.find((item) => item.id === nextId);
            setSelectedRoleId(next?.roles[0]?.id ?? "");
          }}
          className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
        >
          {applications.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.key})
            </option>
          ))}
        </select>
      </div>

      {canManage ? (
        <form
          onSubmit={createRole}
          className="rounded-2xl bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-slate-950">
            Create Dynamic Role
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Role code disimpan lowercase dan harus unik di dalam application.
            Code ROOT dicadangkan untuk system account.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <input
              name="code"
              required
              placeholder="Code, e.g. supervisor"
              className="rounded-xl border border-slate-300 px-4 py-3"
            />
            <input
              name="name"
              required
              placeholder="Role name"
              className="rounded-xl border border-slate-300 px-4 py-3"
            />
            <input
              name="description"
              placeholder="Description"
              className="rounded-xl border border-slate-300 px-4 py-3"
            />
          </div>
          <button
            disabled={saving}
            className="mt-4 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            Create Role
          </button>
        </form>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="px-2 py-2 font-semibold text-slate-950">Roles</h2>
          <div className="mt-2 space-y-1">
            {application?.roles.map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => setSelectedRoleId(role.id)}
                className={`w-full rounded-xl px-4 py-3 text-left text-sm ${selectedRole?.id === role.id ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700"}`}
              >
                <span className="block font-medium">{role.name}</span>
                <span className="mt-1 block text-xs opacity-70">
                  {role.permissionCodes.length} permissions ·{" "}
                  {role.isActive ? "Active" : "Inactive"} ·{" "}
                  {totalUsage(role.usage)} references
                </span>
              </button>
            ))}
            {!application?.roles.length ? (
              <p className="px-2 py-4 text-sm text-slate-500">
                Belum ada role.
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-6">
          {selectedRole ? (
            <>
              <form
                key={`detail:${selectedRole.id}:${selectedRole.code}:${selectedRole.name}:${selectedRole.description ?? ""}`}
                onSubmit={updateRole}
                className="rounded-2xl bg-white p-6 shadow-sm"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm text-slate-500">Role Configuration</p>
                    <h2 className="text-2xl font-semibold text-slate-950">
                      {selectedRole.name}
                    </h2>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${selectedRole.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}
                  >
                    {selectedRole.isActive ? "ACTIVE" : "INACTIVE"}
                  </span>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <label className="text-sm text-slate-700">
                    Code
                    <input
                      name="code"
                      defaultValue={selectedRole.code}
                      disabled={!canManage}
                      className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                    />
                  </label>
                  <label className="text-sm text-slate-700">
                    Name
                    <input
                      name="name"
                      defaultValue={selectedRole.name}
                      disabled={!canManage}
                      className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                    />
                  </label>
                  <label className="text-sm text-slate-700 md:col-span-2">
                    Description
                    <textarea
                      name="description"
                      defaultValue={selectedRole.description ?? ""}
                      disabled={!canManage}
                      rows={3}
                      className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                    />
                  </label>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <UsageCard
                    label="Integration mappings"
                    value={selectedRole.usage.integrationMappings}
                  />
                  <UsageCard
                    label="User overrides"
                    value={selectedRole.usage.userOverrides}
                  />
                  <UsageCard
                    label="Presence records"
                    value={selectedRole.usage.presenceRecords}
                  />
                  <UsageCard
                    label="Report scopes"
                    value={selectedRole.usage.reportScopes}
                  />
                </div>

                {canManage ? (
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      disabled={saving}
                      className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Save Role
                    </button>
                    <button
                      type="button"
                      onClick={toggleRoleStatus}
                      disabled={saving}
                      className={`rounded-xl px-5 py-3 text-sm font-medium disabled:opacity-50 ${selectedRole.isActive ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"}`}
                    >
                      {selectedRole.isActive
                        ? "Deactivate Role"
                        : "Activate Role"}
                    </button>
                  </div>
                ) : null}
                {selectedRole.isActive && totalUsage(selectedRole.usage) > 0 ? (
                  <p className="mt-3 text-xs text-amber-700">
                    Role masih digunakan. Lepaskan
                    mapping/override/presence/scope terkait sebelum role dapat
                    dinonaktifkan.
                  </p>
                ) : null}
              </form>

              <form
                key={`permissions:${selectedRole.id}:${selectedRole.permissionCodes.join(",")}`}
                onSubmit={savePermissions}
                className="rounded-2xl bg-white p-6 shadow-sm"
              >
                <div>
                  <p className="text-sm text-slate-500">{selectedRole.code}</p>
                  <h2 className="text-2xl font-semibold text-slate-950">
                    Permissions
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Permission catalog bersifat global, sedangkan assignment
                    permission bersifat dinamis untuk role pada application ini.
                  </p>
                </div>
                <div className="mt-6 space-y-6">
                  {groupedPermissions.map(([module, modulePermissions]) => (
                    <fieldset key={module}>
                      <legend className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                        {module}
                      </legend>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {modulePermissions.map((permission) => (
                          <label
                            key={permission.code}
                            className="flex gap-3 rounded-xl border border-slate-200 p-3"
                          >
                            <input
                              type="checkbox"
                              name={`permission:${permission.code}`}
                              defaultChecked={selectedRole.permissionCodes.includes(
                                permission.code,
                              )}
                              disabled={!canManage}
                              className="mt-1"
                            />
                            <span>
                              <span className="block text-sm font-medium text-slate-900">
                                {permission.name}
                              </span>
                              <span className="block text-xs text-slate-500">
                                {permission.code}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>
                {canManage ? (
                  <button
                    disabled={saving}
                    className="mt-6 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Save Permissions
                  </button>
                ) : null}
              </form>
            </>
          ) : (
            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <p className="text-slate-500">
                Pilih atau buat role terlebih dahulu.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UsageCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiUrl } from "@/lib/api/api-url";

type Permission = { code: string; name: string; module: string };
type Role = { id: string; code: string; name: string; isActive: boolean };
type Group = { id: string; code: string; name: string };
type User = {
  id: string;
  username: string;
  name: string | null;
  source: "DATABASE" | "API" | "INTERNAL";
  isActive: boolean;
  accessDisabled: boolean;
  roleOverrideId: string | null;
  permissionOverrides: { permissionCode: string; effect: "ALLOW" | "DENY" }[];
  presence: {
    status: "ONLINE" | "OFFLINE";
    connectionCount: number;
    lastSeenAt: string | null;
  } | null;
  groups: {
    id: string;
    code: string;
    name: string;
    membershipSource: "EXTERNAL" | "INTERNAL";
    isPrimary: boolean;
  }[];
};
type ApplicationAccess = {
  id: string;
  key: string;
  name: string;
  roles: Role[];
  groups: Group[];
  users: User[];
};

export function UserAccessManager({
  applications,
  permissions,
  canManageUsers,
  canOverride,
}: {
  applications: ApplicationAccess[];
  permissions: Permission[];
  canManageUsers: boolean;
  canOverride: boolean;
}) {
  const router = useRouter();
  const [applicationId, setApplicationId] = useState(applications[0]?.id ?? "");
  const [userId, setUserId] = useState(applications[0]?.users[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  const application =
    applications.find((item) => item.id === applicationId) ?? applications[0];
  const user =
    application?.users.find((item) => item.id === userId) ??
    application?.users[0];

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!applicationId) return;

    // Simpan referensi form sebelum proses async
    const formElement = event.currentTarget;
    const formData = new FormData(formElement);

    setBusy(true);

    try {
      const response = await fetch(
        apiUrl(`/api/applications/${applicationId}/internal-users`),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            username: String(formData.get("username") ?? ""),
            name: String(formData.get("name") ?? ""),
            password: String(formData.get("password") ?? ""),
            roleId: String(formData.get("roleId") ?? ""),
            primaryGroupId:
              String(formData.get("primaryGroupId") ?? "") || null,
          }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result?.error?.message ?? "Gagal membuat user");
      }

      toast.success("Internal user berhasil dibuat.");

      // Reset menggunakan referensi form yang telah disimpan
      formElement.reset();

      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal membuat user",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!applicationId || !user) return;
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const permissionOverrides = permissions.flatMap((permission) => {
      const effect = String(
        form.get(`permission:${permission.code}`) ?? "INHERIT",
      );
      return effect === "ALLOW" || effect === "DENY"
        ? [{ permissionCode: permission.code, effect }]
        : [];
    });
    const roleValue = String(form.get("roleOverrideId") ?? "");

    const response = await fetch(
      apiUrl(`/api/applications/${applicationId}/users/${user.id}/access`),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          roleOverrideId: roleValue || null,
          isAccessDisabled: form.get("isAccessDisabled") === "on",
          permissionOverrides,
        }),
      },
    );
    const result = await response.json();
    setBusy(false);
    if (!response.ok) {
      toast.error(result?.error?.message ?? "Gagal memperbarui akses user");
      return;
    }
    toast.success("Role dan permission override berhasil diperbarui.");
    router.refresh();
  }

  if (!applications.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-slate-600">
        Belum ada application aktif.
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
            setUserId(next?.users[0]?.id ?? "");
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

      {canManageUsers ? (
        <form
          onSubmit={createUser}
          className="rounded-2xl bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-slate-950">
            Create Internal User
          </h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <input
              name="username"
              required
              placeholder="Username"
              className="rounded-xl border border-slate-300 px-4 py-3"
            />
            <input
              name="name"
              required
              placeholder="Display name"
              className="rounded-xl border border-slate-300 px-4 py-3"
            />
            <input
              name="password"
              required
              type="password"
              minLength={12}
              placeholder="Password (min. 12)"
              className="rounded-xl border border-slate-300 px-4 py-3"
            />
            <select
              name="roleId"
              required
              className="rounded-xl border border-slate-300 px-4 py-3"
            >
              <option value="">Select role</option>
              {application?.roles
                .filter((role) => role.isActive)
                .map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
            </select>
            <select
              name="primaryGroupId"
              className="rounded-xl border border-slate-300 px-4 py-3"
            >
              <option value="">Primary group later</option>
              {application?.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          <button
            disabled={busy}
            className="mt-4 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            Create User
          </button>
        </form>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="px-2 py-2 font-semibold text-slate-950">
            User Identities
          </h2>
          <div className="mt-2 max-h-[600px] space-y-1 overflow-y-auto">
            {application?.users.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setUserId(item.id)}
                className={`w-full rounded-xl px-4 py-3 text-left text-sm ${user?.id === item.id ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700"}`}
              >
                <span className="flex items-center justify-between gap-2 font-medium">
                  <span>{item.name ?? item.username}</span>
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${item.presence?.status === "ONLINE" ? "bg-emerald-400" : "bg-slate-400"}`}
                  />
                </span>
                <span className="mt-1 block text-xs opacity-70">
                  {item.username} · {item.source}
                  {item.accessDisabled ? " · Disabled" : ""}
                </span>
              </button>
            ))}
            {!application?.users.length ? (
              <p className="px-2 py-4 text-sm text-slate-500">
                Belum ada user identity.
              </p>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm">
          {user ? (
            <form
              key={`${user.id}:${JSON.stringify(user.permissionOverrides)}`}
              onSubmit={saveAccess}
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-500">
                    {user.username} · {user.source}
                  </p>
                  <h2 className="text-2xl font-semibold text-slate-950">
                    {user.name ?? user.username}
                  </h2>
                </div>
                <div
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${user.presence?.status === "ONLINE" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
                >
                  {user.presence?.status ?? "OFFLINE"}
                  {user.presence?.status === "ONLINE" &&
                  user.presence.connectionCount > 1
                    ? ` · ${user.presence.connectionCount} connections`
                    : ""}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {user.groups.map((group) => (
                  <span
                    key={group.id}
                    className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700"
                  >
                    {group.name}
                    {group.isPrimary ? " · Primary" : ""}
                  </span>
                ))}
                {!user.groups.length ? (
                  <span className="text-xs text-amber-700">
                    No group assigned
                  </span>
                ) : null}
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">
                  {user.source === "INTERNAL"
                    ? "Assigned Role"
                    : "Role Override"}
                  <select
                    name="roleOverrideId"
                    defaultValue={user.roleOverrideId ?? ""}
                    disabled={!canOverride}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
                  >
                    <option value="">
                      {user.source === "INTERNAL"
                        ? "No role"
                        : "Use mapped role"}
                    </option>
                    {application?.roles
                      .filter((role) => role.isActive)
                      .map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    name="isAccessDisabled"
                    defaultChecked={user.accessDisabled}
                    disabled={!canOverride}
                  />
                  Disable application access
                </label>
              </div>

              <div className="mt-6">
                <h3 className="font-semibold text-slate-950">
                  Permission Overrides
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  DENY memiliki prioritas tertinggi, lalu ALLOW, kemudian
                  permission dari effective role.
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {permissions.map((permission) => {
                    const current =
                      user.permissionOverrides.find(
                        (item) => item.permissionCode === permission.code,
                      )?.effect ?? "INHERIT";
                    return (
                      <label
                        key={permission.code}
                        className="rounded-xl border border-slate-200 p-3 text-sm"
                      >
                        <span className="block font-medium text-slate-900">
                          {permission.name}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {permission.code}
                        </span>
                        <select
                          name={`permission:${permission.code}`}
                          defaultValue={current}
                          disabled={!canOverride}
                          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2"
                        >
                          <option value="INHERIT">Inherit</option>
                          <option value="ALLOW">Allow</option>
                          <option value="DENY">Deny</option>
                        </select>
                      </label>
                    );
                  })}
                </div>
              </div>
              {canOverride ? (
                <button
                  disabled={busy}
                  className="mt-6 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
                >
                  Save User Access
                </button>
              ) : null}
            </form>
          ) : (
            <p className="text-slate-500">Pilih user terlebih dahulu.</p>
          )}
        </div>
      </div>
    </div>
  );
}

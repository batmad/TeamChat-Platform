"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiUrl } from "@/lib/api/api-url";

type Group = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  source: "EXTERNAL" | "INTERNAL";
  externalKey: string | null;
  isActive: boolean;
  memberCount: number;
  roomCount: number;
};

type User = {
  id: string;
  username: string;
  name: string | null;
  source: "DATABASE" | "API" | "INTERNAL";
  groups: {
    id: string;
    code: string;
    name: string;
    membershipSource: "EXTERNAL" | "INTERNAL";
    isPrimary: boolean;
  }[];
};

type ApplicationData = {
  id: string;
  key: string;
  name: string;
  groups: Group[];
  users: User[];
};

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      payload?.error?.message ?? payload?.message ?? "Request failed",
    );
  return payload;
}

export function GroupManager({
  applications,
  canManage,
}: {
  applications: ApplicationData[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [applicationId, setApplicationId] = useState(applications[0]?.id ?? "");
  const application =
    applications.find((item) => item.id === applicationId) ?? applications[0];
  const [userId, setUserId] = useState(application?.users[0]?.id ?? "");
  const user =
    application?.users.find((item) => item.id === userId) ??
    application?.users[0];
  const [busy, setBusy] = useState(false);

  const internalGroups = useMemo(
    () =>
      application?.groups.filter((group) => group.source === "INTERNAL") ?? [],
    [application],
  );

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!application) return;

    // Simpan referensi form sebelum proses asynchronous
    const formElement = event.currentTarget;
    const formData = new FormData(formElement);

    setBusy(true);

    try {
      await readJson(
        await fetch(apiUrl(`/api/applications/${application.id}/groups`), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code: String(formData.get("code") ?? ""),
            name: String(formData.get("name") ?? ""),
            description: String(formData.get("description") ?? "") || null,
          }),
        }),
      );

      // Reset menggunakan referensi form yang sudah disimpan
      formElement.reset();

      toast.success("Group internal berhasil dibuat.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal membuat group",
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleGroup(group: Group) {
    if (!application) return;
    setBusy(true);
    try {
      await readJson(
        await fetch(
          apiUrl(`/api/applications/${application.id}/groups/${group.id}`),
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ isActive: !group.isActive }),
          },
        ),
      );
      toast.success(
        `Group ${group.name} ${group.isActive ? "dinonaktifkan" : "diaktifkan"}.`,
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal memperbarui group",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup(group: Group) {
    if (!application) return;
    if (!window.confirm(`Hapus group ${group.name}?`)) return;
    setBusy(true);
    try {
      await readJson(
        await fetch(
          apiUrl(`/api/applications/${application.id}/groups/${group.id}`),
          {
            method: "DELETE",
          },
        ),
      );
      toast.success(`Group ${group.name} berhasil dihapus.`);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal menghapus group",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveMemberships(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!application || !user) return;
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const internalGroupIds = form.getAll("internalGroupIds").map(String);
      const primaryValue = String(form.get("primaryGroupId") ?? "");
      await readJson(
        await fetch(
          apiUrl(`/api/applications/${application.id}/users/${user.id}/groups`),
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              internalGroupIds,
              ...(user.source === "INTERNAL"
                ? { primaryGroupId: primaryValue || null }
                : {}),
            }),
          },
        ),
      );
      toast.success(`Group user ${user.username} berhasil diperbarui.`);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal memperbarui membership",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!application) {
    return (
      <p className="rounded-2xl bg-white p-6 text-slate-500 shadow-sm">
        Belum ada application aktif.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <label className="text-sm font-medium text-slate-700">
          Application
        </label>
        <select
          value={application.id}
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

      {canManage ? (
        <form
          onSubmit={createGroup}
          className="rounded-2xl bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-slate-950">
            Create Internal Group
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            External group dibuat dan disinkronkan otomatis dari integration
            source.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <input
              name="code"
              required
              placeholder="PROJECT-A"
              className="rounded-xl border border-slate-300 px-4 py-3"
            />
            <input
              name="name"
              required
              placeholder="Project A"
              className="rounded-xl border border-slate-300 px-4 py-3"
            />
            <input
              name="description"
              placeholder="Description"
              className="rounded-xl border border-slate-300 px-4 py-3"
            />
          </div>
          <button
            disabled={busy}
            className="mt-4 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            Create Group
          </button>
        </form>
      ) : null}

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Groups</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-3">Group</th>
                <th>Source</th>
                <th>Members</th>
                <th>Rooms</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {application.groups.map((group) => (
                <tr key={group.id} className="border-b border-slate-100">
                  <td className="py-4">
                    <span className="font-medium text-slate-950">
                      {group.name}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {group.code}
                    </span>
                  </td>
                  <td>
                    {group.source}
                    {group.externalKey ? (
                      <span className="block text-xs text-slate-500">
                        {group.externalKey}
                      </span>
                    ) : null}
                  </td>
                  <td>{group.memberCount}</td>
                  <td>{group.roomCount}</td>
                  <td>{group.isActive ? "Active" : "Inactive"}</td>
                  <td>
                    {canManage && group.source === "INTERNAL" ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => toggleGroup(group)}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                        >
                          {group.isActive ? "Disable" : "Enable"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => deleteGroup(group)}
                          className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">
                        Managed by source
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {!application.groups.length ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Belum ada group.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="px-2 py-2 font-semibold text-slate-950">
            User Membership
          </h2>
          <div className="mt-2 max-h-[520px] space-y-1 overflow-y-auto">
            {application.users.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setUserId(item.id)}
                className={`w-full rounded-xl px-4 py-3 text-left text-sm ${user?.id === item.id ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700"}`}
              >
                <span className="block font-medium">
                  {item.name ?? item.username}
                </span>
                <span className="mt-1 block text-xs opacity-70">
                  {item.username} · {item.source}
                </span>
              </button>
            ))}
            {!application.users.length ? (
              <p className="px-2 py-4 text-sm text-slate-500">
                Belum ada user identity.
              </p>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm">
          {user ? (
            <form
              key={`${user.id}:${JSON.stringify(user.groups)}`}
              onSubmit={saveMemberships}
            >
              <p className="text-sm text-slate-500">{user.source}</p>
              <h2 className="text-2xl font-semibold text-slate-950">
                {user.name ?? user.username}
              </h2>
              <div className="mt-5">
                <h3 className="font-semibold text-slate-950">
                  Effective Groups
                </h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {user.groups.map((group) => (
                    <span
                      key={group.id}
                      className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700"
                    >
                      {group.name}
                      {group.isPrimary ? " · Primary" : ""} ·{" "}
                      {group.membershipSource}
                    </span>
                  ))}
                  {!user.groups.length ? (
                    <span className="text-sm text-slate-500">
                      Belum memiliki group.
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="mt-6">
                <h3 className="font-semibold text-slate-950">
                  Internal Group Memberships
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Membership internal tetap dipertahankan saat external group
                  disinkronkan ulang.
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {internalGroups.map((group) => {
                    const assigned = user.groups.some(
                      (item) =>
                        item.id === group.id &&
                        item.membershipSource === "INTERNAL",
                    );
                    return (
                      <label
                        key={group.id}
                        className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 text-sm"
                      >
                        <input
                          type="checkbox"
                          name="internalGroupIds"
                          value={group.id}
                          defaultChecked={assigned}
                          disabled={!canManage || !group.isActive}
                        />
                        <span>
                          <span className="block font-medium text-slate-900">
                            {group.name}
                          </span>
                          <span className="text-xs text-slate-500">
                            {group.code}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                  {!internalGroups.length ? (
                    <p className="text-sm text-slate-500">
                      Belum ada internal group.
                    </p>
                  ) : null}
                </div>
              </div>

              {user.source === "INTERNAL" ? (
                <label className="mt-6 block text-sm font-medium text-slate-700">
                  Primary Group
                  <select
                    name="primaryGroupId"
                    defaultValue={
                      user.groups.find((group) => group.isPrimary)?.id ?? ""
                    }
                    disabled={!canManage}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
                  >
                    <option value="">No primary group</option>
                    {internalGroups
                      .filter((group) => group.isActive)
                      .map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                  </select>
                </label>
              ) : (
                <p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
                  Primary group external mengikuti integration source dan tidak
                  dapat dioverride manual.
                </p>
              )}

              {canManage ? (
                <button
                  disabled={busy}
                  className="mt-6 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
                >
                  Save Memberships
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

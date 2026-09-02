"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiUrl } from "@/lib/api/api-url";

type Group = { id: string; code: string; name: string };
type Rule = {
  id: string;
  applicationId: string | null;
  groupId: string | null;
  scope: "GLOBAL" | "APPLICATION" | "GROUP";
  pattern: string;
  matchMode: "EXACT_WORD" | "CONTAINS";
  isActive: boolean;
  createdAt: string;
  group: Group | null;
  violationCount: number;
};
type Application = {
  id: string;
  key: string;
  name: string;
  groups: Group[];
  rules: Rule[];
};

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      payload?.error?.message ?? payload?.message ?? "Request failed",
    );
  return payload;
}

export function ModerationManager({
  applications,
  globalRules,
  isRoot,
  canManage,
}: {
  applications: Application[];
  globalRules: Rule[];
  isRoot: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [applicationId, setApplicationId] = useState(applications[0]?.id ?? "");
  const [scope, setScope] = useState<"GLOBAL" | "APPLICATION" | "GROUP">(
    "APPLICATION",
  );
  const [busy, setBusy] = useState(false);
  const application =
    applications.find((item) => item.id === applicationId) ??
    applications[0] ??
    null;
  const visibleRules = useMemo(
    () => [...globalRules, ...(application?.rules ?? [])],
    [application, globalRules],
  );

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Simpan referensi form sebelum proses asynchronous
    const formElement = event.currentTarget;
    const formData = new FormData(formElement);
    const currentScope = String(formData.get("scope")) as typeof scope;

    setBusy(true);

    try {
      await readJson(
        await fetch(apiUrl("/api/moderation/forbidden-words"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scope: currentScope,
            applicationId:
              currentScope === "GLOBAL" ? null : (application?.id ?? null),
            groupId:
              currentScope === "GROUP"
                ? String(formData.get("groupId") ?? "") || null
                : null,
            pattern: String(formData.get("pattern") ?? ""),
            matchMode: String(formData.get("matchMode") ?? "EXACT_WORD"),
          }),
        }),
      );

      // Reset input form menggunakan referensi yang telah disimpan
      formElement.reset();

      // Scope merupakan controlled state, jadi harus di-reset terpisah
      setScope("APPLICATION");

      toast.success("Rule forbidden word berhasil dibuat.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal membuat rule",
      );
    } finally {
      setBusy(false);
    }
  }

  async function patchRule(rule: Rule, patch: Record<string, unknown>) {
    setBusy(true);
    try {
      await readJson(
        await fetch(apiUrl(`/api/moderation/forbidden-words/${rule.id}`), {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        }),
      );
      toast.success("Rule berhasil diperbarui.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal memperbarui rule",
      );
    } finally {
      setBusy(false);
    }
  }

  async function editRule(rule: Rule) {
    const next = window.prompt("Forbidden pattern", rule.pattern);
    if (next === null || next.trim() === "" || next.trim() === rule.pattern)
      return;
    await patchRule(rule, { pattern: next.trim() });
  }

  async function removeRule(rule: Rule) {
    if (!window.confirm(`Hapus/nonaktifkan rule "${rule.pattern}"?`)) return;
    setBusy(true);
    try {
      await readJson(
        await fetch(apiUrl(`/api/moderation/forbidden-words/${rule.id}`), {
          method: "DELETE",
        }),
      );
      toast.success(
        rule.violationCount > 0
          ? "Rule dinonaktifkan karena memiliki histori pelanggaran."
          : "Rule berhasil dihapus.",
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal menghapus rule",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {applications.length ? (
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <label className="text-sm font-medium text-slate-700">
            Application
          </label>
          <select
            value={application?.id ?? ""}
            onChange={(event) => setApplicationId(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
          >
            {applications.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.key})
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {canManage || isRoot ? (
        <form
          onSubmit={createRule}
          className="rounded-2xl bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-slate-950">
            Tambah Forbidden Word
          </h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <select
              name="scope"
              value={scope}
              onChange={(event) => setScope(event.target.value as typeof scope)}
              className="rounded-xl border border-slate-300 px-4 py-3"
            >
              {isRoot ? <option value="GLOBAL">Global</option> : null}
              <option value="APPLICATION">Application</option>
              <option value="GROUP">Group</option>
            </select>
            {scope === "GROUP" ? (
              <select
                name="groupId"
                required
                className="rounded-xl border border-slate-300 px-4 py-3"
              >
                <option value="">Pilih group</option>
                {application?.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name} ({group.code})
                  </option>
                ))}
              </select>
            ) : (
              <input
                disabled
                value={
                  scope === "GLOBAL"
                    ? "Semua application"
                    : (application?.name ?? "")
                }
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-500"
              />
            )}
            <input
              name="pattern"
              required
              placeholder="Kata atau pola yang dibatasi"
              className="rounded-xl border border-slate-300 px-4 py-3"
            />
            <select
              name="matchMode"
              defaultValue="EXACT_WORD"
              className="rounded-xl border border-slate-300 px-4 py-3"
            >
              <option value="EXACT_WORD">Exact word</option>
              <option value="CONTAINS">Contains</option>
            </select>
          </div>
          <button
            disabled={busy || (scope !== "GLOBAL" && !application)}
            className="mt-4 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            Tambah Rule
          </button>
        </form>
      ) : null}

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Master Forbidden Words
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-3">Pattern</th>
                <th>Scope</th>
                <th>Match</th>
                <th>Status</th>
                <th>Violations</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleRules.map((rule) => {
                const manageable = rule.scope === "GLOBAL" ? isRoot : canManage;
                return (
                  <tr key={rule.id} className="border-b border-slate-100">
                    <td className="py-4 font-medium text-slate-950">
                      {rule.pattern}
                    </td>
                    <td>
                      {rule.scope}
                      {rule.group ? (
                        <span className="block text-xs text-slate-500">
                          {rule.group.name}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {rule.matchMode === "EXACT_WORD"
                        ? "Exact word"
                        : "Contains"}
                    </td>
                    <td>{rule.isActive ? "Active" : "Inactive"}</td>
                    <td>{rule.violationCount}</td>
                    <td>
                      {manageable ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => editRule(rule)}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              patchRule(rule, { isActive: !rule.isActive })
                            }
                            className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                          >
                            {rule.isActive ? "Disable" : "Enable"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => removeRule(rule)}
                            className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-700"
                          >
                            Delete
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">
                          Read only
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!visibleRules.length ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Belum ada forbidden word.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

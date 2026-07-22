"use client";

import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { apiUrl } from "@/lib/api/api-url";

type Application = { id: string; key: string; name: string };
type Group = { id: string; code: string; name: string };
type Scope = {
  type: "OWN_GROUP" | "SELECTED_GROUPS" | "ALL_GROUPS";
  source: string;
  unrestricted: boolean;
  groups: Group[];
};
type Row = {
  id: string;
  timestamp: string;
  chatType: "PRIVATE" | "GROUP";
  roomId: string;
  roomName: string | null;
  groupContexts: Group[];
  senderUsername: string;
  senderName: string | null;
  participants: Array<{
    userIdentityId: string;
    username: string;
    name: string | null;
  }>;
  message: string;
  replyTo: {
    id: string;
    senderUsername: string;
    senderName: string | null;
    content: string;
  } | null;
};
type RoleSubject = { id: string; code: string; name: string };
type UserSubject = {
  id: string;
  username: string;
  displayNameSnapshot: string | null;
  source: string;
};
type ScopeAssignment = {
  id: string;
  subjectType: "ROLE" | "USER";
  roleId: string | null;
  userIdentityId: string | null;
  subjectKey: string;
  scopeType: "OWN_GROUP" | "SELECTED_GROUPS" | "ALL_GROUPS";
  role: RoleSubject | null;
  userIdentity: {
    id: string;
    username: string;
    displayNameSnapshot: string | null;
  } | null;
  groups: Array<{ group: Group }>;
};
type ScopeCatalog = {
  roles: RoleSubject[];
  users: UserSubject[];
  groups: Group[];
  assignments: ScopeAssignment[];
};
type SubjectOption = { id: string; label: string };

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(payload?.error?.message ?? "Request failed");
  return payload;
}
function localDateToIso(value: string, endOfDay = false) {
  if (!value) return null;
  return new Date(
    `${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}`,
  ).toISOString();
}
function defaultDate(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function ChatLogsReportManager({
  applications,
  canExport,
  canManageScopes,
  initialScope,
  initialCatalog,
}: {
  applications: Application[];
  canExport: boolean;
  canManageScopes: boolean;
  initialScope: Scope | null;
  initialCatalog: ScopeCatalog | null;
}) {
  const [applicationId, setApplicationId] = useState(applications[0]?.id ?? "");
  const [scope, setScope] = useState<Scope | null>(initialScope);
  const [dateFrom, setDateFrom] = useState(defaultDate(-7));
  const [dateTo, setDateTo] = useState(defaultDate(0));
  const [groupId, setGroupId] = useState("");
  const [username, setUsername] = useState("");
  const [chatType, setChatType] = useState<"ALL" | "PRIVATE" | "GROUP">("ALL");
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<ScopeCatalog | null>(initialCatalog);
  const [subjectType, setSubjectType] = useState<"ROLE" | "USER">("ROLE");
  const [subjectId, setSubjectId] = useState(
    initialCatalog?.roles[0]?.id ?? "",
  );
  const [scopeType, setScopeType] = useState<
    "OWN_GROUP" | "SELECTED_GROUPS" | "ALL_GROUPS"
  >("OWN_GROUP");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

  const subjects = useMemo<SubjectOption[]>(
    () =>
      subjectType === "ROLE"
        ? (catalog?.roles ?? []).map((item) => ({
            id: item.id,
            label: `${item.name} (${item.code})`,
          }))
        : (catalog?.users ?? []).map((item) => ({
            id: item.id,
            label: `${item.displayNameSnapshot ?? item.username} (${item.username})`,
          })),
    [catalog, subjectType],
  );

  async function loadOptions(targetApplicationId: string) {
    if (!targetApplicationId) return;
    const payload = await readJson(
      await fetch(
        apiUrl(
          `/api/reports/chat-logs/options?applicationId=${encodeURIComponent(targetApplicationId)}`,
        ),
        { cache: "no-store" },
      ),
    );
    const nextScope = payload.data.scope as Scope;
    setScope(nextScope);
    setGroupId("");
  }
  async function loadScopeCatalog(targetApplicationId: string) {
    if (!canManageScopes || !targetApplicationId) return;
    const payload = await readJson(
      await fetch(
        apiUrl(
          `/api/applications/${targetApplicationId}/reports/chat-logs/scopes`,
        ),
        { cache: "no-store" },
      ),
    );
    const nextCatalog = payload.data as ScopeCatalog;
    setCatalog(nextCatalog);
    const nextSubjects =
      subjectType === "ROLE" ? nextCatalog.roles : nextCatalog.users;
    setSubjectId(nextSubjects[0]?.id ?? "");
  }
  async function changeApplication(nextApplicationId: string) {
    setApplicationId(nextApplicationId);
    setRows([]);
    setTotal(0);
    setNextCursor(null);
    setBusy(true);
    try {
      await Promise.all([
        loadOptions(nextApplicationId),
        loadScopeCatalog(nextApplicationId),
      ]);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Gagal memuat konfigurasi report",
      );
    } finally {
      setBusy(false);
    }
  }
  function changeSubjectType(nextType: "ROLE" | "USER") {
    setSubjectType(nextType);
    const next =
      nextType === "ROLE" ? catalog?.roles[0]?.id : catalog?.users[0]?.id;
    setSubjectId(next ?? "");
  }
  function buildParams(cursor?: string | null) {
    const params = new URLSearchParams({
      applicationId,
      chatType,
      limit: "50",
    });
    const from = localDateToIso(dateFrom);
    const to = localDateToIso(dateTo, true);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (groupId) params.set("groupId", groupId);
    if (username.trim()) params.set("username", username.trim());
    if (cursor) params.set("cursor", cursor);
    return params;
  }
  async function runReport(options?: {
    append?: boolean;
    cursor?: string | null;
  }) {
    if (!applicationId) return;
    setBusy(true);
    try {
      const payload = await readJson(
        await fetch(
          apiUrl(
            `/api/reports/chat-logs?${buildParams(options?.cursor).toString()}`,
          ),
          { cache: "no-store" },
        ),
      );
      setRows((current) =>
        options?.append
          ? [...current, ...payload.data.rows]
          : payload.data.rows,
      );
      setTotal(payload.data.total);
      setNextCursor(payload.data.nextCursor ?? null);
      setScope(payload.data.scope);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal menarik report",
      );
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void runReport();
  }
  async function exportReport(format: "csv" | "xlsx") {
    setBusy(true);
    try {
      const params = buildParams();
      params.delete("limit");
      params.set("format", format);
      const response = await fetch(
        apiUrl(`/api/reports/chat-logs/export?${params.toString()}`),
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "Export gagal");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename =
        disposition.match(/filename="([^"]+)"/)?.[1] ?? `chat-logs.${format}`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export gagal");
    } finally {
      setBusy(false);
    }
  }
  async function saveScope() {
    if (!applicationId || !subjectId || !canManageScopes) return;
    setBusy(true);
    try {
      await readJson(
        await fetch(
          apiUrl(`/api/applications/${applicationId}/reports/chat-logs/scopes`),
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subjectType,
              subjectId,
              scopeType,
              groupIds: scopeType === "SELECTED_GROUPS" ? selectedGroupIds : [],
            }),
          },
        ),
      );
      toast.success("Data scope report berhasil disimpan.");
      await Promise.all([
        loadScopeCatalog(applicationId),
        loadOptions(applicationId),
      ]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal menyimpan data scope",
      );
    } finally {
      setBusy(false);
    }
  }
  async function deleteScope(assignment: ScopeAssignment) {
    const id =
      assignment.subjectType === "ROLE"
        ? assignment.roleId
        : assignment.userIdentityId;
    if (!id) return;
    setBusy(true);
    try {
      const params = new URLSearchParams({
        subjectType: assignment.subjectType,
        subjectId: id,
      });
      await readJson(
        await fetch(
          apiUrl(
            `/api/applications/${applicationId}/reports/chat-logs/scopes?${params.toString()}`,
          ),
          { method: "DELETE" },
        ),
      );
      toast.success(
        "Data scope khusus dihapus; akses kembali menggunakan fallback OWN_GROUP.",
      );
      await loadScopeCatalog(applicationId);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal menghapus data scope",
      );
    } finally {
      setBusy(false);
    }
  }
  const scopeLabel = useMemo(
    () =>
      scope
        ? `${scope.type} · ${scope.source}${scope.unrestricted ? " · unrestricted" : ` · ${scope.groups.length} group`}`
        : "-",
    [scope],
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            Application
            <select
              value={applicationId}
              onChange={(event) => void changeApplication(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
            >
              {applications.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.key})
                </option>
              ))}
            </select>
          </label>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Effective Data Scope
            </p>
            <p className="mt-2 font-medium text-slate-900">{scopeLabel}</p>
            <p className="mt-1 text-xs text-slate-500">
              {scope?.groups.map((group) => group.code).join(", ") ||
                (scope?.unrestricted
                  ? "All groups and unscoped private history"
                  : "No group data available")}
            </p>
          </div>
        </div>
      </div>
      <form onSubmit={submit} className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Chat Logs Report
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs font-medium text-slate-600">
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            To
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Group
            <select
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
            >
              <option value="">All allowed groups</option>
              {scope?.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name} ({group.code})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Exact username"
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Chat Type
            <select
              value={chatType}
              onChange={(event) =>
                setChatType(event.target.value as typeof chatType)
              }
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
            >
              <option value="ALL">All</option>
              <option value="PRIVATE">Private</option>
              <option value="GROUP">Group / Public</option>
            </select>
          </label>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            disabled={busy || !applicationId}
            className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            Run Report
          </button>
          {canExport ? (
            <>
              <button
                type="button"
                disabled={busy || !applicationId}
                onClick={() => void exportReport("xlsx")}
                className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium"
              >
                Export Excel
              </button>
              <button
                type="button"
                disabled={busy || !applicationId}
                onClick={() => void exportReport("csv")}
                className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium"
              >
                Export CSV
              </button>
            </>
          ) : null}
        </div>
      </form>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-950">
            Report Result
          </h2>
          <span className="text-sm text-slate-500">
            {rows.length} loaded / {total} total
          </span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1200px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-3">Time</th>
                <th>Type</th>
                <th>Group Context</th>
                <th>Sender</th>
                <th>Participants</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-slate-100 align-top"
                >
                  <td className="py-4 whitespace-nowrap">
                    {new Date(row.timestamp).toLocaleString()}
                  </td>
                  <td>{row.chatType}</td>
                  <td>
                    {row.groupContexts.map((group) => group.code).join(", ") ||
                      "-"}
                  </td>
                  <td>
                    <p className="font-medium">{row.senderUsername}</p>
                    <p className="text-xs text-slate-500">
                      {row.senderName ?? "-"}
                    </p>
                  </td>
                  <td className="max-w-[280px]">
                    {row.participants
                      .map((participant) => participant.username)
                      .join(", ")}
                  </td>
                  <td className="max-w-[500px] whitespace-pre-wrap break-words">
                    {row.message}
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    Jalankan report untuk menampilkan data.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {nextCursor ? (
          <button
            disabled={busy}
            onClick={() => void runReport({ append: true, cursor: nextCursor })}
            className="mt-4 rounded-xl border border-slate-300 px-4 py-2 text-sm"
          >
            Load More
          </button>
        ) : null}
      </div>
      {canManageScopes ? (
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Report Data Scope Management
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              User-specific scope memiliki prioritas di atas role scope. Tanpa
              assignment khusus, fallback adalah OWN_GROUP.
            </p>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-xs font-medium text-slate-600">
              Subject Type
              <select
                value={subjectType}
                onChange={(event) =>
                  changeSubjectType(event.target.value as typeof subjectType)
                }
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
              >
                <option value="ROLE">Role</option>
                <option value="USER">User</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Subject
              <select
                value={subjectId}
                onChange={(event) => setSubjectId(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
              >
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Scope
              <select
                value={scopeType}
                onChange={(event) =>
                  setScopeType(event.target.value as typeof scopeType)
                }
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
              >
                <option value="OWN_GROUP">Own Group</option>
                <option value="SELECTED_GROUPS">Selected Groups</option>
                <option value="ALL_GROUPS">All Groups</option>
              </select>
            </label>
            <div className="flex items-end">
              <button
                disabled={busy || !subjectId}
                onClick={() => void saveScope()}
                className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                Save Scope
              </button>
            </div>
          </div>
          {scopeType === "SELECTED_GROUPS" ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {catalog?.groups.map((group) => (
                <label
                  key={group.id}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedGroupIds.includes(group.id)}
                    onChange={(event) =>
                      setSelectedGroupIds((current) =>
                        event.target.checked
                          ? [...new Set([...current, group.id])]
                          : current.filter((id) => id !== group.id),
                      )
                    }
                  />
                  {group.name} ({group.code})
                </label>
              ))}
            </div>
          ) : null}
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-3">Subject</th>
                  <th>Type</th>
                  <th>Scope</th>
                  <th>Groups</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {catalog?.assignments.map((assignment) => (
                  <tr key={assignment.id} className="border-b border-slate-100">
                    <td className="py-4">
                      {assignment.role?.name ??
                        assignment.userIdentity?.displayNameSnapshot ??
                        assignment.userIdentity?.username ??
                        assignment.subjectKey}
                    </td>
                    <td>{assignment.subjectType}</td>
                    <td>{assignment.scopeType}</td>
                    <td>
                      {assignment.groups
                        .map((entry) => entry.group.code)
                        .join(", ") || "-"}
                    </td>
                    <td className="text-right">
                      <button
                        onClick={() => void deleteScope(assignment)}
                        className="text-sm font-medium text-red-600"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {!catalog?.assignments.length ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500">
                      Belum ada assignment scope khusus.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

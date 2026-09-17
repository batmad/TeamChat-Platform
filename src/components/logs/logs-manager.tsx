"use client";

import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { apiUrl } from "@/lib/api/api-url";

type RetentionPolicy = {
  dataType: "LOG";
  category: string;
  retentionDays: number | null;
  keepForever: boolean;
};

type Application = {
  id: string;
  key: string;
  name: string;
  retentionPolicies: RetentionPolicy[];
};

type Entry = {
  id: string;
  source: "SYSTEM" | "AUDIT" | "VIOLATION";
  applicationId: string | null;
  timestamp: string;
  type?: string;
  level: string;
  username: string | null;
  action: string | null;
  message: string;
  requestId: string | null;
  metadata: unknown;
};

type PermissionSet = {
  integration: boolean;
  authentication: boolean;
  error: boolean;
  activity: boolean;
  violation: boolean;
  audit: boolean;
  manageRetention: boolean;
};

const RETENTION_LABELS: Record<string, string> = {
  integration: "Integration Logs",
  api: "API Logs",
  authentication: "Authentication Logs",
  error: "Error Logs",
  system: "System Logs",
  user_activity: "User Activity Logs",
  chat_activity: "Chat Activity Logs",
  content_violation: "Violation Logs",
  report: "Report Logs",
  audit: "Audit Logs",
};

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(payload?.error?.message ?? "Request failed");
  return payload;
}

function formatMetadata(value: unknown) {
  if (value === null || value === undefined) return "-";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function LogsManager({
  applications,
  permissions,
}: {
  applications: Application[];
  permissions: PermissionSet;
}) {
  const availableCategories = useMemo(
    () =>
      [
        permissions.integration
          ? { value: "integration", label: "Integration & API" }
          : null,
        permissions.authentication
          ? { value: "authentication", label: "Authentication" }
          : null,
        permissions.error ? { value: "error", label: "Errors" } : null,
        permissions.activity
          ? { value: "activity", label: "Activity & System" }
          : null,
      ].filter(Boolean) as Array<{ value: string; label: string }>,
    [permissions],
  );

  const [applicationId, setApplicationId] = useState(applications[0]?.id ?? "");
  const initialSource: "SYSTEM" | "AUDIT" | "VIOLATION" =
    availableCategories.length
      ? "SYSTEM"
      : permissions.violation
        ? "VIOLATION"
        : "AUDIT";
  const [source, setSource] = useState<"SYSTEM" | "AUDIT" | "VIOLATION">(
    initialSource,
  );
  const [category, setCategory] = useState(
    availableCategories[0]?.value ?? "activity",
  );
  const [query, setQuery] = useState("");
  const [username, setUsername] = useState("");
  const [requestId, setRequestId] = useState("");
  const [level, setLevel] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false);
  // const [message, setMessage] = useState<string | null>(null);
  const application =
    applications.find((item) => item.id === applicationId) ??
    applications[0] ??
    null;
  const [retentionByApplication, setRetentionByApplication] = useState<
    Record<string, RetentionPolicy[]>
  >(() =>
    Object.fromEntries(
      applications.map((item) => [item.id, item.retentionPolicies]),
    ),
  );
  const retentionPolicies = applicationId
    ? (retentionByApplication[applicationId] ?? [])
    : [];

  async function loadLogs(options?: {
    append?: boolean;
    cursor?: string | null;
  }) {
    setBusy(true);
    try {
      const params = new URLSearchParams({ source, limit: "50" });
      if (applicationId) params.set("applicationId", applicationId);
      if (source === "SYSTEM" && category) params.set("category", category);
      if (source === "SYSTEM" && level) params.set("level", level);
      if (query.trim()) params.set("query", query.trim());
      if (username.trim()) params.set("username", username.trim());
      if (source === "SYSTEM" && requestId.trim())
        params.set("requestId", requestId.trim());
      if (dateFrom)
        params.set("from", new Date(`${dateFrom}T00:00:00`).toISOString());
      if (dateTo)
        params.set("to", new Date(`${dateTo}T23:59:59.999`).toISOString());
      if (options?.cursor) params.set("cursor", options.cursor);
      const payload = await readJson(
        await fetch(apiUrl(`/api/logs?${params.toString()}`), {
          cache: "no-store",
        }),
      );
      const nextEntries = payload.data.entries as Entry[];
      setEntries((current) =>
        options?.append ? [...current, ...nextEntries] : nextEntries,
      );
      setNextCursor(payload.data.nextCursor ?? null);
      if (!options?.append) setSelectedEntry(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat log");
    } finally {
      setBusy(false);
    }
  }

  function submitFilters(event: FormEvent) {
    event.preventDefault();
    void loadLogs();
  }

  function patchRetention(index: number, patch: Partial<RetentionPolicy>) {
    if (!applicationId) return;
    setRetentionByApplication((current) => ({
      ...current,
      [applicationId]: (current[applicationId] ?? []).map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }));
  }

  async function saveRetention() {
    if (!applicationId || !permissions.manageRetention) return;
    setBusy(true);
    try {
      const payload = await readJson(
        await fetch(apiUrl(`/api/applications/${applicationId}/retention`), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            policies: retentionPolicies.map((policy) => ({
              ...policy,
              dataType: "LOG",
            })),
          }),
        }),
      );
      setRetentionByApplication((current) => ({
        ...current,
        [applicationId]: payload.data.policies.filter(
          (policy: RetentionPolicy) => policy.dataType === "LOG",
        ),
      }));
      toast.success("Retention log berhasil diperbarui.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal menyimpan retention",
      );
    } finally {
      setBusy(false);
    }
  }

  const canShowSystem = availableCategories.length > 0;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="text-sm font-medium text-slate-700">
            Application
            <select
              value={applicationId}
              onChange={(event) => setApplicationId(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
            >
              {applications.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.key})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Log Source
            <select
              value={source}
              onChange={(event) =>
                setSource(event.target.value as typeof source)
              }
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
            >
              {canShowSystem ? (
                <option value="SYSTEM">System Logs</option>
              ) : null}
              {permissions.violation ? (
                <option value="VIOLATION">Violation Logs</option>
              ) : null}
              {permissions.audit ? (
                <option value="AUDIT">Audit Trail</option>
              ) : null}
            </select>
          </label>
          {source === "SYSTEM" ? (
            <label className="text-sm font-medium text-slate-700">
              Category
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
              >
                {availableCategories.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div />
          )}
        </div>
      </div>

      <form
        onSubmit={submitFilters}
        className="rounded-2xl bg-white p-6 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-slate-950">
          Search & Filter
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Keyword"
            className="rounded-xl border border-slate-300 px-4 py-3"
          />
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Username"
            className="rounded-xl border border-slate-300 px-4 py-3"
          />
          {source === "SYSTEM" ? (
            <input
              value={requestId}
              onChange={(event) => setRequestId(event.target.value)}
              placeholder="Request / Correlation ID"
              className="rounded-xl border border-slate-300 px-4 py-3"
            />
          ) : (
            <div />
          )}
          {source === "SYSTEM" ? (
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              className="rounded-xl border border-slate-300 px-4 py-3"
            >
              <option value="">All levels</option>
              {["DEBUG", "INFO", "WARN", "ERROR", "FATAL"].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          ) : (
            <div />
          )}
          <label className="text-xs font-medium text-slate-600">
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            To
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
            />
          </label>
        </div>
        <button
          disabled={busy}
          className="mt-4 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          Search
        </button>
      </form>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-950">Log Entries</h2>
          <span className="text-sm text-slate-500">
            {entries.length} loaded
          </span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-3">Time</th>
                <th>Level</th>
                <th>Type / Source</th>
                <th>Username</th>
                <th>Action</th>
                <th>Message</th>
                <th>Request ID</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  onClick={() => setSelectedEntry(entry)}
                  className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                >
                  <td className="py-4 whitespace-nowrap">
                    {new Date(entry.timestamp).toLocaleString()}
                  </td>
                  <td>{entry.level}</td>
                  <td>{entry.type ?? entry.source}</td>
                  <td>{entry.username ?? "-"}</td>
                  <td>{entry.action ?? "-"}</td>
                  <td className="max-w-[380px] truncate">{entry.message}</td>
                  <td className="max-w-[220px] truncate font-mono text-xs">
                    {entry.requestId ?? "-"}
                  </td>
                </tr>
              ))}
              {!entries.length ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Tidak ada log untuk filter ini.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {nextCursor ? (
          <button
            disabled={busy}
            onClick={() => void loadLogs({ append: true, cursor: nextCursor })}
            className="mt-4 rounded-xl border border-slate-300 px-4 py-2 text-sm"
          >
            Load More
          </button>
        ) : null}
      </div>

      {selectedEntry ? (
        <div className="rounded-2xl bg-slate-950 p-6 text-slate-100 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Log Detail</h2>
            <button
              onClick={() => setSelectedEntry(null)}
              className="text-sm text-slate-300"
            >
              Close
            </button>
          </div>
          <div className="mt-4 grid gap-2 text-sm md:grid-cols-2">
            <p>
              <span className="text-slate-400">Time:</span>{" "}
              {new Date(selectedEntry.timestamp).toLocaleString()}
            </p>
            <p>
              <span className="text-slate-400">Request:</span>{" "}
              {selectedEntry.requestId ?? "-"}
            </p>
            <p>
              <span className="text-slate-400">User:</span>{" "}
              {selectedEntry.username ?? "-"}
            </p>
            <p>
              <span className="text-slate-400">Action:</span>{" "}
              {selectedEntry.action ?? "-"}
            </p>
          </div>
          <pre className="mt-4 max-h-[500px] overflow-auto rounded-xl bg-slate-900 p-4 text-xs leading-6">
            {formatMetadata(selectedEntry.metadata)}
          </pre>
        </div>
      ) : null}

      {application ? (
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                Dynamic Log Retention
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Kebijakan ini digunakan oleh maintenance job{" "}
                <code>npm run logs:retention</code>.
              </p>
            </div>
            {permissions.manageRetention ? (
              <button
                disabled={busy}
                onClick={() => void saveRetention()}
                className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                Save Retention
              </button>
            ) : null}
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {retentionPolicies.map((policy, index) => (
              <div
                key={policy.category}
                className="rounded-xl border border-slate-200 p-4"
              >
                <p className="font-medium text-slate-900">
                  {RETENTION_LABELS[policy.category] ?? policy.category}
                </p>
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={policy.keepForever}
                    disabled={!permissions.manageRetention}
                    onChange={(event) =>
                      patchRetention(index, {
                        keepForever: event.target.checked,
                        retentionDays: event.target.checked
                          ? null
                          : (policy.retentionDays ?? 90),
                      })
                    }
                  />
                  Keep Forever
                </label>
                <input
                  type="number"
                  min={1}
                  max={36500}
                  disabled={!permissions.manageRetention || policy.keepForever}
                  value={policy.retentionDays ?? ""}
                  onChange={(event) =>
                    patchRetention(index, {
                      retentionDays: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                  className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
                  placeholder="Retention days"
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

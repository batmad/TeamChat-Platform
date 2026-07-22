"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiUrl } from "@/lib/api/api-url";

type WidgetConfig = {
  position: string;
  bubbleIconUrl: string | null;
  bubbleSize: number;
  primaryColor: string;
  windowWidth: number;
  windowHeight: number;
  soundEnabledByDefault: boolean;
  browserNotificationEnabledByDefault: boolean;
  theme: "light" | "dark" | "auto";
} | null;

type RetentionPolicy = {
  dataType: "LOG" | "CHAT";
  category: string;
  label: string;
  retentionDays: number | null;
  keepForever: boolean;
};

type ApplicationItem = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: "ACTIVE" | "INACTIVE";
  allowedOrigins: string[];
  widgetConfig: WidgetConfig;
  integrations: Array<{
    id: string;
    name: string;
    type: "DATABASE" | "API";
    status: string;
    isDefaultUserSource: boolean;
  }>;
  retentionPolicies: RetentionPolicy[];
  _count: {
    userIdentities: number;
    roles: number;
    groups: number;
    rooms: number;
    messages: number;
  };
};

type ApiResult = { success?: boolean; error?: { message?: string } };

function lines(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function ApplicationManager({
  applications,
  canCreate,
  canManage,
  canDelete,
}: {
  applications: ApplicationItem[];
  canCreate: boolean;
  canManage: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(applications[0]?.id ?? "");
  const [tab, setTab] = useState<
    "general" | "widget" | "retention" | "integration"
  >("general");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const application =
    applications.find((item) => item.id === selectedId) ?? applications[0];
  const totalBusinessData = useMemo(() => {
    if (!application) return 0;
    return (
      Object.values(application._count).reduce(
        (total, value) => total + value,
        0,
      ) + application.integrations.length
    );
  }, [application]);

  async function parseResponse(response: Response): Promise<ApiResult> {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  async function createApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await fetch(apiUrl("/api/applications"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: String(form.get("key") ?? "") || undefined,
        name: String(form.get("name") ?? ""),
        description: String(form.get("description") ?? "") || null,
        allowedOrigins: lines(String(form.get("allowedOrigins") ?? "")),
      }),
    });
    const result = await parseResponse(response);
    setBusy(false);
    if (!response.ok) {
      setMessage(result.error?.message ?? "Gagal membuat application");
      return;
    }
    formElement.reset();
    setMessage("Application berhasil dibuat.");
    router.refresh();
  }

  async function updateGeneral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!application) return;
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch(
      apiUrl(`/api/applications/${application.id}`),
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          description: String(form.get("description") ?? "") || null,
          status: String(form.get("status") ?? "ACTIVE"),
          allowedOrigins: lines(String(form.get("allowedOrigins") ?? "")),
        }),
      },
    );
    const result = await parseResponse(response);
    setBusy(false);
    setMessage(
      response.ok
        ? "Konfigurasi application berhasil disimpan."
        : (result.error?.message ?? "Gagal menyimpan application"),
    );
    if (response.ok) router.refresh();
  }

  async function updateWidget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!application) return;
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch(
      apiUrl(`/api/applications/${application.id}/widget-config`),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          position: String(form.get("position") ?? "right-bottom"),
          bubbleIconUrl: String(form.get("bubbleIconUrl") ?? "") || null,
          bubbleSize: Number(form.get("bubbleSize")),
          primaryColor: String(form.get("primaryColor") ?? "#2563EB"),
          windowWidth: Number(form.get("windowWidth")),
          windowHeight: Number(form.get("windowHeight")),
          soundEnabledByDefault: form.get("soundEnabledByDefault") === "on",
          browserNotificationEnabledByDefault:
            form.get("browserNotificationEnabledByDefault") === "on",
          theme: String(form.get("theme") ?? "light"),
        }),
      },
    );
    const result = await parseResponse(response);
    setBusy(false);
    setMessage(
      response.ok
        ? "Konfigurasi widget berhasil disimpan."
        : (result.error?.message ?? "Gagal menyimpan widget"),
    );
    if (response.ok) router.refresh();
  }

  async function updateRetention(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!application) return;
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const policies = application.retentionPolicies.map((policy) => {
      const prefix = `${policy.dataType}:${policy.category}`;
      const keepForever = form.get(`${prefix}:keepForever`) === "on";
      return {
        dataType: policy.dataType,
        category: policy.category,
        keepForever,
        retentionDays: keepForever
          ? null
          : Number(form.get(`${prefix}:retentionDays`)),
      };
    });
    const response = await fetch(
      apiUrl(`/api/applications/${application.id}/retention`),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policies }),
      },
    );
    const result = await parseResponse(response);
    setBusy(false);
    setMessage(
      response.ok
        ? "Retention configuration berhasil disimpan."
        : (result.error?.message ?? "Gagal menyimpan retention"),
    );
    if (response.ok) router.refresh();
  }

  async function deleteApplication() {
    if (!application) return;
    if (
      !window.confirm(
        `Hapus application ${application.name}? Hanya application kosong yang dapat dihapus.`,
      )
    )
      return;
    setBusy(true);
    setMessage(null);
    const response = await fetch(
      apiUrl(`/api/applications/${application.id}`),
      {
        method: "DELETE",
      },
    );
    const result = await parseResponse(response);
    setBusy(false);
    setMessage(
      response.ok
        ? "Application berhasil dihapus."
        : (result.error?.message ?? "Gagal menghapus application"),
    );
    if (response.ok) router.refresh();
  }

  return (
    <div className="space-y-6">
      {canCreate ? (
        <form
          onSubmit={createApplication}
          className="rounded-3xl bg-white p-6 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                Create Application
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Application key boleh dikosongkan agar dibuat otomatis dan
                stabil.
              </p>
            </div>
            <button
              disabled={busy}
              className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
            >
              Create
            </button>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <input
              name="name"
              required
              placeholder="Application name, e.g. CRM"
              className="rounded-xl border border-slate-300 px-4 py-3"
            />
            <input
              name="key"
              placeholder="Optional key, e.g. crm-production"
              className="rounded-xl border border-slate-300 px-4 py-3"
            />
            <textarea
              name="description"
              placeholder="Description"
              className="min-h-24 rounded-xl border border-slate-300 px-4 py-3"
            />
            <textarea
              name="allowedOrigins"
              placeholder={
                "Allowed origins, one per line\nhttps://crm.example.com"
              }
              className="min-h-24 rounded-xl border border-slate-300 px-4 py-3"
            />
          </div>
        </form>
      ) : null}

      {!applications.length ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-600">
          Belum ada application. ROOT dapat membuat application pertama dari
          form di atas.
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-3xl bg-white p-4 shadow-sm">
            <p className="px-2 pb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Applications
            </p>
            <div className="space-y-2">
              {applications.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(item.id);
                    setTab("general");
                    setMessage(null);
                  }}
                  className={`w-full rounded-2xl p-4 text-left transition ${item.id === application?.id ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100"}`}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-medium">{item.name}</span>
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${item.status === "ACTIVE" ? "bg-emerald-400" : "bg-slate-400"}`}
                    />
                  </span>
                  <span className="mt-1 block truncate text-xs opacity-70">
                    {item.key}
                  </span>
                </button>
              ))}
            </div>
          </aside>

          {application ? (
            <section className="min-w-0 space-y-6">
              <div className="rounded-3xl bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-slate-500">{application.key}</p>
                    <h2 className="mt-1 text-2xl font-semibold text-slate-950">
                      {application.name}
                    </h2>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${application.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}
                  >
                    {application.status}
                  </span>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {Object.entries(application._count).map(([label, value]) => (
                    <div
                      key={label}
                      className="min-w-0 overflow-hidden rounded-2xl bg-slate-50 p-4"
                    >
                      <p className="break-words [overflow-wrap:anywhere] text-xs uppercase tracking-wide text-slate-400">
                        {label}
                      </p>

                      <p className="mt-1 text-xl font-semibold text-slate-950">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 overflow-x-auto rounded-2xl bg-white p-2 shadow-sm">
                {(
                  ["general", "widget", "retention", "integration"] as const
                ).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setTab(item)}
                    className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium ${tab === item ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                  >
                    {item === "general"
                      ? "General"
                      : item === "widget"
                        ? "Widget"
                        : item === "retention"
                          ? "Retention"
                          : "Integration"}
                  </button>
                ))}
              </div>

              {tab === "general" ? (
                <form
                  key={`general:${application.id}:${application.name}:${application.status}`}
                  onSubmit={updateGeneral}
                  className="rounded-3xl bg-white p-6 shadow-sm"
                >
                  <h3 className="text-lg font-semibold text-slate-950">
                    General Configuration
                  </h3>
                  <div className="mt-5 grid gap-4 lg:grid-cols-2">
                    <label className="text-sm font-medium text-slate-700">
                      Application Key
                      <input
                        value={application.key}
                        readOnly
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 font-mono text-sm text-slate-600"
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-700">
                      Status
                      <select
                        name="status"
                        defaultValue={application.status}
                        disabled={!canManage}
                        className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="INACTIVE">INACTIVE</option>
                      </select>
                    </label>
                    <label className="text-sm font-medium text-slate-700">
                      Name
                      <input
                        name="name"
                        defaultValue={application.name}
                        disabled={!canManage}
                        required
                        className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-700">
                      Description
                      <input
                        name="description"
                        defaultValue={application.description ?? ""}
                        disabled={!canManage}
                        className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-700 lg:col-span-2">
                      Allowed Origins
                      <textarea
                        name="allowedOrigins"
                        defaultValue={application.allowedOrigins.join("\n")}
                        disabled={!canManage}
                        className="mt-2 min-h-32 w-full rounded-xl border border-slate-300 px-4 py-3 font-mono text-sm disabled:bg-slate-100"
                      />
                      <span className="mt-2 block text-xs font-normal text-slate-500">
                        Satu origin per baris, contoh https://crm.example.com.
                        Enforcement digunakan saat widget/auth integration
                        diaktifkan.
                      </span>
                    </label>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-3">
                    {canManage ? (
                      <button
                        disabled={busy}
                        className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
                      >
                        Save General
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button
                        type="button"
                        onClick={deleteApplication}
                        disabled={busy || totalBusinessData > 0}
                        className="rounded-xl border border-red-200 px-5 py-3 text-sm font-medium text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Delete Empty Application
                      </button>
                    ) : null}
                  </div>
                  {canDelete && totalBusinessData > 0 ? (
                    <p className="mt-3 text-xs text-slate-500">
                      Application yang sudah memiliki data bisnis tidak dapat
                      di-hard delete. Gunakan status INACTIVE.
                    </p>
                  ) : null}
                </form>
              ) : null}

              {tab === "widget" ? (
                <form
                  key={`widget:${application.id}:${application.widgetConfig?.primaryColor ?? "default"}`}
                  onSubmit={updateWidget}
                  className="rounded-3xl bg-white p-6 shadow-sm"
                >
                  <h3 className="text-lg font-semibold text-slate-950">
                    Widget Configuration
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Konfigurasi visual dasar disiapkan sekarang; embeddable
                    widget final dibangun pada fase widget.
                  </p>
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <label className="text-sm font-medium text-slate-700">
                      Position
                      <select
                        name="position"
                        defaultValue={
                          application.widgetConfig?.position ?? "right-bottom"
                        }
                        disabled={!canManage}
                        className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                      >
                        <option value="right-bottom">Right Bottom</option>
                        <option value="left-bottom">Left Bottom</option>
                      </select>
                    </label>
                    <label className="text-sm font-medium text-slate-700">
                      Primary Color
                      <input
                        name="primaryColor"
                        defaultValue={
                          application.widgetConfig?.primaryColor ?? "#2563EB"
                        }
                        disabled={!canManage}
                        className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-700">
                      Theme
                      <select
                        name="theme"
                        defaultValue={
                          application.widgetConfig?.theme ?? "light"
                        }
                        disabled={!canManage}
                        className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                      >
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                        <option value="auto">Auto (System)</option>
                      </select>
                    </label>
                    <label className="text-sm font-medium text-slate-700">
                      Bubble Size
                      <input
                        name="bubbleSize"
                        type="number"
                        min="40"
                        max="96"
                        defaultValue={
                          application.widgetConfig?.bubbleSize ?? 60
                        }
                        disabled={!canManage}
                        className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-700">
                      Bubble Icon URL
                      <input
                        name="bubbleIconUrl"
                        type="url"
                        defaultValue={
                          application.widgetConfig?.bubbleIconUrl ?? ""
                        }
                        disabled={!canManage}
                        className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-700">
                      Window Width
                      <input
                        name="windowWidth"
                        type="number"
                        min="300"
                        max="720"
                        defaultValue={
                          application.widgetConfig?.windowWidth ?? 380
                        }
                        disabled={!canManage}
                        className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-700">
                      Window Height
                      <input
                        name="windowHeight"
                        type="number"
                        min="400"
                        max="900"
                        defaultValue={
                          application.widgetConfig?.windowHeight ?? 600
                        }
                        disabled={!canManage}
                        className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                      />
                    </label>
                  </div>
                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
                      <input
                        name="soundEnabledByDefault"
                        type="checkbox"
                        defaultChecked={
                          application.widgetConfig?.soundEnabledByDefault ??
                          true
                        }
                        disabled={!canManage}
                      />
                      Sound enabled by default
                    </label>
                    <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
                      <input
                        name="browserNotificationEnabledByDefault"
                        type="checkbox"
                        defaultChecked={
                          application.widgetConfig
                            ?.browserNotificationEnabledByDefault ?? true
                        }
                        disabled={!canManage}
                      />
                      Browser notification enabled by default
                    </label>
                  </div>
                  {canManage ? (
                    <button
                      disabled={busy}
                      className="mt-5 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Save Widget
                    </button>
                  ) : null}
                </form>
              ) : null}

              {tab === "retention" ? (
                <form
                  key={`retention:${application.id}:${application.retentionPolicies.map((p) => `${p.category}:${p.retentionDays}:${p.keepForever}`).join("|")}`}
                  onSubmit={updateRetention}
                  className="rounded-3xl bg-white p-6 shadow-sm"
                >
                  <h3 className="text-lg font-semibold text-slate-950">
                    Retention Configuration
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Setiap application memiliki retention sendiri untuk chat dan
                    log.
                  </p>
                  <div className="mt-5 overflow-x-auto">
                    <table className="w-full min-w-[680px] text-left text-sm">
                      <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                        <tr>
                          <th className="py-3 pr-4">Data</th>
                          <th className="py-3 pr-4">Type</th>
                          <th className="py-3 pr-4">Days</th>
                          <th className="py-3">Keep Forever</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {application.retentionPolicies.map((policy) => {
                          const prefix = `${policy.dataType}:${policy.category}`;
                          return (
                            <tr key={prefix}>
                              <td className="py-4 pr-4 font-medium text-slate-900">
                                {policy.label}
                              </td>
                              <td className="py-4 pr-4 text-slate-500">
                                {policy.dataType}
                              </td>
                              <td className="py-4 pr-4">
                                <input
                                  name={`${prefix}:retentionDays`}
                                  type="number"
                                  min="1"
                                  max="36500"
                                  defaultValue={policy.retentionDays ?? 365}
                                  disabled={!canManage}
                                  className="w-32 rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100"
                                />
                              </td>
                              <td className="py-4">
                                <input
                                  name={`${prefix}:keepForever`}
                                  type="checkbox"
                                  defaultChecked={policy.keepForever}
                                  disabled={!canManage}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    Saat Keep Forever dicentang, nilai Days diabaikan oleh
                    backend.
                  </p>
                  {canManage ? (
                    <button
                      disabled={busy}
                      className="mt-5 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Save Retention
                    </button>
                  ) : null}
                </form>
              ) : null}

              {tab === "integration" ? (
                <div className="rounded-3xl bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-slate-950">
                    Integration Status
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Kelola koneksi database/API, field mapping, role mapping,
                    preview, dan validasi user melalui Integration Engine.
                  </p>
                  <div className="mt-4">
                    <Link
                      href="/dashboard/integrations"
                      className="inline-flex rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white"
                    >
                      Open Integration Engine
                    </Link>
                  </div>
                  <div className="mt-5 space-y-3">
                    {application.integrations.map((integration) => (
                      <div
                        key={integration.id}
                        className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 p-4"
                      >
                        <div>
                          <p className="font-medium text-slate-900">
                            {integration.name}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {integration.type} · {integration.status}
                          </p>
                        </div>
                        {integration.isDefaultUserSource ? (
                          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                            Default User Source
                          </span>
                        ) : null}
                      </div>
                    ))}
                    {!application.integrations.length ? (
                      <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                        Belum ada integration.
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      )}

      {message ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm text-white shadow-xl">
          {message}
        </div>
      ) : null}
    </div>
  );
}

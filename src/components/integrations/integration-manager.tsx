"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiUrl } from "@/lib/api/api-url";

type Role = { id: string; code: string; name: string };
type MappingReadiness = {
  requiredTargets: string[];
  configuredTargets: string[];
  missingTargets: string[];
  mappingComplete: boolean;
  mappingRevision: number;
  previewedMappingRevision: number | null;
  lastMappingPreviewAt: Date | string | null;
  previewCurrent: boolean;
  canActivate: boolean;
};

type IntegrationSummary = {
  id: string;
  name: string;
  type: "DATABASE" | "API";
  status: "DRAFT" | "ACTIVE" | "INACTIVE" | "ERROR";
  databaseConfig: {
    databaseType: "POSTGRESQL" | "MYSQL" | "MARIADB" | "SQLSERVER";
    host?: string;
    port?: number;
    databaseName?: string;
    userTable?: string | null;
  } | null;
  apiConfig: {
    baseUrl: string;
    endpoint: string;
    authenticationMode: "NONE" | "BEARER" | "API_KEY" | "BASIC";
  } | null;
  isDefaultUserSource: boolean;
  lastTestedAt: Date | string | null;
  lastSuccessAt: Date | string | null;
  lastErrorAt: Date | string | null;
  _count: { fieldMappings: number; roleMappings: number };
  mappingReadiness?: MappingReadiness;
  updatedAt?: Date | string;
};
type Application = {
  id: string;
  key: string;
  name: string;
  roles: Role[];
  integrations: IntegrationSummary[];
};
type Field = { name: string; type: string; nullable?: boolean };
type IntegrationDetail = IntegrationSummary & {
  applicationId: string;
  databaseConfig:
    | (NonNullable<IntegrationSummary["databaseConfig"]> & {
        username: string;
        schemaName?: string | null;
        sslMode: "DISABLE" | "REQUIRE";
        hasPassword: boolean;
      })
    | null;
  apiConfig:
    | (NonNullable<IntegrationSummary["apiConfig"]> & {
        testEndpoint?: string | null;
        requestConfig: Record<string, unknown>;
        responseMapping: Record<string, unknown>;
        hasCredential: boolean;
      })
    | null;
  timeoutMs: number;
  mappingRevision: number;
  previewedMappingRevision: number | null;
  lastMappingPreviewAt: Date | string | null;
  mappingReadiness: MappingReadiness;
  fieldMappings: Array<{
    targetField: string;
    sourceField: string;
    defaultValue: string | null;
    isRequired: boolean;
  }>;
  roleMappings: Array<{
    sourceRole: string;
    role: Role & { isActive: boolean };
  }>;
};
type NormalizedUser = {
  username: string;
  name: string;
  sourceRole: string;
  primaryGroup: string;
  mappedRole: Role | null;
  standardUser: {
    username: string;
    name: string;
    role: string;
    group: string;
  } | null;
  readyForChat: boolean;
  normalizationIssues: string[];
  sourceSnapshot: Record<string, unknown>;
};

const TARGETS = [
  ["username", "Username"],
  ["name", "Display Name"],
  ["role", "Source Role"],
  ["primary_group", "Primary Group"],
] as const;

async function parseResponse(response: Response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message ?? "Request failed");
  return result;
}

function toLines(headers: Record<string, string> | undefined) {
  return Object.entries(headers ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function parseHeaders(value: string) {
  return Object.fromEntries(
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf(":");
        if (index < 1) throw new Error(`Invalid header: ${line}`);
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }),
  );
}

export function IntegrationManager({
  applications,
  canManage,
  canTest,
}: {
  applications: Application[];
  canManage: boolean;
  canTest: boolean;
}) {
  const router = useRouter();
  const [selectedApplicationId, setSelectedApplicationId] = useState(
    applications[0]?.id ?? "",
  );
  const selectedApplication = useMemo(
    () =>
      applications.find((app) => app.id === selectedApplicationId) ??
      applications[0],
    [applications, selectedApplicationId],
  );
  const [selectedIntegrationId, setSelectedIntegrationId] = useState(
    selectedApplication?.integrations[0]?.id ?? "",
  );
  const [detail, setDetail] = useState<IntegrationDetail | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [tables, setTables] = useState<
    Array<{ schema?: string | null; name: string }>
  >([]);
  const [preview, setPreview] = useState<NormalizedUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [sampleUser, setSampleUser] = useState("");

  const integrations = selectedApplication?.integrations ?? [];

  function changeApplication(applicationId: string) {
    const app = applications.find((item) => item.id === applicationId);
    setSelectedApplicationId(applicationId);
    setSelectedIntegrationId(app?.integrations[0]?.id ?? "");
    setDetail(null);
    setFields([]);
    setTables([]);
    setPreview([]);
  }

  async function loadDetail(integrationId: string) {
    if (!selectedApplication) return;
    setSelectedIntegrationId(integrationId);
    setBusy(true);
    try {
      const result = await parseResponse(
        await fetch(
          apiUrl(
            `/api/applications/${selectedApplication.id}/integrations/${integrationId}`,
          ),
        ),
      );
      setDetail(result.data.integration);
      setFields([]);
      setTables([]);
      setPreview([]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal memuat integration",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createIntegration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedApplication) return;
    const form = new FormData(event.currentTarget);
    const type = String(form.get("type"));
    const isDatabase = type === "DATABASE";
    const databaseConfig = isDatabase
      ? {
          databaseType: String(form.get("databaseType") || "POSTGRESQL"),
          host: String(form.get("host")),
          port: Number(form.get("port")),
          databaseName: String(form.get("database")),
          username: String(form.get("dbUsername")),
          schemaName: String(form.get("schema") || "") || null,
          sslMode: form.get("sslMode") === "on" ? "REQUIRE" : "DISABLE",
          userTable: null,
        }
      : undefined;
    const apiConfig = !isDatabase
      ? {
          baseUrl: String(form.get("baseUrl")),
          endpoint: String(form.get("userPath")),
          testEndpoint: String(form.get("testPath") || "") || null,
          authenticationMode: String(form.get("authType")),
          requestConfig: {
            lookupMethod: String(form.get("lookupMethod")),
            lookupParam: String(form.get("lookupParam")),
            apiKeyHeader: String(form.get("apiKeyHeader") || "") || null,
            basicUsername: String(form.get("basicUsername") || "") || null,
            staticHeaders: parseHeaders(
              String(form.get("staticHeaders") || ""),
            ),
          },
          responseMapping: {
            responseRoot: String(form.get("responseRoot") || "") || null,
          },
        }
      : undefined;
    const secret = isDatabase
      ? { password: String(form.get("dbPassword") || "") }
      : {
          bearerToken: String(form.get("bearerToken") || "") || undefined,
          apiKey: String(form.get("apiKey") || "") || undefined,
          basicPassword: String(form.get("basicPassword") || "") || undefined,
        };

    setBusy(true);
    try {
      const result = await parseResponse(
        await fetch(
          apiUrl(`/api/applications/${selectedApplication.id}/integrations`),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: String(form.get("name")),
              type,
              ...(isDatabase ? { databaseConfig } : { apiConfig }),
              secret,
              timeoutMs: Number(form.get("timeoutMs") || 10000),
              isDefaultUserSource: form.get("isDefaultUserSource") === "on",
            }),
          },
        ),
      );
      toast.success(
        "Integration berhasil dibuat. Buka detail untuk melanjutkan konfigurasi.",
      );
      setSelectedIntegrationId(result.data.integration.id);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal membuat integration",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveConfiguration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedApplication || !detail) return;
    const form = new FormData(event.currentTarget);
    const isDatabase = detail.type === "DATABASE";
    const databaseConfig = isDatabase
      ? {
          databaseType: String(form.get("databaseType")),
          host: String(form.get("host")),
          port: Number(form.get("port")),
          databaseName: String(form.get("database")),
          username: String(form.get("dbUsername")),
          schemaName: String(form.get("schema") || "") || null,
          sslMode: form.get("sslMode") === "on" ? "REQUIRE" : "DISABLE",
          userTable: String(form.get("userTable") || "") || null,
        }
      : undefined;
    const apiConfig = !isDatabase
      ? {
          baseUrl: String(form.get("baseUrl")),
          endpoint: String(form.get("userPath")),
          testEndpoint: String(form.get("testPath") || "") || null,
          authenticationMode: String(form.get("authType")),
          requestConfig: {
            lookupMethod: String(form.get("lookupMethod")),
            lookupParam: String(form.get("lookupParam")),
            apiKeyHeader: String(form.get("apiKeyHeader") || "") || null,
            basicUsername: String(form.get("basicUsername") || "") || null,
            staticHeaders: parseHeaders(
              String(form.get("staticHeaders") || ""),
            ),
          },
          responseMapping: {
            responseRoot: String(form.get("responseRoot") || "") || null,
          },
        }
      : undefined;
    const password = String(form.get("dbPassword") || "");
    const bearerToken = String(form.get("bearerToken") || "");
    const apiKey = String(form.get("apiKey") || "");
    const basicPassword = String(form.get("basicPassword") || "");
    const hasSecret = isDatabase
      ? Boolean(password)
      : Boolean(bearerToken || apiKey || basicPassword);
    const secret = isDatabase
      ? { password }
      : {
          bearerToken: bearerToken || undefined,
          apiKey: apiKey || undefined,
          basicPassword: basicPassword || undefined,
        };

    setBusy(true);
    try {
      await parseResponse(
        await fetch(
          apiUrl(
            `/api/applications/${selectedApplication.id}/integrations/${detail.id}`,
          ),
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: String(form.get("name")),
              status: String(form.get("status")),
              ...(isDatabase ? { databaseConfig } : { apiConfig }),
              ...(hasSecret ? { secret } : {}),
              timeoutMs: Number(form.get("timeoutMs")),
              isDefaultUserSource: form.get("isDefaultUserSource") === "on",
            }),
          },
        ),
      );
      toast.success("Configuration berhasil disimpan.");
      await loadDetail(detail.id);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Gagal menyimpan configuration",
      );
      setBusy(false);
    }
  }

  async function testConnection() {
    if (!selectedApplication || !detail) return;
    setBusy(true);
    try {
      const result = await parseResponse(
        await fetch(
          apiUrl(
            `/api/applications/${selectedApplication.id}/integrations/${detail.id}/test`,
          ),
          { method: "POST" },
        ),
      );

      toast.success(`Connection test berhasil (${result.data.durationMs} ms).`);
      router.refresh();
      await loadDetail(detail.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Connection test gagal",
      );
      setBusy(false);
    }
  }

  async function loadSourceMetadata(table?: string) {
    if (!selectedApplication || !detail) return;
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (table) params.set("table", table);
      if (detail.type === "API") params.set("lookupValue", sampleUser);
      const result = await parseResponse(
        await fetch(
          apiUrl(
            `/api/applications/${selectedApplication.id}/integrations/${detail.id}/source-metadata?${params}`,
          ),
        ),
      );
      if (result.data.kind === "tables") setTables(result.data.tables);
      else setFields(result.data.fields);
      toast.success(
        result.data.kind === "tables"
          ? `${result.data.tables.length} table ditemukan.`
          : `${result.data.fields.length} field ditemukan.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Gagal membaca source metadata",
      );
    } finally {
      setBusy(false);
    }
  }

  async function selectDatabaseTable(table: string) {
    if (!selectedApplication || !detail || detail.type !== "DATABASE") return;
    if (!canManage) {
      await loadSourceMetadata(table);
      return;
    }
    setBusy(true);
    try {
      await parseResponse(
        await fetch(
          apiUrl(
            `/api/applications/${selectedApplication.id}/integrations/${detail.id}`,
          ),
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              databaseConfig: {
                ...detail.databaseConfig,
                userTable: table,
                hasPassword: undefined,
              },
            }),
          },
        ),
      );
      await loadDetail(detail.id);
      await loadSourceMetadata(table);
      toast.success(`User table ${table} dipilih dan fields berhasil dibaca.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal memilih user table",
      );
      setBusy(false);
    }
  }

  async function saveMappings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedApplication || !detail) return;
    const form = new FormData(event.currentTarget);
    const mappings = TARGETS.map(([target]) => ({
      targetField: target,
      sourceField: String(form.get(target)),
      isRequired: true,
      defaultValue: null,
    }));
    setBusy(true);
    try {
      await parseResponse(
        await fetch(
          apiUrl(
            `/api/applications/${selectedApplication.id}/integrations/${detail.id}/field-mappings`,
          ),
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mappings,
              ...(detail.type === "API" ? { lookupValue: sampleUser } : {}),
            }),
          },
        ),
      );
      toast.success("Field mapping berhasil disimpan.");
      await loadDetail(detail.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal menyimpan mapping",
      );
      setBusy(false);
    }
  }

  async function saveRoleMappings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedApplication || !detail) return;
    const form = new FormData(event.currentTarget);
    const sourceRoles = form.getAll("sourceRole").map(String);
    const roleIds = form.getAll("roleId").map(String);
    const mappings = sourceRoles
      .map((sourceRole, index) => ({
        sourceRole: sourceRole.trim(),
        roleId: roleIds[index],
      }))
      .filter((item) => item.sourceRole && item.roleId);
    setBusy(true);
    try {
      await parseResponse(
        await fetch(
          apiUrl(
            `/api/applications/${selectedApplication.id}/integrations/${detail.id}/role-mappings`,
          ),
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mappings }),
          },
        ),
      );
      toast.success("Role mapping berhasil disimpan.");
      await loadDetail(detail.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal menyimpan role mapping",
      );
      setBusy(false);
    }
  }

  async function previewUsers() {
    if (!selectedApplication || !detail) return;
    setBusy(true);
    try {
      const result = await parseResponse(
        await fetch(
          apiUrl(
            `/api/applications/${selectedApplication.id}/integrations/${detail.id}/preview`,
          ),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              limit: 5,
              ...(detail.type === "API" ? { lookupValue: sampleUser } : {}),
            }),
          },
        ),
      );
      setPreview(result.data.users);
      const refreshed = await parseResponse(
        await fetch(
          apiUrl(
            `/api/applications/${selectedApplication.id}/integrations/${detail.id}`,
          ),
        ),
      );
      setDetail(refreshed.data.integration);
      toast.success(
        `${result.data.users.length} normalized user berhasil dipreview. Mapping revision ${refreshed.data.integration.mappingRevision} sekarang siap diaktifkan.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Preview gagal");
    } finally {
      setBusy(false);
    }
  }

  async function validateUser() {
    if (!selectedApplication || !detail || !sampleUser) return;
    setBusy(true);
    try {
      const result = await parseResponse(
        await fetch(
          apiUrl(
            `/api/applications/${selectedApplication.id}/integrations/${detail.id}/validate-user`,
          ),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ username: sampleUser }),
          },
        ),
      );
      setPreview(result.data.user ? [result.data.user] : []);
      toast.success(
        result.data.valid
          ? result.data.readyForLogin
            ? "External user valid, role terpetakan, dan siap digunakan pada fase autentikasi eksternal."
            : "External user valid, tetapi source role belum memiliki internal role mapping."
          : "External user tidak ditemukan.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Validasi user gagal",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-white p-6 shadow-sm">
        <label className="text-sm font-medium text-slate-700">
          Application
          <select
            value={selectedApplication?.id ?? ""}
            onChange={(event) => changeApplication(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
          >
            {applications.map((application) => (
              <option key={application.id} value={application.id}>
                {application.name} ({application.key})
              </option>
            ))}
          </select>
        </label>
      </div>

      {canManage && selectedApplication ? (
        <CreateIntegrationForm busy={busy} onSubmit={createIntegration} />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-3xl bg-white p-4 shadow-sm">
          <p className="px-2 pb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Integrations
          </p>
          <div className="space-y-2">
            {!integrations.length ? (
              <p className="p-4 text-sm text-slate-500">
                Belum ada integration.
              </p>
            ) : null}
            {integrations.map((integration) => (
              <button
                key={integration.id}
                type="button"
                onClick={() => loadDetail(integration.id)}
                className={`w-full rounded-2xl p-4 text-left ${selectedIntegrationId === integration.id ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-700"}`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="font-medium">{integration.name}</span>
                  <span className="text-xs opacity-70">
                    {integration.status}
                  </span>
                </span>
                <span className="mt-1 block text-xs opacity-70">
                  {integration.type}
                  {integration.databaseConfig?.databaseType
                    ? ` · ${integration.databaseConfig.databaseType}`
                    : ""}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="min-w-0 space-y-6">
          {!detail ? (
            <div className="rounded-3xl bg-white p-10 text-center text-slate-500">
              Pilih integration untuk melakukan konfigurasi.
            </div>
          ) : (
            <>
              <IntegrationConfiguration
                detail={detail}
                busy={busy}
                canManage={canManage}
                onSubmit={saveConfiguration}
              />
              <div className="rounded-3xl bg-white p-6 shadow-sm">
                <div className="flex flex-wrap gap-3">
                  {canTest ? (
                    <button
                      onClick={testConnection}
                      disabled={busy}
                      className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Test Connection
                    </button>
                  ) : null}
                  {canTest && detail.type === "DATABASE" ? (
                    <button
                      onClick={() => loadSourceMetadata()}
                      disabled={busy}
                      className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium"
                    >
                      Read Tables
                    </button>
                  ) : null}
                  {canTest && detail.type === "API" ? (
                    <button
                      onClick={() => loadSourceMetadata()}
                      disabled={busy || !sampleUser}
                      className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium disabled:opacity-50"
                    >
                      Read API Fields
                    </button>
                  ) : null}
                </div>
                {tables.length ? (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {tables.map((table) => (
                      <button
                        key={`${table.schema}.${table.name}`}
                        type="button"
                        onClick={() => selectDatabaseTable(table.name)}
                        className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700"
                      >
                        {table.schema ? `${table.schema}.` : ""}
                        {table.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <form
                onSubmit={saveMappings}
                className="rounded-3xl bg-white p-6 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-950">
                      Field Mapping
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Semua source dinormalisasi ke empat field standar per
                      integration.
                    </p>
                  </div>
                  <div
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${detail.mappingReadiness.canActivate ? "bg-emerald-100 text-emerald-700" : detail.mappingReadiness.mappingComplete ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}
                  >
                    {detail.mappingReadiness.canActivate
                      ? "Preview Valid"
                      : detail.mappingReadiness.mappingComplete
                        ? "Preview Required"
                        : "Mapping Incomplete"}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600 md:grid-cols-3">
                  <div>
                    <span className="block text-xs uppercase tracking-wide text-slate-400">
                      Revision
                    </span>
                    <strong className="text-slate-900">
                      {detail.mappingReadiness.mappingRevision}
                    </strong>
                  </div>
                  <div>
                    <span className="block text-xs uppercase tracking-wide text-slate-400">
                      Previewed Revision
                    </span>
                    <strong className="text-slate-900">
                      {detail.mappingReadiness.previewedMappingRevision ?? "-"}
                    </strong>
                  </div>
                  <div>
                    <span className="block text-xs uppercase tracking-wide text-slate-400">
                      Missing
                    </span>
                    <strong className="text-slate-900">
                      {detail.mappingReadiness.missingTargets.join(", ") ||
                        "None"}
                    </strong>
                  </div>
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {TARGETS.map(([target, label]) => {
                    const current =
                      detail.fieldMappings.find(
                        (mapping) => mapping.targetField === target,
                      )?.sourceField ?? "";
                    return (
                      <label
                        key={target}
                        className="text-sm font-medium text-slate-700"
                      >
                        {label}
                        <input
                          list={`fields-${detail.id}`}
                          name={target}
                          required
                          defaultValue={current}
                          disabled={!canManage}
                          className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                        />
                      </label>
                    );
                  })}
                </div>
                <datalist id={`fields-${detail.id}`}>
                  {fields.map((field) => (
                    <option key={field.name} value={field.name}>
                      {field.type}
                    </option>
                  ))}
                </datalist>
                {detail.type === "API" ? (
                  <p className="mt-4 text-xs text-slate-500">
                    API mapping divalidasi terhadap sample user. Isi Sample /
                    lookup username terlebih dahulu.
                  </p>
                ) : null}
                {canManage && canTest ? (
                  <button
                    disabled={busy || (detail.type === "API" && !sampleUser)}
                    className="mt-5 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Save & Validate Field Mapping
                  </button>
                ) : null}
              </form>

              <form
                onSubmit={saveRoleMappings}
                className="rounded-3xl bg-white p-6 shadow-sm"
              >
                <h3 className="text-lg font-semibold text-slate-950">
                  Role Mapping
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Petakan nilai role dari source ke dynamic internal role.
                </p>
                <div className="mt-5 space-y-3">
                  {[
                    ...detail.roleMappings,
                    {
                      sourceRole: "",
                      role: { id: "", code: "", name: "", isActive: true },
                    },
                  ].map((mapping, index) => (
                    <div
                      key={`${mapping.sourceRole}-${index}`}
                      className="grid gap-3 md:grid-cols-2"
                    >
                      <input
                        name="sourceRole"
                        defaultValue={mapping.sourceRole}
                        placeholder="Source role, e.g. AGENT"
                        disabled={!canManage}
                        className="rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                      />
                      <select
                        name="roleId"
                        defaultValue={mapping.role.id}
                        disabled={!canManage}
                        className="rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                      >
                        <option value="">Select internal role</option>
                        {selectedApplication.roles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name} ({role.code})
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                {canManage ? (
                  <button
                    disabled={busy}
                    className="mt-5 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Save Role Mapping
                  </button>
                ) : null}
              </form>

              <div className="rounded-3xl bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-950">
                  Preview & Validate User
                </h3>
                <div className="mt-5 flex flex-col gap-3 md:flex-row">
                  <input
                    value={sampleUser}
                    onChange={(event) => setSampleUser(event.target.value)}
                    placeholder={
                      detail.type === "API"
                        ? "Sample / lookup username"
                        : "Username untuk validasi"
                    }
                    className="flex-1 rounded-xl border border-slate-300 px-4 py-3"
                  />
                  <button
                    type="button"
                    onClick={previewUsers}
                    disabled={
                      !canTest || busy || (detail.type === "API" && !sampleUser)
                    }
                    className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium disabled:opacity-50"
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={validateUser}
                    disabled={!canTest || busy || !sampleUser}
                    className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Validate User
                  </button>
                </div>
                {preview.length ? (
                  <div className="mt-5 overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="p-3">Username</th>
                          <th className="p-3">Name</th>
                          <th className="p-3">Source Role</th>
                          <th className="p-3">Mapped Role</th>
                          <th className="p-3">Primary Group</th>
                          <th className="p-3">Chat Ready</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.map((user) => (
                          <tr
                            key={`${user.username}-${user.sourceRole}`}
                            className="border-b border-slate-100"
                          >
                            <td className="p-3 font-mono">{user.username}</td>
                            <td className="p-3">{user.name}</td>
                            <td className="p-3">{user.sourceRole}</td>
                            <td className="p-3">
                              {user.mappedRole?.name ?? (
                                <span className="text-amber-600">Unmapped</span>
                              )}
                            </td>
                            <td className="p-3">{user.primaryGroup}</td>
                            <td className="p-3">
                              {user.readyForChat ? (
                                <span className="text-emerald-700">Ready</span>
                              ) : (
                                <span className="text-amber-600">
                                  {user.normalizationIssues.join(", ") ||
                                    "Not ready"}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function CreateIntegrationForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [type, setType] = useState<"DATABASE" | "API">("DATABASE");
  const [authType, setAuthType] = useState("NONE");
  return (
    <form onSubmit={onSubmit} className="rounded-3xl bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">
            Create Integration
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Credential rahasia akan dienkripsi sebelum disimpan.
          </p>
        </div>
        <button
          disabled={busy}
          className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          Create
        </button>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <input
          name="name"
          required
          placeholder="Integration name"
          className="rounded-xl border border-slate-300 px-4 py-3"
        />
        <select
          name="type"
          value={type}
          onChange={(event) =>
            setType(event.target.value as "DATABASE" | "API")
          }
          className="rounded-xl border border-slate-300 px-4 py-3"
        >
          <option value="DATABASE">DATABASE</option>
          <option value="API">API</option>
        </select>
        {type === "DATABASE" ? (
          <DatabaseFields />
        ) : (
          <ApiFields authType={authType} setAuthType={setAuthType} />
        )}
        <input
          name="timeoutMs"
          type="number"
          defaultValue="10000"
          min="1000"
          max="60000"
          className="rounded-xl border border-slate-300 px-4 py-3"
        />
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm">
          <input type="checkbox" name="isDefaultUserSource" /> Default user
          source
        </label>
      </div>
    </form>
  );
}

function DatabaseFields({ config = {} }: { config?: Record<string, unknown> }) {
  return (
    <>
      <select
        name="databaseType"
        defaultValue={String(config.databaseType ?? "POSTGRESQL")}
        className="rounded-xl border border-slate-300 px-4 py-3"
      >
        <option value="POSTGRESQL">PostgreSQL</option>
        <option value="MYSQL">MySQL</option>
        <option value="MARIADB">MariaDB</option>
        <option value="SQLSERVER">SQL Server (driver optional)</option>
      </select>
      <input
        name="host"
        required
        defaultValue={String(config.host ?? "localhost")}
        placeholder="Host"
        className="rounded-xl border border-slate-300 px-4 py-3"
      />
      <input
        name="port"
        required
        type="number"
        defaultValue={Number(config.port ?? 5432)}
        placeholder="Port"
        className="rounded-xl border border-slate-300 px-4 py-3"
      />
      <input
        name="database"
        required
        defaultValue={String(config.databaseName ?? config.database ?? "")}
        placeholder="Database"
        className="rounded-xl border border-slate-300 px-4 py-3"
      />
      <input
        name="dbUsername"
        required
        defaultValue={String(config.username ?? "")}
        placeholder="Database username"
        className="rounded-xl border border-slate-300 px-4 py-3"
      />
      <input
        name="dbPassword"
        type="password"
        placeholder="Database password"
        className="rounded-xl border border-slate-300 px-4 py-3"
      />
      <input
        name="schema"
        defaultValue={String(config.schemaName ?? config.schema ?? "")}
        placeholder="Schema (optional)"
        className="rounded-xl border border-slate-300 px-4 py-3"
      />
      <input
        name="userTable"
        defaultValue={String(config.userTable ?? "")}
        placeholder="User table (save after selecting)"
        className="rounded-xl border border-slate-300 px-4 py-3"
      />
      <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm">
        <input
          type="checkbox"
          name="sslMode"
          defaultChecked={config.sslMode === "REQUIRE"}
        />{" "}
        Require SSL
      </label>
    </>
  );
}

function ApiFields({
  config = {},
  authType,
  setAuthType,
}: {
  config?: Record<string, unknown>;
  authType: string;
  setAuthType: (value: string) => void;
}) {
  return (
    <>
      <input
        name="baseUrl"
        required
        defaultValue={String(config.baseUrl ?? "")}
        placeholder="https://api.example.com"
        className="rounded-xl border border-slate-300 px-4 py-3"
      />
      <input
        name="userPath"
        required
        defaultValue={String(config.userPath ?? "/users/lookup")}
        placeholder="User path"
        className="rounded-xl border border-slate-300 px-4 py-3"
      />
      <input
        name="testPath"
        defaultValue={String(config.testPath ?? "")}
        placeholder="Test path (optional)"
        className="rounded-xl border border-slate-300 px-4 py-3"
      />
      <select
        name="lookupMethod"
        defaultValue={String(config.lookupMethod ?? "GET")}
        className="rounded-xl border border-slate-300 px-4 py-3"
      >
        <option value="GET">GET</option>
        <option value="POST">POST JSON</option>
      </select>
      <input
        name="lookupParam"
        required
        defaultValue={String(config.lookupParam ?? "username")}
        placeholder="Lookup parameter"
        className="rounded-xl border border-slate-300 px-4 py-3"
      />
      <input
        name="responseRoot"
        defaultValue={String(config.responseRoot ?? "")}
        placeholder="Response root, e.g. data.user"
        className="rounded-xl border border-slate-300 px-4 py-3"
      />
      <select
        name="authType"
        value={authType}
        onChange={(event) => setAuthType(event.target.value)}
        className="rounded-xl border border-slate-300 px-4 py-3"
      >
        <option value="NONE">No Auth</option>
        <option value="BEARER">Bearer</option>
        <option value="API_KEY">API Key</option>
        <option value="BASIC">Basic</option>
      </select>
      {authType === "BEARER" ? (
        <input
          name="bearerToken"
          type="password"
          placeholder="Bearer token"
          className="rounded-xl border border-slate-300 px-4 py-3"
        />
      ) : null}
      {authType === "API_KEY" ? (
        <>
          <input
            name="apiKeyHeader"
            defaultValue={String(config.apiKeyHeader ?? "x-api-key")}
            placeholder="API key header"
            className="rounded-xl border border-slate-300 px-4 py-3"
          />
          <input
            name="apiKey"
            type="password"
            placeholder="API key"
            className="rounded-xl border border-slate-300 px-4 py-3"
          />
        </>
      ) : null}
      {authType === "BASIC" ? (
        <>
          <input
            name="basicUsername"
            defaultValue={String(config.basicUsername ?? "")}
            placeholder="Basic username"
            className="rounded-xl border border-slate-300 px-4 py-3"
          />
          <input
            name="basicPassword"
            type="password"
            placeholder="Basic password"
            className="rounded-xl border border-slate-300 px-4 py-3"
          />
        </>
      ) : null}
      <textarea
        name="staticHeaders"
        defaultValue={toLines(
          config.staticHeaders as Record<string, string> | undefined,
        )}
        placeholder={"Static headers, one per line\nX-Tenant: demo"}
        className="min-h-24 rounded-xl border border-slate-300 px-4 py-3"
      />
    </>
  );
}

function IntegrationConfiguration({
  detail,
  busy,
  canManage,
  onSubmit,
}: {
  detail: IntegrationDetail;
  busy: boolean;
  canManage: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [authType, setAuthType] = useState(
    String(detail.apiConfig?.authenticationMode ?? "NONE"),
  );
  return (
    <form
      key={`${detail.id}-${detail.updatedAt ?? ""}`}
      onSubmit={onSubmit}
      className="rounded-3xl bg-white p-6 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            {detail.type}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">
            {detail.name}
          </h2>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          {detail.status}
        </span>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <input
          name="name"
          required
          defaultValue={detail.name}
          disabled={!canManage}
          className="rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
        />
        <select
          name="status"
          defaultValue={detail.status}
          disabled={!canManage}
          className="rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
        >
          <option value="DRAFT">DRAFT</option>
          <option
            value="ACTIVE"
            disabled={
              !detail.mappingReadiness.canActivate && detail.status !== "ACTIVE"
            }
          >
            ACTIVE{" "}
            {!detail.mappingReadiness.canActivate && detail.status !== "ACTIVE"
              ? "(preview mapping required)"
              : ""}
          </option>
          <option value="INACTIVE">INACTIVE</option>
          <option value="ERROR">ERROR</option>
        </select>
        {detail.type === "DATABASE" ? (
          <DatabaseFields config={detail.databaseConfig ?? {}} />
        ) : (
          <ApiFields
            config={
              detail.apiConfig
                ? {
                    ...detail.apiConfig,
                    ...detail.apiConfig.requestConfig,
                    ...detail.apiConfig.responseMapping,
                    authType: detail.apiConfig.authenticationMode,
                    userPath: detail.apiConfig.endpoint,
                    testPath: detail.apiConfig.testEndpoint,
                  }
                : {}
            }
            authType={authType}
            setAuthType={setAuthType}
          />
        )}
        <input
          name="timeoutMs"
          type="number"
          defaultValue={detail.timeoutMs}
          min="1000"
          max="60000"
          disabled={!canManage}
          className="rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
        />
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm">
          <input
            type="checkbox"
            name="isDefaultUserSource"
            defaultChecked={detail.isDefaultUserSource}
            disabled={!canManage}
          />{" "}
          Default user source
        </label>
      </div>
      {!detail.mappingReadiness.canActivate && detail.status !== "ACTIVE" ? (
        <p className="mt-3 text-xs font-medium text-amber-700">
          Integration hanya dapat diaktifkan setelah empat mapping tersimpan dan
          revision terbaru berhasil dipreview.
        </p>
      ) : null}
      <p className="mt-3 text-xs text-slate-500">
        Biarkan field secret/password kosong saat edit untuk mempertahankan
        credential terenkripsi yang sudah ada.
      </p>
      {canManage ? (
        <button
          disabled={busy}
          className="mt-5 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          Save Configuration
        </button>
      ) : null}
    </form>
  );
}

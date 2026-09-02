"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { apiUrl } from "@/lib/api/api-url";

type ApplicationOption = { id: string; key: string; name: string };
type FileType = {
  id?: string;
  applicationId?: string | null;
  extension: string;
  category:
    | "IMAGE"
    | "DOCUMENT"
    | "SPREADSHEET"
    | "ARCHIVE"
    | "AUDIO"
    | "VIDEO"
    | "TEXT"
    | "OTHER";
  mimeTypes: string[];
  maxSizeBytes: string | null;
  previewable: boolean;
  isAllowed: boolean;
  isActive: boolean;
};
type Policy = {
  inheritGlobal?: boolean;
  enabled: boolean;
  privateEnabled: boolean;
  groupEnabled: boolean;
  maxFileSizeBytes: string;
  maxFilesPerMessage: number;
  maxTotalSizeBytes: string;
  storageQuotaBytes: string | null;
  imagePreviewEnabled: boolean;
  pdfPreviewEnabled: boolean;
  malwareScanEnabled: boolean;
  malwareScannerProviderId: string | null;
  validateMime: boolean;
  validateSignature: boolean;
  temporaryTtlMinutes: number;
  failedCleanupHours: number;
  uploadRateLimitEnabled: boolean;
  uploadRateLimitWindowMs: number;
  uploadRateLimitMaxRequests: number;
  uploadRateLimitMaxBytes: string;
  deleteRetryMaxAttempts: number;
  deleteRetryBaseMinutes: number;
  auditDownloadEnabled: boolean;
  auditPreviewEnabled: boolean;
  storageProviderId: string | null;
  source?: string;
};
type Provider = {
  id: string;
  key: string;
  applicationId: string | null;
  name: string;
  type: "LOCAL" | "S3" | "MINIO";
  isActive: boolean;
  isDefault: boolean;
  config: Record<string, unknown>;
  hasCredentials?: boolean;
  lastHealthCheckAt: string | null;
  lastHealthStatus: string | null;
  lastHealthError: string | null;
};
type SettingsPayload = {
  scope: "GLOBAL" | "APPLICATION";
  applicationId: string | null;
  applicationPolicy: (Partial<Policy> & { inheritGlobal?: boolean }) | null;
  effectivePolicy: Policy;
  fileTypes: FileType[];
  providers: Provider[];
  scanners: Array<{
    id: string;
    name: string;
    applicationId: string | null;
    type: string;
    lastHealthStatus: string | null;
  }>;
};
type ApiEnvelope<T> = {
  success: boolean;
  data?: T;
  error?: { message?: string };
};

function mb(bytes: string | null | undefined) {
  if (!bytes) return "";
  return String(Math.round((Number(bytes) / 1024 / 1024) * 100) / 100);
}
function gb(bytes: string | null | undefined) {
  if (!bytes) return "";
  return String(Math.round((Number(bytes) / 1024 / 1024 / 1024) * 100) / 100);
}
function bytesFromMb(value: FormDataEntryValue | null) {
  return String(Math.max(0, Number(value || 0)) * 1024 * 1024);
}
function optionalBytesFromMb(value: FormDataEntryValue | null) {
  const number = Number(value || 0);
  return number > 0 ? String(number * 1024 * 1024) : null;
}
function bytesFromGb(value: FormDataEntryValue | null) {
  const number = Number(value || 0);
  return number > 0 ? String(number * 1024 * 1024 * 1024) : null;
}
async function json<T>(response: Response): Promise<ApiEnvelope<T>> {
  return (await response
    .json()
    .catch(() => ({ success: false }))) as ApiEnvelope<T>;
}

export function AttachmentSettingsManager({
  isRoot,
  canManage,
  currentApplicationId,
  applications,
}: {
  isRoot: boolean;
  canManage: boolean;
  currentApplicationId: string | null;
  applications: ApplicationOption[];
}) {
  const [scope, setScope] = useState<string>(
    isRoot ? "GLOBAL" : (currentApplicationId ?? ""),
  );
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [tab, setTab] = useState<"policy" | "types" | "storage">("policy");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const applicationId = scope === "GLOBAL" ? null : scope || null;
  const selectedApplication =
    applications.find((item) => item.id === applicationId) ?? null;

  const fetchSettings = useCallback(async () => {
    const query = applicationId
      ? `?applicationId=${encodeURIComponent(applicationId)}`
      : "";

    const response = await fetch(apiUrl(`/api/attachments/settings${query}`), {
      cache: "no-store",
    });

    const result = await json<SettingsPayload>(response);

    if (!response.ok || !result.data) {
      throw new Error(
        result.error?.message ?? "Gagal memuat attachment settings",
      );
    }

    const providerQuery = isRoot
      ? applicationId
        ? `?applicationId=${encodeURIComponent(applicationId)}`
        : "?scope=global"
      : "";

    const providerResponse = await fetch(
      apiUrl(`/api/storage/providers${providerQuery}`),
      {
        cache: "no-store",
      },
    );

    const providerResult = await json<{ providers: Provider[] }>(
      providerResponse,
    );

    return {
      settings: result.data,
      providers: providerResult.data?.providers ?? result.data.providers ?? [],
    };
  }, [applicationId, isRoot]);

  useEffect(() => {
    let cancelled = false;

    void fetchSettings()
      .then((data) => {
        if (cancelled) {
          return;
        }

        setSettings(data.settings);
        setProviders(data.providers);
        setMessage(null);
        setBusy(false);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setMessage(
          error instanceof Error
            ? error.message
            : "Gagal memuat attachment settings",
        );
        setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchSettings]);

  const reload = useCallback(async () => {
    const data = await fetchSettings();

    setSettings(data.settings);
    setProviders(data.providers);
  }, [fetchSettings]);

  const policy = settings?.effectivePolicy;
  const rawPolicy = settings?.applicationPolicy;
  const fileTypes = useMemo(
    () => settings?.fileTypes ?? [],
    [settings?.fileTypes],
  );

  const groupedFileTypes = useMemo(() => {
    const result = new Map<string, FileType[]>();

    for (const item of fileTypes) {
      const rows = result.get(item.category) ?? [];
      rows.push(item);
      result.set(item.category, rows);
    }

    return [...result.entries()];
  }, [fileTypes]);

  async function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy) return;
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const inheritGlobal = Boolean(
      applicationId && form.get("inheritGlobal") === "on",
    );
    const concretePolicy = {
      enabled: form.get("enabled") === "on",
      privateEnabled: form.get("privateEnabled") === "on",
      groupEnabled: form.get("groupEnabled") === "on",
      maxFileSizeBytes: bytesFromMb(form.get("maxFileSizeMb")),
      maxFilesPerMessage: Number(form.get("maxFilesPerMessage")),
      maxTotalSizeBytes: bytesFromMb(form.get("maxTotalSizeMb")),
      storageQuotaBytes: bytesFromGb(form.get("storageQuotaGb")),
      imagePreviewEnabled: form.get("imagePreviewEnabled") === "on",
      pdfPreviewEnabled: form.get("pdfPreviewEnabled") === "on",
      malwareScanEnabled: form.get("malwareScanEnabled") === "on",
      malwareScannerProviderId:
        String(form.get("malwareScannerProviderId") || "") || null,
      validateMime: form.get("validateMime") === "on",
      validateSignature: form.get("validateSignature") === "on",
      temporaryTtlMinutes: Number(form.get("temporaryTtlMinutes")),
      failedCleanupHours: Number(form.get("failedCleanupHours")),
      uploadRateLimitEnabled: form.get("uploadRateLimitEnabled") === "on",
      uploadRateLimitWindowMs: Number(form.get("uploadRateLimitWindowMs")),
      uploadRateLimitMaxRequests: Number(
        form.get("uploadRateLimitMaxRequests"),
      ),
      uploadRateLimitMaxBytes: bytesFromMb(form.get("uploadRateLimitMaxMb")),
      deleteRetryMaxAttempts: Number(form.get("deleteRetryMaxAttempts")),
      deleteRetryBaseMinutes: Number(form.get("deleteRetryBaseMinutes")),
      auditDownloadEnabled: form.get("auditDownloadEnabled") === "on",
      auditPreviewEnabled: form.get("auditPreviewEnabled") === "on",
      storageProviderId: String(form.get("storageProviderId") || "") || null,
    };
    const inheritedPolicy = Object.fromEntries(
      Object.keys(concretePolicy).map((key) => [key, null]),
    );
    const response = await fetch(apiUrl("/api/attachments/settings"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        applicationId,
        inheritGlobal,
        ...(inheritGlobal ? inheritedPolicy : concretePolicy),
      }),
    });
    const result = await json<SettingsPayload>(response);
    setBusy(false);
    setMessage(
      response.ok
        ? "Attachment policy berhasil disimpan."
        : (result.error?.message ?? "Gagal menyimpan policy"),
    );
    if (response.ok && result.data) setSettings(result.data);
  }

  async function saveFileTypes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const policies = fileTypes.map((item) => ({
      extension: item.extension,
      category: item.category,
      mimeTypes: item.mimeTypes,
      maxSizeBytes: optionalBytesFromMb(form.get(`max:${item.extension}`)),
      previewable: form.get(`preview:${item.extension}`) === "on",
      isAllowed: form.get(`allow:${item.extension}`) === "on",
      isActive: true,
    }));
    const response = await fetch(apiUrl("/api/attachments/file-types"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ applicationId, policies }),
    });
    const result = await json<{ fileTypes: FileType[] }>(response);
    setBusy(false);
    setMessage(
      response.ok
        ? "File type policy berhasil disimpan."
        : (result.error?.message ?? "Gagal menyimpan file type policy"),
    );
    if (response.ok) await reload();
  }

  async function createProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isRoot) return;
    setBusy(true);
    setMessage(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const type = String(form.get("type") || "LOCAL") as Provider["type"];
    const endpoint = String(form.get("endpoint") || "").trim();
    const bucket = String(form.get("bucket") || "").trim();
    const path = String(form.get("path") || "").trim();
    const credentialMode = String(
      form.get("credentialMode") || "DEFAULT_CHAIN",
    );
    const config =
      type === "LOCAL"
        ? { basePath: path || "storage/attachments" }
        : {
            bucket,
            region: String(form.get("region") || "us-east-1"),
            ...(endpoint ? { endpoint } : {}),
            forcePathStyle:
              type === "MINIO" || form.get("forcePathStyle") === "on",
            prefix: String(form.get("prefix") || "attachments"),
            credentialMode,
            signedUrlEnabled: form.get("signedUrlEnabled") === "on",
            signedUrlTtlSeconds: Number(form.get("signedUrlTtlSeconds") || 60),
          };
    const accessKeyId = String(form.get("accessKeyId") || "");
    const secretAccessKey = String(form.get("secretAccessKey") || "");
    const response = await fetch(apiUrl("/api/storage/providers"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: String(form.get("key") || ""),
        applicationId,
        name: String(form.get("name") || ""),
        type,
        isActive: true,
        isDefault: form.get("isDefault") === "on",
        config,
        credentials:
          credentialMode === "STATIC" && accessKeyId && secretAccessKey
            ? { accessKeyId, secretAccessKey }
            : undefined,
      }),
    });
    const result = await json<{ provider: Provider }>(response);
    setBusy(false);
    setMessage(
      response.ok
        ? "Storage provider berhasil dibuat."
        : (result.error?.message ?? "Gagal membuat storage provider"),
    );
    if (response.ok) {
      formElement.reset();
      await reload();
    }
  }

  async function updateProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isRoot || !editingProvider) return;
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const type = editingProvider.type;
    const endpoint = String(form.get("endpoint") || "").trim();
    const bucket = String(form.get("bucket") || "").trim();
    const localPath = String(form.get("path") || "").trim();
    const credentialMode = String(
      form.get("credentialMode") || "DEFAULT_CHAIN",
    );
    const config =
      type === "LOCAL"
        ? {
            ...editingProvider.config,
            basePath: localPath || "storage/attachments",
          }
        : {
            ...editingProvider.config,
            bucket,
            region: String(form.get("region") || "us-east-1"),
            ...(endpoint ? { endpoint } : { endpoint: undefined }),
            forcePathStyle:
              type === "MINIO" || form.get("forcePathStyle") === "on",
            prefix: String(form.get("prefix") || "attachments"),
            credentialMode,
            signedUrlEnabled: form.get("signedUrlEnabled") === "on",
            signedUrlTtlSeconds: Number(form.get("signedUrlTtlSeconds") || 60),
          };
    if ("endpoint" in config && config.endpoint === undefined)
      delete config.endpoint;
    const accessKeyId = String(form.get("accessKeyId") || "").trim();
    const secretAccessKey = String(form.get("secretAccessKey") || "");
    if (
      (accessKeyId && !secretAccessKey) ||
      (!accessKeyId && secretAccessKey)
    ) {
      setBusy(false);
      setMessage(
        "Access key dan secret key harus diisi bersamaan untuk rotasi credential.",
      );
      return;
    }
    const response = await fetch(
      apiUrl(`/api/storage/providers/${editingProvider.id}`),
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: String(form.get("key") || editingProvider.key),
          name: String(form.get("name") || editingProvider.name),
          isDefault: form.get("isDefault") === "on",
          config,
          credentials:
            accessKeyId && secretAccessKey
              ? { accessKeyId, secretAccessKey }
              : undefined,
        }),
      },
    );
    const result = await json<{ provider: Provider }>(response);
    setBusy(false);
    setMessage(
      response.ok
        ? "Storage provider berhasil diperbarui."
        : (result.error?.message ?? "Gagal memperbarui provider"),
    );
    if (response.ok) {
      setEditingProvider(null);
      await reload();
    }
  }

  async function testProvider(providerId: string) {
    setBusy(true);
    setMessage(null);
    const response = await fetch(
      apiUrl(`/api/storage/providers/${providerId}/test`),
      { method: "POST" },
    );
    const result = await json<unknown>(response);
    setBusy(false);
    setMessage(
      response.ok
        ? "Storage connection test berhasil."
        : (result.error?.message ?? "Storage connection test gagal"),
    );
    await reload();
  }

  async function toggleProvider(provider: Provider) {
    if (!isRoot) return;
    setBusy(true);
    const response = await fetch(
      apiUrl(`/api/storage/providers/${provider.id}`),
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !provider.isActive }),
      },
    );
    const result = await json<unknown>(response);
    setBusy(false);
    setMessage(
      response.ok
        ? "Storage provider diperbarui."
        : (result.error?.message ?? "Gagal memperbarui provider"),
    );
    if (response.ok) await reload();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <label className="min-w-72 text-sm font-medium text-slate-700">
            Configuration scope
            <select
              value={scope}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                setBusy(true);
                setMessage(null);
                setSettings(null);
                setProviders([]);
                setScope(event.target.value);
              }}
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
            >
              {isRoot ? <option value="GLOBAL">GLOBAL DEFAULT</option> : null}
              {applications.map((application) => (
                <option key={application.id} value={application.id}>
                  {application.name} ({application.key})
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm text-slate-500">
            {applicationId
              ? `Application: ${selectedApplication?.name ?? applicationId}`
              : "System-wide attachment defaults"}
          </div>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto rounded-2xl bg-white p-2 shadow-sm">
        {(["policy", "types", "storage"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`rounded-xl px-4 py-2 text-sm font-medium ${tab === item ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            {item === "policy"
              ? "Policy & Security"
              : item === "types"
                ? "File Types"
                : "Storage Providers"}
          </button>
        ))}
      </div>

      {message ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-700 shadow-sm">
          {message}
        </div>
      ) : null}
      {busy && !settings ? (
        <div className="rounded-3xl bg-white p-10 text-center text-slate-500">
          Loading attachment configuration…
        </div>
      ) : null}

      {settings && policy && tab === "policy" ? (
        <form
          key={`policy:${scope}:${JSON.stringify(policy)}`}
          onSubmit={savePolicy}
          className="space-y-6 rounded-3xl bg-white p-6 shadow-sm"
        >
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Attachment Policy
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Nilai di bawah adalah effective policy untuk scope yang dipilih.
            </p>
          </div>
          {applicationId ? (
            <Toggle
              name="inheritGlobal"
              label="Inherit global policy"
              defaultChecked={rawPolicy?.inheritGlobal !== false}
              disabled={!canManage}
            />
          ) : null}
          <div className="grid gap-4 md:grid-cols-3">
            <Toggle
              name="enabled"
              label="Enable attachments"
              defaultChecked={policy.enabled}
              disabled={!canManage}
            />
            <Toggle
              name="privateEnabled"
              label="Private attachments"
              defaultChecked={policy.privateEnabled}
              disabled={!canManage}
            />
            <Toggle
              name="groupEnabled"
              label="Group attachments"
              defaultChecked={policy.groupEnabled}
              disabled={!canManage}
            />
          </div>
          <Section title="Limits">
            <NumberInput
              name="maxFileSizeMb"
              label="Max file size (MB)"
              defaultValue={mb(policy.maxFileSizeBytes)}
              disabled={!canManage}
            />
            <NumberInput
              name="maxFilesPerMessage"
              label="Max files/message"
              defaultValue={policy.maxFilesPerMessage}
              disabled={!canManage}
            />
            <NumberInput
              name="maxTotalSizeMb"
              label="Max total/message (MB)"
              defaultValue={mb(policy.maxTotalSizeBytes)}
              disabled={!canManage}
            />
            <NumberInput
              name="storageQuotaGb"
              label="Application quota (GB)"
              defaultValue={gb(policy.storageQuotaBytes)}
              disabled={!canManage}
            />
          </Section>
          <Section title="Preview & validation">
            <Toggle
              name="imagePreviewEnabled"
              label="Image preview"
              defaultChecked={policy.imagePreviewEnabled}
              disabled={!canManage}
            />
            <Toggle
              name="pdfPreviewEnabled"
              label="PDF preview"
              defaultChecked={policy.pdfPreviewEnabled}
              disabled={!canManage}
            />
            <Toggle
              name="validateMime"
              label="Validate MIME"
              defaultChecked={policy.validateMime}
              disabled={!canManage}
            />
            <Toggle
              name="validateSignature"
              label="Validate file signature"
              defaultChecked={policy.validateSignature}
              disabled={!canManage}
            />
          </Section>
          <Section title="Malware scanning">
            <Toggle
              name="malwareScanEnabled"
              label="Enable malware scan"
              defaultChecked={policy.malwareScanEnabled}
              disabled={!canManage}
            />
            <label className="text-sm font-medium text-slate-700">
              Scanner provider
              <select
                name="malwareScannerProviderId"
                defaultValue={policy.malwareScannerProviderId ?? ""}
                disabled={!canManage}
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
              >
                <option value="">Default / none</option>
                {settings.scanners.map((scanner) => (
                  <option key={scanner.id} value={scanner.id}>
                    {scanner.name} · {scanner.type}
                  </option>
                ))}
              </select>
            </label>
          </Section>
          <Section title="Cleanup & rate limiting">
            <NumberInput
              name="temporaryTtlMinutes"
              label="Temporary TTL (minutes)"
              defaultValue={policy.temporaryTtlMinutes}
              disabled={!canManage}
            />
            <NumberInput
              name="failedCleanupHours"
              label="Failed cleanup (hours)"
              defaultValue={policy.failedCleanupHours}
              disabled={!canManage}
            />
            <Toggle
              name="uploadRateLimitEnabled"
              label="Upload rate limit"
              defaultChecked={policy.uploadRateLimitEnabled}
              disabled={!canManage}
            />
            <NumberInput
              name="uploadRateLimitWindowMs"
              label="Rate window (ms)"
              defaultValue={policy.uploadRateLimitWindowMs}
              disabled={!canManage}
            />
            <NumberInput
              name="uploadRateLimitMaxRequests"
              label="Requests/window"
              defaultValue={policy.uploadRateLimitMaxRequests}
              disabled={!canManage}
            />
            <NumberInput
              name="uploadRateLimitMaxMb"
              label="Traffic/window (MB)"
              defaultValue={mb(policy.uploadRateLimitMaxBytes)}
              disabled={!canManage}
            />
            <NumberInput
              name="deleteRetryMaxAttempts"
              label="Delete retry attempts"
              defaultValue={policy.deleteRetryMaxAttempts}
              disabled={!canManage}
            />
            <NumberInput
              name="deleteRetryBaseMinutes"
              label="Delete retry base (minutes)"
              defaultValue={policy.deleteRetryBaseMinutes}
              disabled={!canManage}
            />
          </Section>
          <Section title="Storage & audit">
            <label className="text-sm font-medium text-slate-700">
              Storage provider
              <select
                name="storageProviderId"
                defaultValue={policy.storageProviderId ?? ""}
                disabled={!canManage}
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
              >
                <option value="">Default provider</option>
                {settings.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name} · {provider.type}
                    {provider.applicationId ? " · APP" : " · GLOBAL"}
                  </option>
                ))}
              </select>
            </label>
            <Toggle
              name="auditDownloadEnabled"
              label="Audit downloads"
              defaultChecked={policy.auditDownloadEnabled}
              disabled={!canManage}
            />
            <Toggle
              name="auditPreviewEnabled"
              label="Audit previews"
              defaultChecked={policy.auditPreviewEnabled}
              disabled={!canManage}
            />
          </Section>
          {canManage ? (
            <button
              disabled={busy}
              className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
            >
              Save policy
            </button>
          ) : null}
        </form>
      ) : null}

      {settings && tab === "types" ? (
        <form
          onSubmit={saveFileTypes}
          className="rounded-3xl bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-slate-950">
            Dynamic File Type Policy
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Application save membuat override untuk extension yang ditampilkan
            sehingga policy tetap eksplisit dan auditable.
          </p>
          <div className="mt-6 space-y-6">
            {groupedFileTypes.map(([category, items]) => (
              <div key={category}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {category}
                </h3>
                <div className="mt-2 overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Extension</th>
                        <th className="px-4 py-3">MIME</th>
                        <th className="px-4 py-3">Max MB</th>
                        <th className="px-4 py-3">Allow</th>
                        <th className="px-4 py-3">Preview</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr
                          key={item.extension}
                          className="border-t border-slate-100"
                        >
                          <td className="px-4 py-3 font-mono">
                            .{item.extension}
                          </td>
                          <td className="max-w-sm px-4 py-3 text-xs text-slate-500">
                            {item.mimeTypes.join(", ") || "—"}
                          </td>
                          <td className="px-4 py-3">
                            <input
                              name={`max:${item.extension}`}
                              type="number"
                              min="0"
                              step="0.1"
                              defaultValue={mb(item.maxSizeBytes)}
                              disabled={!canManage}
                              className="w-24 rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              name={`allow:${item.extension}`}
                              type="checkbox"
                              defaultChecked={item.isAllowed}
                              disabled={!canManage}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              name={`preview:${item.extension}`}
                              type="checkbox"
                              defaultChecked={item.previewable}
                              disabled={!canManage}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
          {canManage ? (
            <button
              disabled={busy}
              className="mt-6 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
            >
              Save file types
            </button>
          ) : null}
        </form>
      ) : null}

      {settings && tab === "storage" ? (
        <div className="space-y-6">
          <div className="rounded-3xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">
              Storage Providers
            </h2>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {providers.map((provider) => (
                <div
                  key={provider.id}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-slate-900">
                        {provider.name}
                      </p>
                      <p className="mt-1 font-mono text-xs text-slate-500">
                        {provider.key}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${provider.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                    >
                      {provider.type}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {provider.applicationId ? "Application scoped" : "Global"}
                    {provider.isDefault ? " · DEFAULT" : ""} · Health:{" "}
                    {provider.lastHealthStatus ?? "not tested"}
                  </p>
                  {provider.lastHealthError ? (
                    <p className="mt-2 text-xs text-rose-600">
                      {provider.lastHealthError}
                    </p>
                  ) : null}
                  {isRoot ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void testProvider(provider.id)}
                        disabled={busy}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium"
                      >
                        Test connection
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingProvider(provider)}
                        disabled={busy}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleProvider(provider)}
                        disabled={busy}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium"
                      >
                        {provider.isActive ? "Disable" : "Enable"}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {isRoot && editingProvider ? (
            <form
              key={`edit:${editingProvider.id}`}
              onSubmit={updateProvider}
              className="rounded-3xl bg-white p-6 shadow-sm"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">
                    Edit Storage Provider
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Namespace changes dapat ditolak backend jika attachment
                    aktif masih menggunakan provider ini.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingProvider(null)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium"
                >
                  Cancel
                </button>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <TextInput
                  name="name"
                  label="Name"
                  defaultValue={editingProvider.name}
                  required
                />
                <TextInput
                  name="key"
                  label="Key"
                  defaultValue={editingProvider.key}
                  required
                />
                <TextInput
                  name="path"
                  label="Local path"
                  defaultValue={String(editingProvider.config.basePath ?? "")}
                />
                <TextInput
                  name="endpoint"
                  label="S3/MinIO endpoint"
                  defaultValue={String(editingProvider.config.endpoint ?? "")}
                />
                <TextInput
                  name="bucket"
                  label="Bucket"
                  defaultValue={String(editingProvider.config.bucket ?? "")}
                />
                <TextInput
                  name="region"
                  label="Region"
                  defaultValue={String(
                    editingProvider.config.region ?? "us-east-1",
                  )}
                />
                <TextInput
                  name="prefix"
                  label="Object prefix"
                  defaultValue={String(
                    editingProvider.config.prefix ?? "attachments",
                  )}
                />
                <label className="text-sm font-medium text-slate-700">
                  Credential mode
                  <select
                    name="credentialMode"
                    defaultValue={String(
                      editingProvider.config.credentialMode ??
                        (editingProvider.type === "MINIO"
                          ? "STATIC"
                          : "DEFAULT_CHAIN"),
                    )}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
                  >
                    <option value="DEFAULT_CHAIN">DEFAULT_CHAIN</option>
                    <option value="STATIC">STATIC</option>
                  </select>
                </label>
                <TextInput
                  name="accessKeyId"
                  label="New access key (optional)"
                />
                <TextInput
                  name="secretAccessKey"
                  label="New secret key (optional)"
                  type="password"
                />
                <NumberInput
                  name="signedUrlTtlSeconds"
                  label="Signed URL TTL (seconds)"
                  defaultValue={Number(
                    editingProvider.config.signedUrlTtlSeconds ?? 60,
                  )}
                />
              </div>
              <div className="mt-5 flex flex-wrap gap-5">
                <Toggle
                  name="forcePathStyle"
                  label="Force path style"
                  defaultChecked={Boolean(
                    editingProvider.config.forcePathStyle,
                  )}
                />
                <Toggle
                  name="signedUrlEnabled"
                  label="Signed URL"
                  defaultChecked={
                    editingProvider.config.signedUrlEnabled !== false
                  }
                />
                <Toggle
                  name="isDefault"
                  label="Default provider"
                  defaultChecked={editingProvider.isDefault}
                />
              </div>
              <button
                disabled={busy}
                className="mt-6 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                Save provider
              </button>
            </form>
          ) : null}

          {isRoot ? (
            <form
              onSubmit={createProvider}
              className="rounded-3xl bg-white p-6 shadow-sm"
            >
              <h2 className="text-lg font-semibold text-slate-950">
                Add Storage Provider
              </h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <TextInput
                  name="name"
                  label="Name"
                  placeholder="Corporate MinIO"
                  required
                />
                <TextInput
                  name="key"
                  label="Key"
                  placeholder={
                    applicationId
                      ? `APP:${applicationId}:storage`
                      : "GLOBAL:s3-primary"
                  }
                  required
                />
                <label className="text-sm font-medium text-slate-700">
                  Type
                  <select
                    name="type"
                    defaultValue="LOCAL"
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
                  >
                    <option>LOCAL</option>
                    <option>S3</option>
                    <option>MINIO</option>
                  </select>
                </label>
                <TextInput
                  name="path"
                  label="Local path"
                  placeholder="storage/attachments"
                />
                <TextInput
                  name="endpoint"
                  label="S3/MinIO endpoint"
                  placeholder="https://minio.internal"
                />
                <TextInput
                  name="bucket"
                  label="Bucket"
                  placeholder="teamchat"
                />
                <TextInput
                  name="region"
                  label="Region"
                  placeholder="ap-southeast-1"
                  defaultValue="us-east-1"
                />
                <TextInput
                  name="prefix"
                  label="Object prefix"
                  placeholder="attachments"
                  defaultValue="attachments"
                />
                <label className="text-sm font-medium text-slate-700">
                  Credential mode
                  <select
                    name="credentialMode"
                    defaultValue="DEFAULT_CHAIN"
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
                  >
                    <option value="DEFAULT_CHAIN">DEFAULT_CHAIN</option>
                    <option value="STATIC">STATIC</option>
                  </select>
                </label>
                <TextInput name="accessKeyId" label="Access key (STATIC)" />
                <TextInput
                  name="secretAccessKey"
                  label="Secret key (STATIC)"
                  type="password"
                />
                <NumberInput
                  name="signedUrlTtlSeconds"
                  label="Signed URL TTL (seconds)"
                  defaultValue={60}
                />
              </div>
              <div className="mt-5 flex flex-wrap gap-5">
                <Toggle name="forcePathStyle" label="Force path style" />
                <Toggle
                  name="signedUrlEnabled"
                  label="Signed URL"
                  defaultChecked
                />
                <Toggle name="isDefault" label="Default provider" />
              </div>
              <button
                disabled={busy}
                className="mt-6 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                Create provider
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-slate-900">{title}</legend>
      <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {children}
      </div>
    </fieldset>
  );
}
function Toggle({
  name,
  label,
  defaultChecked = false,
  disabled = false,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="h-4 w-4"
      />
      {label}
    </label>
  );
}
function NumberInput({
  name,
  label,
  defaultValue,
  disabled = false,
}: {
  name: string;
  label: string;
  defaultValue?: string | number;
  disabled?: boolean;
}) {
  return (
    <label className="text-sm font-medium text-slate-700">
      {label}
      <input
        type="number"
        min="0"
        step="any"
        name={name}
        defaultValue={defaultValue}
        disabled={disabled}
        className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
      />
    </label>
  );
}
function TextInput({
  name,
  label,
  placeholder,
  defaultValue,
  required = false,
  type = "text",
}: {
  name: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="text-sm font-medium text-slate-700">
      {label}
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
      />
    </label>
  );
}

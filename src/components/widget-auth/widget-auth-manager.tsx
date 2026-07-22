"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiUrl } from "@/lib/api/api-url";

type Credential = {
  id: string;
  keyId: string;
  name: string;
  isActive: boolean;
  expiresAt: Date | string | null;
  lastUsedAt: Date | string | null;
  createdAt: Date | string;
};

type Integration = {
  id: string;
  name: string;
  type: "DATABASE" | "API";
  status: string;
  isDefaultUserSource: boolean;
  readiness: {
    canActivate: boolean;
    mappingComplete: boolean;
    previewCurrent: boolean;
    missingTargets: string[];
  };
};

type ApplicationItem = {
  id: string;
  key: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  allowedOrigins: string[];
  credentials: Credential[];
  integrations: Integration[];
};

type CreatedCredential = {
  credential: Credential;
  secret: string;
  signing: {
    algorithm: "HS256";
    issuer: string;
    audience: string;
    applicationKey: string;
  };
};

type ApiResult<T = unknown> = {
  success?: boolean;
  data?: T;
  error?: { message?: string };
};

function formatDate(value: Date | string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function WidgetAuthManager({
  applications,
  canManage,
}: {
  applications: ApplicationItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(applications[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [oneTimeCredential, setOneTimeCredential] =
    useState<CreatedCredential | null>(null);
  const application =
    applications.find((item) => item.id === selectedId) ?? applications[0];
  const defaultIntegration = useMemo(() => {
    if (!application) return null;
    return (
      application.integrations.find((item) => item.isDefaultUserSource) ??
      (application.integrations.length === 1
        ? application.integrations[0]
        : null)
    );
  }, [application]);

  async function parseResponse<T>(response: Response): Promise<ApiResult<T>> {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  async function createCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!application) return;
    setBusy(true);
    setOneTimeCredential(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const expiresAtRaw = String(form.get("expiresAt") ?? "").trim();
    const response = await fetch(
      apiUrl(`/api/applications/${application.id}/credentials`),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          expiresAt: expiresAtRaw ? new Date(expiresAtRaw).toISOString() : null,
        }),
      },
    );
    const result = await parseResponse<
      CreatedCredential & { warning?: string }
    >(response);
    setBusy(false);
    if (!response.ok || !result.data) {
      toast.error(result.error?.message ?? "Gagal membuat signing credential");
      return;
    }
    setOneTimeCredential(result.data);
    toast.success(
      "Signing credential berhasil dibuat. Simpan secret sekarang; nilainya tidak dapat ditampilkan lagi.",
    );
    formElement.reset();
    router.refresh();
  }

  async function revokeCredential(credential: Credential) {
    if (
      !application ||
      !window.confirm(
        `Revoke credential ${credential.name}? Token baru dengan key ini akan ditolak.`,
      )
    )
      return;
    setBusy(true);
    const response = await fetch(
      apiUrl(
        `/api/applications/${application.id}/credentials/${credential.id}`,
      ),
      { method: "DELETE" },
    );
    const result = await parseResponse(response);
    setBusy(false);
    toast.success(
      response.ok
        ? "Credential berhasil direvoke."
        : (result.error?.message ?? "Gagal revoke credential"),
    );
    if (response.ok) router.refresh();
  }

  async function copy(value: string) {
    const text = value ?? "";

    try {
      // Gunakan Clipboard API jika tersedia dan halaman berada di secure context
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        window.isSecureContext
      ) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback untuk HTTP atau browser yang tidak mendukung Clipboard API
        const textarea = document.createElement("textarea");

        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";

        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();

        const copied = document.execCommand("copy");
        textarea.remove();

        if (!copied) {
          throw new Error("COPY_NOT_SUPPORTED");
        }
      }

      toast.success("Berhasil disalin ke clipboard.");
    } catch (error) {
      console.error("Gagal menyalin ke clipboard:", error);
      toast.error("Gagal menyalin ke clipboard.");
    }
  }

  if (!applications.length) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-600">
        Buat application terlebih dahulu.
      </div>
    );
  }

  const originApp =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://chat.example.com";
  const originRealtime =
    process.env.NEXT_PUBLIC_REALTIME_URL ?? "https://chat.example.com";

  const scriptSnippet = application
    ? `<script\n  src="${originApp}/chat-widget.js"\n  data-chat-base-url="${originApp}"\n  data-realtime-url="${originRealtime}"\n  data-application-key="${application.key}"\n  data-bootstrap-token="{{SIGNED_BOOTSTRAP_TOKEN}}">\n</script>`
    : "";

  const hostSignerSnippet = application
    ? `const token = await new SignJWT({ app: "${application.key}" })\n  .setProtectedHeader({ alg: "HS256", typ: "JWT", kid: process.env.CHAT_SIGNING_KEY_ID })\n  .setSubject(currentUser.id)\n  .setIssuer("${application.key}")\n  .setAudience("chat-widget-bootstrap")\n  .setIssuedAt()\n  .setExpirationTime("2m")\n  .sign(new TextEncoder().encode(process.env.CHAT_SIGNING_SECRET));`
    : "";

  return (
    <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
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
                setOneTimeCredential(null);
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
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Authentication readiness
                </p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950">
                  {application.name}
                </h2>
                <p className="mt-1 font-mono text-xs text-slate-500">
                  {application.key}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${application.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
              >
                {application.status}
              </span>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  Allowed Origins
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">
                  {application.allowedOrigins.length}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  Active Credentials
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">
                  {
                    application.credentials.filter((item) => item.isActive)
                      .length
                  }
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  User Integration
                </p>
                <p
                  className={`mt-2 text-sm font-semibold ${defaultIntegration?.status === "ACTIVE" && defaultIntegration.readiness.canActivate ? "text-emerald-700" : "text-amber-700"}`}
                >
                  {defaultIntegration?.status === "ACTIVE" &&
                  defaultIntegration.readiness.canActivate
                    ? "READY"
                    : "NOT READY"}
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
              <p className="font-medium text-slate-900">Default user source</p>
              {defaultIntegration ? (
                <p className="mt-1">
                  {defaultIntegration.name} · {defaultIntegration.type} ·{" "}
                  {defaultIntegration.status} ·{" "}
                  {defaultIntegration.readiness.canActivate
                    ? "mapping ready"
                    : "mapping preview required"}
                </p>
              ) : (
                <p className="mt-1 text-amber-700">
                  Belum ada default user integration yang dapat dipilih secara
                  deterministik.
                </p>
              )}
            </div>
          </div>

          {canManage ? (
            <form
              onSubmit={createCredential}
              className="rounded-3xl bg-white p-6 shadow-sm"
            >
              <h3 className="text-lg font-semibold text-slate-950">
                Create Signing Credential
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Secret hanya ditampilkan satu kali dan harus disimpan di server
                aplikasi utama.
              </p>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <input
                  name="name"
                  required
                  placeholder="CRM Production Widget"
                  className="rounded-xl border border-slate-300 px-4 py-3"
                />
                <label className="text-sm font-medium text-slate-700">
                  Optional Expiry
                  <input
                    name="expiresAt"
                    type="datetime-local"
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
                  />
                </label>
              </div>
              <button
                disabled={busy || application.status !== "ACTIVE"}
                className="mt-5 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                Generate Credential
              </button>
            </form>
          ) : null}

          {oneTimeCredential ? (
            <div className="rounded-3xl border border-amber-300 bg-amber-50 p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                One-time secret
              </p>
              <h3 className="mt-1 text-lg font-semibold text-amber-950">
                Simpan credential ini sekarang
              </h3>
              <div className="mt-4 space-y-3 font-mono text-sm">
                <div className="rounded-xl bg-white p-4">
                  <span className="text-slate-500">Key ID</span>
                  <div className="mt-1 break-all">
                    {oneTimeCredential.credential.keyId}
                  </div>
                </div>
                <div className="rounded-xl bg-white p-4">
                  <span className="text-slate-500">Signing Secret</span>
                  <div className="mt-1 break-all">
                    {oneTimeCredential.secret}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => copy(oneTimeCredential.credential.keyId)}
                  className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-900"
                >
                  Copy Key ID
                </button>
                <button
                  type="button"
                  onClick={() => copy(oneTimeCredential.secret)}
                  className="rounded-xl bg-amber-900 px-4 py-2 text-sm font-medium text-white"
                >
                  Copy Secret
                </button>
              </div>
            </div>
          ) : null}

          <div className="rounded-3xl bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-950">
              Signing Credentials
            </h3>
            <div className="mt-5 space-y-3">
              {application.credentials.map((credential) => (
                <div
                  key={credential.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 p-4"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-900">
                        {credential.name}
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${credential.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                      >
                        {credential.isActive ? "ACTIVE" : "REVOKED"}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-slate-500">
                      {credential.keyId}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Expires: {formatDate(credential.expiresAt)} · Last used:{" "}
                      {formatDate(credential.lastUsedAt)}
                    </p>
                  </div>
                  {canManage && credential.isActive ? (
                    <button
                      type="button"
                      onClick={() => revokeCredential(credential)}
                      disabled={busy}
                      className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  ) : null}
                </div>
              ))}
              {!application.credentials.length ? (
                <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                  Belum ada signing credential.
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-950">
              Host Server Token
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Token wajib dibuat server-side. Jangan pernah menaruh signing
              secret di browser.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-2xl bg-slate-950 p-5 text-xs leading-6 text-slate-100">
              <code>{hostSignerSnippet}</code>
            </pre>
            <button
              type="button"
              onClick={() => copy(hostSignerSnippet)}
              className="mt-3 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium"
            >
              Copy Example
            </button>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-950">
              Final Floating Widget Embed
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Pada render halaman host, gantikan placeholder dengan signed
              bootstrap token milik user yang sedang login. Satu script ini
              memuat authentication, realtime, private/group chat, notification,
              dan UI Shadow DOM.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-2xl bg-slate-950 p-5 text-xs leading-6 text-slate-100">
              <code>{scriptSnippet}</code>
            </pre>
            <button
              type="button"
              onClick={() => copy(scriptSnippet)}
              className="mt-3 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium"
            >
              Copy Embed
            </button>
            <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
              Widget menyimpan chat session di <code>sessionStorage</code>{" "}
              secara default, memvalidasi ulang sesi melalui{" "}
              <code>/api/widget/auth/me</code>, menjaga koneksi realtime ketika
              panel ditutup, dan mengisolasi seluruh CSS menggunakan{" "}
              <code>Shadow DOM</code>.
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

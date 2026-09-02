"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiUrl } from "@/lib/api/api-url";

type ApplicationOption = { key: string; name: string };

export function LoginForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applications, setApplications] = useState<ApplicationOption[]>([]);
  const [credentials, setCredentials] = useState<{
    username: string;
    password: string;
  } | null>(null);

  async function login(
    username: string,
    password: string,
    applicationKey?: string,
  ) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(apiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password, applicationKey }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (
          result?.error?.code === "APPLICATION_REQUIRED" &&
          Array.isArray(result?.error?.details?.applications)
        ) {
          setCredentials({ username, password });
          setApplications(result.error.details.applications);
          setError(
            "Akun memiliki akses ke beberapa application. Pilih application untuk melanjutkan.",
          );
          return;
        }
        setError(result?.error?.message ?? "Login gagal");
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await login(
      String(form.get("username") ?? ""),
      String(form.get("password") ?? ""),
    );
  }

  if (applications.length && credentials) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-amber-700">{error}</p>
        {applications.map((application) => (
          <button
            key={application.key}
            type="button"
            disabled={loading}
            onClick={() =>
              login(credentials.username, credentials.password, application.key)
            }
            className="w-full rounded-xl border border-slate-300 p-4 text-left transition hover:border-slate-950 disabled:opacity-50"
          >
            <span className="block font-medium text-slate-950">
              {application.name}
            </span>
            <span className="text-xs text-slate-500">{application.key}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setApplications([]);
            setCredentials(null);
            setError(null);
          }}
          className="text-sm font-medium text-slate-600"
        >
          Kembali ke login
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label
          htmlFor="username"
          className="mb-2 block text-sm font-medium text-slate-700"
        >
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          required
          className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-slate-900"
        />
      </div>
      <div>
        <label
          htmlFor="password"
          className="mb-2 block text-sm font-medium text-slate-700"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-slate-900"
        />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-slate-950 px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Memproses..." : "Login"}
      </button>
    </form>
  );
}

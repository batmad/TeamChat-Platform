"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiUrl } from "@/lib/api/api-url";

type ApplicationOption = { key: string; name: string };

export function ApplicationSwitcher({
  applications,
  currentKey,
}: {
  applications: ApplicationOption[];
  currentKey: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (applications.length <= 1) return null;

  return (
    <label className="mt-4 block text-xs text-slate-400">
      Application context
      <select
        value={currentKey ?? ""}
        disabled={loading}
        onChange={async (event) => {
          setLoading(true);
          const response = await fetch(apiUrl("/api/auth/switch-application"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ applicationKey: event.target.value }),
          });
          setLoading(false);
          if (response.ok) {
            router.replace("/dashboard");
            router.refresh();
          }
        }}
        className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
      >
        {applications.map((application) => (
          <option key={application.key} value={application.key}>
            {application.name}
          </option>
        ))}
      </select>
    </label>
  );
}

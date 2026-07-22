import "server-only";
import { AppError } from "@/lib/api/app-error";
import { apiConfigSchema, apiSecretSchema } from "@/lib/integrations/schemas";
import { getValueAtPath } from "@/lib/integrations/path";
import type { ApiIntegrationConfig, ApiIntegrationSecret } from "@/lib/integrations/types";

function joinUrl(baseUrl: string, path: string): URL {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

function authHeaders(config: ApiIntegrationConfig, secret: ApiIntegrationSecret): Record<string, string> {
  if (config.authType === "NONE") return {};
  if (config.authType === "BEARER") {
    if (!secret.bearerToken) throw new AppError(400, "API_SECRET_MISSING", "Bearer token is not configured");
    return { authorization: `Bearer ${secret.bearerToken}` };
  }
  if (config.authType === "API_KEY") {
    if (!secret.apiKey) throw new AppError(400, "API_SECRET_MISSING", "API key is not configured");
    return { [config.apiKeyHeader || "x-api-key"]: secret.apiKey };
  }
  if (!config.basicUsername || !secret.basicPassword) {
    throw new AppError(400, "API_SECRET_MISSING", "Basic authentication credential is incomplete");
  }
  return {
    authorization: `Basic ${Buffer.from(`${config.basicUsername}:${secret.basicPassword}`).toString("base64")}`,
  };
}

async function fetchWithTimeout(url: URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

async function parseApiResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new AppError(
      502,
      "EXTERNAL_API_ERROR",
      `External API returned HTTP ${response.status}`,
      { status: response.status, payload: typeof payload === "string" ? payload.slice(0, 500) : undefined },
    );
  }
  return payload;
}

export async function testApiConnection(rawConfig: unknown, rawSecret: unknown, timeoutMs: number): Promise<void> {
  const config = apiConfigSchema.parse(rawConfig);
  const secret = apiSecretSchema.parse(rawSecret ?? {});
  const url = joinUrl(config.baseUrl, config.testPath || "");
  const response = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: { accept: "application/json", ...config.staticHeaders, ...authHeaders(config, secret) },
    },
    timeoutMs,
  );
  await parseApiResponse(response);
}

export async function fetchApiUser(
  rawConfig: unknown,
  rawSecret: unknown,
  timeoutMs: number,
  lookupValue: string,
): Promise<Record<string, unknown> | null> {
  const config = apiConfigSchema.parse(rawConfig);
  const secret = apiSecretSchema.parse(rawSecret ?? {});
  const url = joinUrl(config.baseUrl, config.userPath);
  const headers: Record<string, string> = {
    accept: "application/json",
    ...config.staticHeaders,
    ...authHeaders(config, secret),
  };
  let body: string | undefined;

  if (config.lookupMethod === "GET") {
    url.searchParams.set(config.lookupParam, lookupValue);
  } else {
    headers["content-type"] = "application/json";
    body = JSON.stringify({ [config.lookupParam]: lookupValue });
  }

  const response = await fetchWithTimeout(url, { method: config.lookupMethod, headers, body }, timeoutMs);
  const payload = await parseApiResponse(response);
  const extracted = getValueAtPath(payload, config.responseRoot);

  if (extracted === null || extracted === undefined) return null;
  if (Array.isArray(extracted)) {
    const first = extracted[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
  }
  if (typeof extracted !== "object") {
    throw new AppError(422, "API_RESPONSE_NOT_OBJECT", "Configured API response root does not resolve to an object");
  }
  return extracted as Record<string, unknown>;
}

import { randomBytes } from "node:crypto";

export function generateApplicationKey() {
  return `app_${randomBytes(18).toString("base64url")}`;
}

export function normalizeApplicationKey(value: string) {
  return value.trim().toLowerCase();
}

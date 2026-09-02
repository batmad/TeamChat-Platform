export function normalizeGroupCode(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "_");
  if (!normalized) throw new Error("Group code is required");
  if (!/^[A-Z0-9][A-Z0-9._-]{0,99}$/.test(normalized)) {
    throw new Error("Group code may only contain letters, numbers, dot, underscore, and hyphen");
  }
  return normalized;
}

export function normalizeExternalGroupKey(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("External group key is required");
  if (normalized.length > 150) throw new Error("External group key is too long");
  return normalized;
}

export function canDeleteInternalGroup(usage: {
  members: number;
  rooms: number;
  forbiddenWords: number;
  reportScopeGroups: number;
  messageContexts: number;
}): boolean {
  return Object.values(usage).every((count) => count === 0);
}

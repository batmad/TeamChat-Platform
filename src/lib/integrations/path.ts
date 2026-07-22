export function getValueAtPath(value: unknown, path: string | null | undefined): unknown {
  if (!path) return value;
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(segment)) return current[Number(segment)];
    if (typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

export function flattenObjectPaths(value: unknown, prefix = "", depth = 0): string[] {
  if (depth > 6 || value === null || value === undefined) return prefix ? [prefix] : [];
  if (Array.isArray(value)) {
    if (!value.length) return prefix ? [prefix] : [];
    return flattenObjectPaths(value[0], prefix ? `${prefix}.0` : "0", depth + 1);
  }
  if (typeof value !== "object") return prefix ? [prefix] : [];

  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return prefix ? [prefix] : [];
  return entries.flatMap(([key, child]) => flattenObjectPaths(child, prefix ? `${prefix}.${key}` : key, depth + 1));
}

export function toMappedString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return null;
}

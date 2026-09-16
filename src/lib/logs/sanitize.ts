const SENSITIVE_KEY = /(password|passphrase|secret|token|authorization|cookie|credential|api[_-]?key|private[_-]?key)/i;
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 4000;
const MAX_SERIALIZED_LENGTH = 64000;

function truncateString(value: string) {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]`;
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return truncateString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message),
    };
  }
  if (depth >= MAX_DEPTH) return "[MAX_DEPTH]";
  if (typeof value !== "object") return String(value);

  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key)
      ? "[REDACTED]"
      : sanitizeValue(entry, depth + 1, seen);
  }
  return output;
}

export function sanitizeLogData(value: unknown): unknown {
  const sanitized = sanitizeValue(value, 0, new WeakSet<object>());
  try {
    const serialized = JSON.stringify(sanitized);
    if (serialized.length <= MAX_SERIALIZED_LENGTH) return sanitized;
    return {
      truncated: true,
      originalSize: serialized.length,
      preview: serialized.slice(0, MAX_SERIALIZED_LENGTH),
    };
  } catch {
    return { serializationFailed: true };
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object");

export const sanitizeToJson = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "function" || typeof value === "symbol") {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeToJson(item, seen));
  }
  if (isRecord(value)) {
    if (seen.has(value)) {
      return null;
    }
    seen.add(value);
    const sanitized: Record<string, unknown> = {};
    Object.entries(value).forEach(([key, entry]) => {
      const cleaned = sanitizeToJson(entry, seen);
      sanitized[key] = cleaned === undefined ? null : cleaned;
    });
    return sanitized;
  }
  return null;
};

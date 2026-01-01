import { Prisma } from "@prisma/client";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object");

export const sanitizeToJson = (
  value: unknown,
  seen = new WeakSet<object>(),
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return Prisma.DbNull;
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
    return Prisma.DbNull;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeToJson(item, seen) ?? Prisma.DbNull);
  }
  if (isRecord(value)) {
    if (seen.has(value)) {
      return Prisma.DbNull;
    }
    seen.add(value);
    const sanitized: Record<string, Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput> =
      {};
    Object.entries(value).forEach(([key, entry]) => {
      const cleaned = sanitizeToJson(entry, seen);
      sanitized[key] = cleaned ?? Prisma.DbNull;
    });
    return sanitized;
  }
  return Prisma.DbNull;
};

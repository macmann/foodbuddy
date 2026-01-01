import { Prisma } from "@prisma/client";

type JsonOut = Prisma.InputJsonValue;
type JsonFieldOut = JsonOut | Prisma.NullableJsonNullValueInput | undefined;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object");

const toEmbeddedJson = (value: JsonFieldOut): JsonOut | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === Prisma.DbNull || value === Prisma.JsonNull) {
    return null;
  }
  return value;
};

export const sanitizeToJson = (
  value: unknown,
  seen = new WeakSet<object>(),
): JsonFieldOut => {
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
    if (seen.has(value)) {
      return Prisma.DbNull;
    }
    seen.add(value);
    const sanitized = value.map((item) => {
      const cleaned = toEmbeddedJson(sanitizeToJson(item, seen));
      return cleaned ?? null;
    });
    return sanitized;
  }
  if (isRecord(value)) {
    if (seen.has(value)) {
      return Prisma.DbNull;
    }
    seen.add(value);
    const sanitized: Record<string, JsonOut> = {};
    Object.entries(value).forEach(([key, entry]) => {
      const cleaned = toEmbeddedJson(sanitizeToJson(entry, seen));
      if (cleaned !== undefined) {
        sanitized[key] = cleaned;
      }
    });
    return sanitized;
  }
  return Prisma.DbNull;
};

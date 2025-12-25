import { createHmac } from "crypto";

export function hashUserId(input: string): string {
  const salt = process.env.ANON_ID_SALT;
  if (!salt) {
    throw new Error("ANON_ID_SALT is required to hash user IDs");
  }

  return createHmac("sha256", salt).update(input).digest("hex");
}

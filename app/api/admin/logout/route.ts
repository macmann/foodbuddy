import { NextResponse } from "next/server";
import { clearAdminCookie } from "../../../../lib/admin/auth";

export const POST = async () => {
  const response = NextResponse.json({ ok: true });
  clearAdminCookie(response);
  return response;
};

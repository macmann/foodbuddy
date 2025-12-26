import { NextResponse } from "next/server";
import { signAdminToken, setAdminCookie } from "../../../../lib/admin/auth";

export const POST = async (request: Request) => {
  let payload: { passcode?: string } = {};

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const expectedPasscode = process.env.ADMIN_PASSCODE;
  if (!expectedPasscode || payload.passcode !== expectedPasscode) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const token = await signAdminToken();
  const response = NextResponse.json({ ok: true });
  setAdminCookie(response, token);
  return response;
};

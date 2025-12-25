import { NextResponse } from "next/server";

export async function GET() {
  const version = process.env.APP_VERSION ?? process.env.npm_package_version ?? "unknown";
  return NextResponse.json({
    ok: true,
    version,
    time: new Date().toISOString(),
  });
}

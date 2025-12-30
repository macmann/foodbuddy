export const runtime = "nodejs";

export function GET() {
  console.log("[healthz]", new Date().toISOString());
  return Response.json({ ok: true, ts: Date.now() }, { status: 200 });
}

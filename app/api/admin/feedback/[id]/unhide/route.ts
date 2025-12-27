import { NextResponse } from "next/server";
import { unhideFeedback } from "../../../../../../lib/admin/data";

export const POST = async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  await unhideFeedback(id);
  return NextResponse.json({ ok: true });
};

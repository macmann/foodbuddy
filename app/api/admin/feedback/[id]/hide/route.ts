import { NextResponse } from "next/server";
import { hideFeedback } from "../../../../../../lib/admin/data";

export const POST = async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  await hideFeedback(id);
  return NextResponse.json({ ok: true });
};

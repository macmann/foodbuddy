import { NextResponse } from "next/server";
import { unhideFeedback } from "../../../../../../lib/admin/data";

export const POST = async (
  _request: Request,
  { params }: { params: { id: string } },
) => {
  await unhideFeedback(params.id);
  return NextResponse.json({ ok: true });
};

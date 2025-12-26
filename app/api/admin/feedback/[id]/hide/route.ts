import { NextResponse } from "next/server";
import { hideFeedback } from "../../../../../../lib/admin/data";

export const POST = async (
  _request: Request,
  { params }: { params: { id: string } },
) => {
  await hideFeedback(params.id);
  return NextResponse.json({ ok: true });
};

import { NextResponse } from "next/server";
import { getSystemHealth } from "../../../../lib/admin/health";

export const GET = async () => {
  const health = await getSystemHealth();
  return NextResponse.json(health);
};

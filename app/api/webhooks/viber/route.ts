import { NextResponse } from "next/server";

const ENABLE_VIBER = process.env.ENABLE_VIBER === "true";

export async function POST() {
  if (!ENABLE_VIBER) {
    return NextResponse.json(
      {
        error: "Viber webhook disabled",
        instruction: "Set ENABLE_VIBER=true and configure VIBER_AUTH_TOKEN.",
      },
      { status: 501 },
    );
  }

  return NextResponse.json(
    {
      error: "Viber webhook not implemented",
      instruction: "Implement Viber parsing + sendMessage adapter.",
    },
    { status: 501 },
  );
}

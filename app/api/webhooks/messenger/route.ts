import { NextResponse } from "next/server";

const ENABLE_MESSENGER = process.env.ENABLE_MESSENGER === "true";

export async function POST() {
  if (!ENABLE_MESSENGER) {
    return NextResponse.json(
      {
        error: "Messenger webhook disabled",
        instruction: "Set ENABLE_MESSENGER=true and configure MESSENGER_* env vars.",
      },
      { status: 501 },
    );
  }

  return NextResponse.json(
    {
      error: "Messenger webhook not implemented",
      instruction: "Implement Messenger parsing + sendMessage adapter.",
    },
    { status: 501 },
  );
}

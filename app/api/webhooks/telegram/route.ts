import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { hashUserId } from "../../../../lib/hash";
import { parseQuery, recommend, writeRecommendationEvent } from "../../../../lib/reco/engine";
import { commentContainsUrl, recordPlaceFeedback } from "../../../../lib/feedback";
import { logger } from "../../../../lib/logger";
import { createRequestContext } from "../../../../lib/request";

type TelegramUpdate = {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type TelegramMessage = {
  message_id: number;
  chat: { id: number };
  text?: string;
  location?: { latitude: number; longitude: number };
};

type TelegramCallbackQuery = {
  id: string;
  data?: string;
  message?: { chat: { id: number } };
};

const ENABLE_TELEGRAM = process.env.ENABLE_TELEGRAM === "true";

const globalForTelegram = globalThis as typeof globalThis & {
  telegramRecommendations?: Map<string, string[]>;
};

const recommendationCache =
  globalForTelegram.telegramRecommendations ?? new Map<string, string[]>();

if (!globalForTelegram.telegramRecommendations) {
  globalForTelegram.telegramRecommendations = recommendationCache;
}

const getMapsUrl = (name: string, mapsUrl?: string) => {
  if (mapsUrl) {
    return mapsUrl;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;
};

const sendTelegramMessage = async (
  chatId: number,
  text: string,
  replyMarkup?: Record<string, unknown>,
) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return;
  }
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: replyMarkup,
      disable_web_page_preview: true,
    }),
  });
};

const answerCallbackQuery = async (callbackQueryId: string) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return;
  }
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
};

const updateChatLocation = async (userIdHash: string, latitude: number, longitude: number) => {
  await prisma.chatState.upsert({
    where: { telegramChatIdHash: userIdHash },
    create: { telegramChatIdHash: userIdHash, lastLat: latitude, lastLng: longitude },
    update: { lastLat: latitude, lastLng: longitude },
  });
};

const getChatLocation = async (userIdHash: string) => {
  return prisma.chatState.findUnique({ where: { telegramChatIdHash: userIdHash } });
};

const parseRatingMessage = (text: string) => {
  const match = text.match(/^rate\s+(\\d+)\\s+([1-5])(?:\\s+(.+))?$/i);
  if (!match) {
    return null;
  }
  const placeNumber = Number(match[1]);
  const rating = Number(match[2]);
  const commentText = match[3]?.trim();
  if (!Number.isFinite(placeNumber) || placeNumber <= 0) {
    return null;
  }
  return { placeNumber, rating, commentText };
};

export async function POST(request: Request) {
  const { requestId, startTime } = createRequestContext(request);
  const channel = "TELEGRAM";
  const logContext = { requestId, channel };
  const respond = (status: number, payload: Record<string, unknown>) => {
    const response = NextResponse.json(payload, { status });
    response.headers.set("x-request-id", requestId);
    logger.info(
      { ...logContext, latencyMs: Date.now() - startTime },
      "telegram webhook complete",
    );
    return response;
  };

  if (!ENABLE_TELEGRAM) {
    return respond(404, { ok: false });
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const headerToken = request.headers.get("x-telegram-bot-api-secret-token");
    if (headerToken !== secret) {
      return respond(401, { ok: false });
    }
  }

  const update = (await request.json()) as TelegramUpdate;

  if (update.callback_query) {
    const chatId = update.callback_query.message?.chat.id;
    if (chatId) {
      const data = update.callback_query.data ?? "";
      const match = data.match(/^rate:(\\d+)$/);
      if (match) {
        const placeNumber = Number(match[1]);
        await sendTelegramMessage(
          chatId,
          `Reply: rate ${placeNumber} <1-5> optional comment`,
        );
      }
      await answerCallbackQuery(update.callback_query.id);
    }
    return respond(200, { ok: true });
  }

  const message = update.message;
  if (!message) {
    return respond(200, { ok: true });
  }

  const chatId = message.chat.id;
  const userIdHash = hashUserId(String(chatId));

  if (message.location) {
    await updateChatLocation(userIdHash, message.location.latitude, message.location.longitude);
    await sendTelegramMessage(chatId, "Location saved! What are you craving?");
    return NextResponse.json({ ok: true });
  }

  const text = message.text?.trim();
  if (!text) {
    return respond(200, { ok: true });
  }

  if (text.length > 500) {
    await sendTelegramMessage(chatId, "Message too long. Please keep it under 500 characters.");
    return respond(200, { ok: true });
  }

  const ratingMessage = parseRatingMessage(text);
  if (ratingMessage) {
    if (commentContainsUrl(ratingMessage.commentText)) {
      await sendTelegramMessage(chatId, "Links are not allowed in feedback comments.");
      return respond(200, { ok: true });
    }

    const recentRecommendations = recommendationCache.get(userIdHash) ?? [];
    const placeId = recentRecommendations[ratingMessage.placeNumber - 1];
    if (!placeId) {
      await sendTelegramMessage(chatId, "Couldn't find that place number. Try again.");
      return respond(200, { ok: true });
    }

    await recordPlaceFeedback({
      placeId,
      channel: "TELEGRAM",
      userIdHash,
      rating: ratingMessage.rating,
      commentText: ratingMessage.commentText,
    });

    await sendTelegramMessage(chatId, "Thanks for the rating!");
    return respond(200, { ok: true });
  }

  const locationState = await getChatLocation(userIdHash);
  if (!locationState) {
    await sendTelegramMessage(chatId, "Please share your location to get recommendations.");
    return respond(200, { ok: true });
  }

  const recommendationStart = Date.now();
  const parsedConstraints = parseQuery(text);
  let recommendation;

  try {
    recommendation = await recommend({
      channel: "TELEGRAM",
      userIdHash,
      location: { lat: locationState.lastLat, lng: locationState.lastLng },
      queryText: text,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await writeRecommendationEvent(
      {
        channel: "TELEGRAM",
        userIdHash,
        location: { lat: locationState.lastLat, lng: locationState.lastLng },
        queryText: text,
      },
      {
        status: "ERROR",
        latencyMs: Date.now() - recommendationStart,
        errorMessage,
        resultCount: 0,
        recommendedPlaceIds: [],
        parsedConstraints,
      },
    );
    logger.error({ error }, "Failed to recommend places for telegram");
    await sendTelegramMessage(chatId, "Something went wrong. Please try again.");
    return respond(200, { ok: true });
  }

  const places = [recommendation.primary, ...recommendation.alternatives]
    .filter(Boolean)
    .slice(0, 3);
  const recommendedPlaceIds = places.map((item) => item.place.placeId);

  await writeRecommendationEvent(
    {
      channel: "TELEGRAM",
      userIdHash,
      location: { lat: locationState.lastLat, lng: locationState.lastLng },
      queryText: text,
    },
    {
      status: places.length === 0 ? "NO_RESULTS" : "OK",
      latencyMs: Date.now() - recommendationStart,
      resultCount: places.length,
      recommendedPlaceIds,
      parsedConstraints,
    },
  );

  if (places.length === 0) {
    await sendTelegramMessage(chatId, "Sorry, I couldn't find anything nearby.");
    return respond(200, { ok: true });
  }

  recommendationCache.set(userIdHash, recommendedPlaceIds);

  const lines = places.map((item, index) => {
    const rating = item.place.rating ? `${item.place.rating.toFixed(1)}★` : "No rating";
    const address = item.place.address ? ` — ${item.place.address}` : "";
    return `${index + 1}. ${item.place.name} (${rating})${address}`;
  });

  const inlineKeyboard = places.map((item, index) => [
    {
      text: "Open in Maps",
      url: getMapsUrl(item.place.name, item.place.mapsUrl ?? undefined),
    },
    { text: "Rate ⭐", callback_data: `rate:${index + 1}` },
  ]);

  await sendTelegramMessage(chatId, `Here are a few picks:\n${lines.join("\n")}`, {
    inline_keyboard: inlineKeyboard,
  });

  await sendTelegramMessage(
    chatId,
    "Reply: rate <place number> <1-5> optional comment",
  );

  return respond(200, { ok: true });
}

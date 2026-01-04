import { logger } from "../logger";
import type { LocationParse } from "./locationParseSchema";

export type GuardrailsContext = {
  coords?: { lat: number; lng: number } | null;
  explicitLocationText?: string | null;
  requestId?: string;
};

const LOCATION_DENYLIST = new Set([
  "place",
  "places",
  "here",
  "nearby",
  "around",
  "my area",
  "area",
  "this area",
]);

const normalizeLocationToken = (value: string) =>
  value.toLowerCase().replace(/[.,]/g, "").trim();

const isGenericLocation = (value: string) => LOCATION_DENYLIST.has(normalizeLocationToken(value));

export const applyGuardrails = (
  parse: LocationParse,
  ctx: GuardrailsContext,
): (LocationParse & { discardedLocationReason?: string }) => {
  let discardedLocationReason: string | undefined;
  const hasCoords = Boolean(ctx.coords);
  const explicitLocation = ctx.explicitLocationText?.trim();
  let locationText =
    explicitLocation && explicitLocation.length > 0 ? explicitLocation : parse.location_text;

  if (locationText && isGenericLocation(locationText)) {
    discardedLocationReason = "generic_location";
    locationText = undefined;
  }

  let next: LocationParse = {
    ...parse,
    location_text: locationText,
  };

  if (next.location_text) {
    next = {
      ...next,
      use_device_location: false,
    };
  } else if (hasCoords) {
    next = {
      ...next,
      use_device_location: true,
    };
    if (next.intent === "clarify") {
      next = { ...next, intent: "nearby_search" };
    }
  }

  if (!next.location_text && !hasCoords && next.intent !== "no_location_needed") {
    next = { ...next, intent: "clarify" };
  }

  if (discardedLocationReason) {
    logger.info(
      { requestId: ctx.requestId, reason: discardedLocationReason },
      "Guardrails discarded location_text",
    );
  }

  return discardedLocationReason ? { ...next, discardedLocationReason } : next;
};

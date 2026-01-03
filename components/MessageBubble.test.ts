import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import MessageBubble from "./MessageBubble";
import PlaceCard from "./PlaceCard";

const sampleMessage = {
  id: "message-1",
  role: "assistant" as const,
  content: "Sure — here are a few recommended restaurants near you.",
  createdAt: Date.now(),
};

const samplePlace = {
  placeId: "place-1",
  name: "Test Bistro",
  rating: 4.7,
  reviewCount: 120,
  address: "123 Main Street",
};

test("assistant message appears before place cards", () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      MessageBubble,
      { message: sampleMessage },
      React.createElement(PlaceCard, { place: samplePlace }),
    ),
  );

  const messageIndex = markup.indexOf(sampleMessage.content);
  const placeIndex = markup.indexOf(samplePlace.name);

  assert.ok(messageIndex !== -1, "Expected assistant message text to be rendered");
  assert.ok(placeIndex !== -1, "Expected place card name to be rendered");
  assert.ok(
    messageIndex < placeIndex,
    "Expected assistant message to appear before place card in DOM order",
  );
});

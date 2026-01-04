import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HomePageClient from "./home-client";

describe("HomePageClient suggested prompts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("clicking suggested prompt triggers refine flow", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ok",
          message: "Here are a few places.",
          places: [],
          meta: {
            mode: "search",
            suggestedPrompts: ["Closer options"],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<HomePageClient />);

    fireEvent.change(screen.getByPlaceholderText("e.g., Downtown San Francisco"), {
      target: { value: "Downtown" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set location" }));

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "noodles" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const chip = await screen.findByRole("button", { name: "Closer options" });
    fireEvent.click(chip);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const secondCall = fetchMock.mock.calls[1]?.[1];
    const payload = JSON.parse(secondCall?.body as string);
    expect(payload.action).toBe("refine");
    expect(payload.message).toBe("Closer options");
  });

  it("chip click does not submit the chat form directly", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ok",
          message: "Here are a few places.",
          places: [],
          meta: {
            mode: "search",
            suggestedPrompts: ["Cheaper"],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<HomePageClient />);

    fireEvent.change(screen.getByPlaceholderText("e.g., Downtown San Francisco"), {
      target: { value: "Downtown" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set location" }));

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "pizza" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const chip = await screen.findByRole("button", { name: "Cheaper" });
    fireEvent.click(chip);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const secondCall = fetchMock.mock.calls[1]?.[1];
    const payload = JSON.parse(secondCall?.body as string);
    expect(payload.action).toBe("refine");
  });

  it("show more reveals more places without fetching", async () => {
    const places = [
      {
        placeId: "place-1",
        name: "Place One",
        mapsUrl: "https://maps.example.com/1",
      },
      {
        placeId: "place-2",
        name: "Place Two",
        mapsUrl: "https://maps.example.com/2",
      },
      {
        placeId: "place-3",
        name: "Place Three",
        mapsUrl: "https://maps.example.com/3",
      },
      {
        placeId: "place-4",
        name: "Place Four",
        mapsUrl: "https://maps.example.com/4",
      },
      {
        placeId: "place-5",
        name: "Place Five",
        mapsUrl: "https://maps.example.com/5",
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ok",
          message: "Here are a few places.",
          places,
          meta: {
            mode: "search",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<HomePageClient />);

    fireEvent.change(screen.getByPlaceholderText("e.g., Downtown San Francisco"), {
      target: { value: "Downtown" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set location" }));

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "tacos" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByText("Place One");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /show 2 more/i }));

    await waitFor(() => {
      expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(5);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("title-only chips render as anchors with maps URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ok",
          message: "Here are a few places.",
          places: [
            {
              placeId: "place-1",
              name: "Place One",
              mapsUrl: "https://maps.example.com/1",
            },
            {
              placeId: "place-2",
              name: "Place Two",
              mapsUrl: "https://maps.example.com/2",
            },
            {
              placeId: "place-3",
              name: "Place Three",
              mapsUrl: "https://maps.example.com/3",
            },
            {
              placeId: "place-4",
              name: "Place Four",
              mapsUrl: "https://maps.example.com/4",
            },
          ],
          meta: {
            mode: "search",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<HomePageClient />);

    fireEvent.change(screen.getByPlaceholderText("e.g., Downtown San Francisco"), {
      target: { value: "Downtown" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set location" }));

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "pizza" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const chipLink = await screen.findByRole("link", { name: /open place four in maps/i });
    expect(chipLink).toHaveAttribute("href", "https://maps.example.com/4");
  });
});

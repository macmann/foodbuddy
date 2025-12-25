"use client";

import { useEffect, useMemo, useState } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  recommendations?: RecommendationCardData[];
};

type RecommendationCardData = {
  placeId: string;
  name: string;
  rating?: number;
  distanceMeters?: number;
  openNow?: boolean;
  address?: string;
  mapsUrl?: string;
  rationale?: string;
};

type ChatResponse = {
  primary: RecommendationCardData | null;
  alternatives: RecommendationCardData[];
  message: string;
};

const createId = () => crypto.randomUUID();

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationText, setLocationText] = useState("");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const anonId = useMemo(() => {
    if (typeof window === "undefined") {
      return "";
    }
    const stored = window.localStorage.getItem("foodbuddy:anonId");
    if (stored) {
      return stored;
    }
    const id = createId();
    window.localStorage.setItem("foodbuddy:anonId", id);
    return id;
  }, []);

  const sessionId = useMemo(() => createId(), []);

  useEffect(() => {
    if (!location) {
      return;
    }
    setLocationError(null);
  }, [location]);

  const handleShareLocation = () => {
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported in this browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocationText("");
      },
      () => {
        setLocation(null);
        setLocationError("Location permission denied. Please enter a location.");
      },
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.trim() || loading) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anonId,
          sessionId,
          location,
          locationText: location ? undefined : locationText,
          message: userMessage.content,
        }),
      });

      if (!response.ok) {
        throw new Error("Request failed");
      }

      const data = (await response.json()) as ChatResponse;
      const recommendations = [data.primary, ...data.alternatives].filter(
        (item): item is RecommendationCardData => Boolean(item),
      );

      const assistantMessage: ChatMessage = {
        id: createId(),
        role: "assistant",
        content: data.message,
        recommendations,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const assistantMessage: ChatMessage = {
        id: createId(),
        role: "assistant",
        content: "Sorry, something went wrong. Please try again.",
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1.5rem" }}>
      <h1 style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>FoodBuddy</h1>
      <p style={{ marginBottom: "1.5rem", color: "#444" }}>
        Ask for nearby food spots and get instant recommendations.
      </p>

      <section style={{ marginBottom: "1rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <button
          onClick={handleShareLocation}
          type="button"
          style={{ padding: "0.5rem 1rem", borderRadius: 6, border: "1px solid #ddd" }}
        >
          Share location
        </button>
        {location && (
          <span style={{ alignSelf: "center", color: "#2d7" }}>
            Location ready ✓
          </span>
        )}
      </section>

      {locationError && (
        <div style={{ marginBottom: "1rem", color: "#b00" }}>{locationError}</div>
      )}

      {!location && (
        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.5rem" }}>
            Enter your location
          </label>
          <input
            value={locationText}
            onChange={(event) => setLocationText(event.target.value)}
            placeholder="e.g., Downtown San Francisco"
            style={{ width: "100%", padding: "0.6rem", borderRadius: 6, border: "1px solid #ddd" }}
          />
        </div>
      )}

      <section style={{ marginBottom: "2rem" }}>
        {messages.map((message) => (
          <div key={message.id} style={{ marginBottom: "1rem" }}>
            <strong style={{ display: "block", marginBottom: "0.25rem" }}>
              {message.role === "user" ? "You" : "FoodBuddy"}
            </strong>
            <div style={{ whiteSpace: "pre-line" }}>{message.content}</div>
            {message.recommendations && message.recommendations.length > 0 && (
              <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.75rem" }}>
                {message.recommendations.map((rec) => (
                  <article
                    key={rec.placeId}
                    style={{ border: "1px solid #eee", borderRadius: 8, padding: "0.75rem" }}
                  >
                    <h3 style={{ margin: 0 }}>{rec.name}</h3>
                    <div style={{ color: "#666", marginTop: "0.25rem" }}>
                      {rec.rating ? `${rec.rating.toFixed(1)}★` : "No rating"}
                      {typeof rec.distanceMeters === "number" && (
                        <span>{` · ${Math.round(rec.distanceMeters)}m away`}</span>
                      )}
                      {rec.openNow !== undefined && (
                        <span>{rec.openNow ? " · Open now" : " · Closed"}</span>
                      )}
                    </div>
                    {rec.address && (
                      <div style={{ marginTop: "0.25rem", color: "#555" }}>{rec.address}</div>
                    )}
                    {rec.rationale && (
                      <p style={{ marginTop: "0.5rem", color: "#444" }}>{rec.rationale}</p>
                    )}
                    {rec.mapsUrl && (
                      <a
                        href={rec.mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ marginTop: "0.5rem", display: "inline-block", color: "#0a5" }}
                      >
                        View on Maps
                      </a>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Try 'open sushi nearby'"
          style={{ flex: 1, padding: "0.6rem", borderRadius: 6, border: "1px solid #ddd" }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{ padding: "0.6rem 1rem", borderRadius: 6, border: "1px solid #ddd" }}
        >
          {loading ? "Sending..." : "Send"}
        </button>
      </form>
    </main>
  );
}

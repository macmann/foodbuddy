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
  const [feedbackOptions, setFeedbackOptions] = useState<RecommendationCardData[]>([]);
  const [feedbackPromptVisible, setFeedbackPromptVisible] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState("");
  const [rating, setRating] = useState(0);
  const [commentText, setCommentText] = useState("");
  const [tagText, setTagText] = useState("");
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null);

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

  useEffect(() => {
    if (feedbackPromptVisible || feedbackSubmitted || feedbackOptions.length === 0) {
      return;
    }

    const lastActivity = lastActivityAt ?? Date.now();
    const remainingMs = Math.max(0, 10 * 60 * 1000 - (Date.now() - lastActivity));

    if (remainingMs === 0) {
      setFeedbackPromptVisible(true);
      return;
    }

    const timeout = window.setTimeout(() => {
      setFeedbackPromptVisible(true);
    }, remainingMs);

    return () => window.clearTimeout(timeout);
  }, [feedbackOptions, feedbackPromptVisible, feedbackSubmitted, lastActivityAt]);

  const noteActivity = () => {
    setLastActivityAt(Date.now());
  };

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

    noteActivity();

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

      if (recommendations.length > 0) {
        setFeedbackOptions(recommendations);
        setSelectedPlaceId(recommendations[0].placeId);
        setFeedbackPromptVisible(false);
        setFeedbackSubmitted(false);
        setFeedbackError(null);
        setFeedbackSuccess(null);
        setRating(0);
        setCommentText("");
        setTagText("");
        setLastActivityAt(Date.now());
      } else {
        setFeedbackOptions([]);
        setFeedbackPromptVisible(false);
      }

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

  const handleFeedbackSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedPlaceId || rating === 0) {
      setFeedbackError("Please select a place and rating.");
      return;
    }

    try {
      setFeedbackError(null);
      const tags = tagText
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);

      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anonId,
          channel: "WEB",
          placeId: selectedPlaceId,
          rating,
          commentText: commentText.trim() || undefined,
          tags: tags.length > 0 ? tags : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error("Feedback failed");
      }

      setFeedbackSubmitted(true);
      setFeedbackPromptVisible(false);
      setFeedbackSuccess("Thanks for sharing your feedback!");
    } catch (error) {
      setFeedbackError("Sorry, we couldn't save your feedback. Please try again.");
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
          onChange={(event) => {
            setInput(event.target.value);
            noteActivity();
          }}
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

      {feedbackPromptVisible && feedbackOptions.length > 0 && !feedbackSubmitted && (
        <section
          style={{
            marginTop: "2rem",
            padding: "1rem",
            borderRadius: 10,
            border: "1px solid #e6e6e6",
            background: "#fafafa",
          }}
        >
          <h2 style={{ marginTop: 0 }}>Did you try any? Rate 1–5</h2>
          <p style={{ color: "#555" }}>Share feedback to help the community.</p>
          <form onSubmit={handleFeedbackSubmit} style={{ display: "grid", gap: "0.75rem" }}>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              Place tried
              <select
                value={selectedPlaceId}
                onChange={(event) => setSelectedPlaceId(event.target.value)}
                style={{ padding: "0.5rem", borderRadius: 6, border: "1px solid #ddd" }}
              >
                {feedbackOptions.map((option) => (
                  <option key={option.placeId} value={option.placeId}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: "grid", gap: "0.35rem" }}>
              <span>Rating</span>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRating(value)}
                    style={{
                      padding: "0.4rem 0.75rem",
                      borderRadius: 999,
                      border: "1px solid #ddd",
                      background: rating === value ? "#0a5" : "#fff",
                      color: rating === value ? "#fff" : "#222",
                    }}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              Optional comment
              <textarea
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                rows={3}
                style={{ padding: "0.5rem", borderRadius: 6, border: "1px solid #ddd" }}
                placeholder="Tell us what you liked"
              />
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              Optional tags (comma separated)
              <input
                value={tagText}
                onChange={(event) => setTagText(event.target.value)}
                placeholder="cozy, quick bite, family"
                style={{ padding: "0.5rem", borderRadius: 6, border: "1px solid #ddd" }}
              />
            </label>
            {feedbackError && <div style={{ color: "#b00" }}>{feedbackError}</div>}
            <button
              type="submit"
              style={{ padding: "0.6rem 1rem", borderRadius: 6, border: "1px solid #ddd" }}
            >
              Submit feedback
            </button>
          </form>
        </section>
      )}

      {feedbackSuccess && (
        <div style={{ marginTop: "1rem", color: "#0a5" }}>{feedbackSuccess}</div>
      )}
    </main>
  );
}

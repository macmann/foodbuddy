"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import Composer from "../components/Composer";
import FeedbackCard from "../components/FeedbackCard";
import LocationGate from "../components/LocationGate";
import MessageBubble, { type MessageBubbleData } from "../components/MessageBubble";
import RecommendationCard from "../components/RecommendationCard";
import type { ChatResponse, RecommendationCardData } from "../lib/types/chat";

type ChatMessage = MessageBubbleData & {
  recommendations?: RecommendationCardData[];
  status?: ChatResponse["status"];
};

const isRecommendationCard = (
  value: RecommendationCardData | null | undefined,
): value is RecommendationCardData => value != null;

const createId = () => crypto.randomUUID();

const PLACEHOLDER_OPTIONS = [
  "Any good food around here?",
  "Cheap noodles within 1km",
  "Best café for working",
];

const getRandomPlaceholder = () =>
  PLACEHOLDER_OPTIONS[Math.floor(Math.random() * PLACEHOLDER_OPTIONS.length)];
const DEFAULT_RADIUS_M = 1500;

export default function HomePageClient() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [manualLocationInput, setManualLocationInput] = useState("");
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
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null);
  const [composerPlaceholder] = useState(getRandomPlaceholder);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

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
  const locationReady = Boolean(location || locationText.trim());

  useEffect(() => {
    if (!location) {
      return;
    }
    setLocationError(null);
  }, [location]);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setToastMessage(null);
    }, 4000);
    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

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

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container || !shouldAutoScrollRef.current) {
      return;
    }
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages, feedbackPromptVisible, feedbackSuccess, loading]);

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
        setManualLocationInput("");
      },
      () => {
        setLocation(null);
        setLocationError("Location permission denied. Please enter a location.");
      },
    );
  };

  const handleSetManualLocation = () => {
    const trimmed = manualLocationInput.trim();
    if (!trimmed) {
      setLocationError("Please enter a neighborhood or landmark.");
      return;
    }
    setLocationText(trimmed);
    setLocation(null);
    setLocationError(null);
  };

  const sendMessage = async (messageText: string, addUserMessage = true) => {
    if (!messageText.trim() || loading) {
      return;
    }

    if (!locationReady) {
      setLocationError("Please set a location before asking for recommendations.");
      return;
    }

    const locationEnabled = Boolean(location);
    const neighborhood = locationText.trim();

    if (locationEnabled && (location?.lat == null || location?.lng == null)) {
      setToastMessage(
        "Location is ON but coordinates are missing. Click ‘Use my current location’ or set a neighborhood.",
      );
      return;
    }

    noteActivity();

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: messageText.trim(),
      createdAt: Date.now(),
    };

    if (addUserMessage) {
      setMessages((prev) => [...prev, userMessage]);
      setInput("");
    }

    setLoading(true);

    try {
      const radius_m = DEFAULT_RADIUS_M;
      const payload = {
        anonId,
        sessionId,
        location,
        locationText: location ? undefined : locationText,
        neighborhood: neighborhood || undefined,
        message: userMessage.content,
        latitude: location?.lat ?? null,
        longitude: location?.lng ?? null,
        radius_m: typeof radius_m === "number" ? radius_m : DEFAULT_RADIUS_M,
        locationEnabled,
      };

      if (process.env.NEXT_PUBLIC_DEBUG === "true") {
        console.log("Chat payload", payload);
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        const errorMessage = errorBody?.message ?? "Request failed";
        setToastMessage(errorMessage);
        return;
      }

      const data = (await response.json()) as ChatResponse;
      if (process.env.NEXT_PUBLIC_DEBUG === "true") {
        console.log("Chat response", {
          status: data.status,
          message: data.message,
          primary: Boolean(data.primary),
          alternatives: data.alternatives?.length ?? 0,
          places: data.places?.length ?? 0,
          debug: data.debug,
        });
      }
      const extras = [
        ...(data.primary ? [data.primary] : []),
        ...(data.alternatives ?? []),
      ].filter(isRecommendationCard) as RecommendationCardData[];
      const combined = (data.places ?? []).concat(extras);
      const seen = new Set<string>();
      const recommendations = combined.filter((item) => {
        if (seen.has(item.placeId)) {
          return false;
        }
        seen.add(item.placeId);
        return true;
      });

      if (recommendations.length > 0) {
        setFeedbackOptions(recommendations);
        setSelectedPlaceId(recommendations[0].placeId);
        setFeedbackPromptVisible(false);
        setFeedbackSubmitted(false);
        setFeedbackError(null);
        setFeedbackSuccess(null);
        setRating(0);
        setCommentText("");
        setSelectedTags([]);
        setLastActivityAt(Date.now());
      } else {
        setFeedbackOptions([]);
        setFeedbackPromptVisible(false);
      }

      const assistantMessage: ChatMessage = {
        id: createId(),
        role: "assistant",
        content: data.message ?? "Here are a few places to consider.",
        recommendations,
        status: data.status,
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const assistantMessage: ChatMessage = {
        id: createId(),
        role: "assistant",
        content: "Sorry, something went wrong while fetching places.",
        createdAt: Date.now(),
        error: true,
        retryContent: messageText,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await sendMessage(input);
  };

  const handleRetry = (message: MessageBubbleData) => {
    if (!message.retryContent) {
      return;
    }
    sendMessage(message.retryContent, false);
  };

  const handleFeedbackSubmit = async () => {
    if (!selectedPlaceId || rating === 0) {
      setFeedbackError("Please select a place and rating.");
      return;
    }

    try {
      setFeedbackError(null);

      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anonId,
          channel: "WEB",
          placeId: selectedPlaceId,
          rating,
          commentText: commentText.trim() || undefined,
          tags: selectedTags.length > 0 ? selectedTags : undefined,
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

  const handleToggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag],
    );
  };

  const handleRateFromCard = (placeId: string) => {
    setSelectedPlaceId(placeId);
    setFeedbackPromptVisible(true);
    setFeedbackSubmitted(false);
    setFeedbackSuccess(null);
  };

  const handleShowMore = () => {
    sendMessage("show more options");
  };

  const handleScroll = () => {
    const container = chatContainerRef.current;
    if (!container) {
      return;
    }
    const distanceToBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoScrollRef.current = distanceToBottom < 120;
  };

  const canSend = locationReady && input.trim().length > 0 && !loading;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-6 sm:px-6">
        {toastMessage && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 shadow-sm">
            {toastMessage}
          </div>
        )}
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm backdrop-blur">
          <div>
            <h1 className="text-lg font-bold text-slate-900">FoodBuddy</h1>
            <p className="text-xs text-slate-500">Smart local food picks in seconds.</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`rounded-full px-3 py-1 font-semibold ${
                locationReady ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              Location: {locationReady ? "On" : "Off"}
            </span>
            <button
              type="button"
              onClick={() => {
                setLocation(null);
                setLocationText("");
                setManualLocationInput("");
                setLocationError(null);
              }}
              className="rounded-full px-2 py-1 text-xs font-semibold text-slate-500 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
            >
              Change
            </button>
          </div>
        </header>

        <section className="flex flex-1 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div
            ref={chatContainerRef}
            onScroll={handleScroll}
            className="flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-6"
          >
            {!locationReady && (
              <LocationGate
                onShareLocation={handleShareLocation}
                manualLocationInput={manualLocationInput}
                onManualLocationChange={(event) => setManualLocationInput(event.target.value)}
                onSetManualLocation={handleSetManualLocation}
                errorMessage={locationError}
              />
            )}

            {messages.map((message) => (
              <div key={message.id} className="space-y-3">
                <MessageBubble message={message} onRetry={handleRetry}>
                  {message.recommendations && message.recommendations.length > 0 && (
                    <div className="mt-3 grid gap-3">
                      {message.recommendations.map((rec) => (
                        <RecommendationCard
                          key={rec.placeId}
                          recommendation={rec}
                          onRate={handleRateFromCard}
                        />
                      ))}
                      <button
                        type="button"
                        onClick={handleShowMore}
                        className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                      >
                        Show 3 more
                      </button>
                    </div>
                  )}
                  {message.role === "assistant" &&
                    message.status === "NO_RESULTS" &&
                    (!message.recommendations || message.recommendations.length === 0) && (
                      <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                        No results yet. Try increasing the radius, changing cuisine, or
                        searching a nearby neighborhood.
                      </div>
                    )}
                </MessageBubble>
                <div className="h-px w-full bg-slate-100" />
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-2xl bg-slate-100 px-4 py-3 shadow-sm">
                  <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
                  <div className="mt-2 h-3 w-52 animate-pulse rounded bg-slate-200" />
                  <p className="mt-2 text-xs text-slate-400">Assistant is thinking…</p>
                </div>
              </div>
            )}

            {feedbackPromptVisible && feedbackOptions.length > 0 && !feedbackSubmitted && (
              <div className="flex justify-start">
                <div className="max-w-[90%]">
                  <FeedbackCard
                    options={feedbackOptions}
                    selectedPlaceId={selectedPlaceId}
                    rating={rating}
                    commentText={commentText}
                    selectedTags={selectedTags}
                    onPlaceChange={setSelectedPlaceId}
                    onRatingChange={setRating}
                    onCommentChange={setCommentText}
                    onToggleTag={handleToggleTag}
                    onSubmit={handleFeedbackSubmit}
                    onSkip={() => {
                      setFeedbackPromptVisible(false);
                      setFeedbackSubmitted(true);
                    }}
                    errorMessage={feedbackError}
                  />
                </div>
              </div>
            )}

            {feedbackSuccess && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 shadow-sm">
                  {feedbackSuccess}
                </div>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit}>
            <Composer
              value={input}
              onChange={(value) => {
                setInput(value);
                noteActivity();
              }}
              onSubmit={() => sendMessage(input)}
              disabled={!canSend}
              placeholder={composerPlaceholder}
            />
          </form>
        </section>
      </div>
    </main>
  );
}

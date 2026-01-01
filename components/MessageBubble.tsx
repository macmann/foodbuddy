import type { ReactNode } from "react";

export type MessageBubbleData = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  error?: boolean;
  retryContent?: string;
  responseError?: boolean;
  errorDetails?: unknown;
};

type MessageBubbleProps = {
  message: MessageBubbleData;
  children?: ReactNode;
  onRetry?: (message: MessageBubbleData) => void;
};

const formatTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

export default function MessageBubble({ message, children, onRetry }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const debugDetails =
    message.errorDetails === undefined ? null : JSON.stringify(message.errorDetails, null, 2);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm sm:text-base ${
          isUser
            ? "bg-slate-900 text-white"
            : message.error
              ? "bg-rose-50 text-rose-700"
              : "bg-slate-100 text-slate-900"
        }`}
      >
        {message.content && <p className="whitespace-pre-line">{message.content}</p>}
        {children}
        {message.responseError && (
          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <p>Couldn’t fetch nearby places. Try again.</p>
            {debugDetails && (
              <details className="mt-2 text-rose-600">
                <summary className="cursor-pointer text-xs font-semibold">
                  Debug details
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
                  {debugDetails}
                </pre>
              </details>
            )}
          </div>
        )}
        {message.error && message.retryContent && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(message)}
            className="mt-3 inline-flex items-center rounded-full border border-rose-200 bg-white px-3 py-1 text-xs font-semibold text-rose-700 shadow-sm transition hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
          >
            Try again
          </button>
        )}
        <div className="mt-2 text-[11px] text-slate-400">{formatTime(message.createdAt)}</div>
      </div>
    </div>
  );
}

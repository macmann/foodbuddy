"use client";

import { useState } from "react";

type RawResponseCardProps = {
  rawResponseJson?: string | null;
};

export default function RawResponseCard({ rawResponseJson }: RawResponseCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const parsed = rawResponseJson ? safeParseJson(rawResponseJson) : null;
  const displayText = parsed
    ? JSON.stringify(parsed, null, 2)
    : rawResponseJson ?? "No raw response captured.";

  const handleCopy = async () => {
    if (!rawResponseJson) {
      return;
    }
    try {
      await navigator.clipboard.writeText(rawResponseJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-200">Raw response</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-200"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!rawResponseJson}
            className="rounded-lg bg-emerald-400 px-3 py-1 text-xs font-semibold text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <pre
        className={`mt-3 overflow-auto rounded-xl bg-slate-950/60 p-4 text-xs text-slate-300 ${
          expanded ? "max-h-[520px]" : "max-h-48"
        }`}
      >
        {displayText}
      </pre>
    </div>
  );
}

const safeParseJson = (value: string) => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

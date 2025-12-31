"use client";

import { useEffect, useMemo, useState } from "react";

const MODEL_OPTIONS = [
  { value: "gpt-5-mini", label: "GPT-5 mini" },
  { value: "gpt-5.2", label: "GPT-5.2" },
] as const;

const REASONING_OPTIONS = ["low", "medium", "high"] as const;
const VERBOSITY_OPTIONS = ["low", "medium", "high"] as const;
const PROMPT_MAX_LENGTH = 10_000;

const normalizeVerbosityValue = (value?: string) => {
  if (value === "normal") {
    return "medium";
  }
  return VERBOSITY_OPTIONS.includes(value as (typeof VERBOSITY_OPTIONS)[number])
    ? value
    : "medium";
};

const formatTimestamp = (value?: string) => {
  if (!value) {
    return "Never";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleString();
};

type LLMSettingsResponse = {
  llmEnabled: boolean;
  llmProvider: string;
  llmModel: string;
  llmSystemPrompt: string;
  reasoningEffort: string;
  verbosity: string;
  updatedAt?: string;
};

type ToastState = { tone: "success" | "error"; message: string } | null;

export default function AdminLLMSettingsPage() {
  const [settings, setSettings] = useState<LLMSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/admin/settings", {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Failed to load settings");
        }
        const data = (await response.json()) as LLMSettingsResponse;
        if (!cancelled) {
          setSettings({ ...data, verbosity: normalizeVerbosityValue(data.verbosity) });
        }
      } catch (error) {
        if (!cancelled) {
          setToast({ tone: "error", message: "Unable to load LLM settings." });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const promptLength = settings?.llmSystemPrompt.length ?? 0;
  const isPromptEmpty = promptLength === 0;
  const promptLengthLabel = `${promptLength.toLocaleString()} / ${PROMPT_MAX_LENGTH.toLocaleString()} chars`;

  const updateSettings = <K extends keyof LLMSettingsResponse>(
    key: K,
    value: LLMSettingsResponse[K],
  ) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = async () => {
    if (!settings) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llmEnabled: settings.llmEnabled,
          llmProvider: settings.llmProvider,
          llmModel: settings.llmModel,
          llmSystemPrompt: settings.llmSystemPrompt,
          reasoningEffort: settings.reasoningEffort,
          verbosity: normalizeVerbosityValue(settings.verbosity),
        }),
      });

      if (!response.ok) {
        let message = "Failed to save LLM settings.";
        try {
          const errorData = (await response.json()) as { error?: string };
          if (errorData.error) {
            message = errorData.error;
          }
        } catch {
          // ignore parsing errors
        }
        throw new Error(message);
      }

      const data = (await response.json()) as LLMSettingsResponse;
      setSettings(data);
      setToast({ tone: "success", message: "LLM settings saved." });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save LLM settings.";
      setToast({ tone: "error", message });
    } finally {
      setSaving(false);
    }
  };

  const enabledLabel = useMemo(
    () => (settings?.llmEnabled ? "Enabled" : "Disabled"),
    [settings?.llmEnabled],
  );

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-white">LLM Agent</h2>
        <p className="text-sm text-slate-400">
          Configure the GPT-5 agent that powers FoodBuddy chat responses.
        </p>
      </div>

      {toast ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm shadow-lg transition ${
            toast.tone === "success"
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
              : "border-rose-400/30 bg-rose-400/10 text-rose-100"
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        {loading ? (
          <p className="text-sm text-slate-400">Loading settings...</p>
        ) : settings ? (
          <div className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <label className="space-y-2 text-sm text-slate-300">
                <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Enable LLM Agent
                </span>
                <button
                  type="button"
                  onClick={() => updateSettings("llmEnabled", !settings.llmEnabled)}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                    settings.llmEnabled
                      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
                      : "border-slate-700 bg-slate-950 text-slate-300"
                  }`}
                >
                  <span>{enabledLabel}</span>
                  <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    Toggle
                  </span>
                </button>
              </label>

              <label className="space-y-2 text-sm text-slate-300">
                <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Model</span>
                <select
                  value={settings.llmModel}
                  onChange={(event) => updateSettings("llmModel", event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  {MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <label className="space-y-2 text-sm text-slate-300">
                <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Reasoning effort
                </span>
                <select
                  value={settings.reasoningEffort}
                  onChange={(event) => updateSettings("reasoningEffort", event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  {REASONING_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 text-sm text-slate-300">
                <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Verbosity
                </span>
                <select
                  value={settings.verbosity}
                  onChange={(event) => updateSettings("verbosity", event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  {VERBOSITY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="space-y-2 text-sm text-slate-300">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  System prompt
                </span>
                <span className="text-xs text-slate-500">{promptLengthLabel}</span>
              </div>
              <textarea
                value={settings.llmSystemPrompt}
                onChange={(event) => updateSettings("llmSystemPrompt", event.target.value)}
                rows={10}
                maxLength={PROMPT_MAX_LENGTH}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white"
              />
            </label>

            {isPromptEmpty ? (
              <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                System prompt is empty. The default FoodBuddy behavior rules will apply.
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                Last updated: {formatTimestamp(settings.updatedAt)}
              </div>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save settings"}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Unable to load settings.</p>
        )}
      </div>
    </section>
  );
}

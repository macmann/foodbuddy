import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { isAllowedModel } from "../../../../lib/agent/model";
import {
  LLM_MODEL_ALLOWLIST,
  LLM_PROMPT_MAX_LENGTH,
  LLM_REASONING_ALLOWLIST,
  LLM_SETTINGS_DEFAULTS,
  LLM_VERBOSITY_ALLOWLIST,
  normalizeVerbosity,
  type ReasoningEffort,
  resetLLMSettingsCache,
} from "../../../../lib/settings/llm";

const isReasoningEffort = (value: string): value is ReasoningEffort =>
  LLM_REASONING_ALLOWLIST.includes(value as ReasoningEffort);

const formatSettings = (record: {
  llmEnabled: boolean;
  llmProvider: string;
  llmModel: string;
  llmSystemPrompt: string;
  reasoningEffort: string;
  verbosity: string;
  updatedAt: Date;
}) => ({
  llmEnabled: record.llmEnabled,
  llmProvider: record.llmProvider,
  llmModel: record.llmModel,
  llmSystemPrompt: record.llmSystemPrompt,
  reasoningEffort: record.reasoningEffort,
  verbosity: normalizeVerbosity(record.verbosity) ?? LLM_SETTINGS_DEFAULTS.verbosity,
  updatedAt: record.updatedAt,
});

export const GET = async () => {
  const record = await prisma.lLMSettings.findUnique({
    where: { id: "default" },
  });

  if (record) {
    return NextResponse.json(formatSettings(record));
  }

  const created = await prisma.lLMSettings.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      llmEnabled: LLM_SETTINGS_DEFAULTS.llmEnabled,
      llmProvider: LLM_SETTINGS_DEFAULTS.llmProvider,
      llmModel: LLM_SETTINGS_DEFAULTS.llmModel,
      llmSystemPrompt: LLM_SETTINGS_DEFAULTS.llmSystemPrompt,
      reasoningEffort: LLM_SETTINGS_DEFAULTS.reasoningEffort,
      verbosity: LLM_SETTINGS_DEFAULTS.verbosity,
    },
  });

  return NextResponse.json(formatSettings(created));
};

export const PUT = async (request: Request) => {
  let payload: {
    llmEnabled?: boolean;
    llmProvider?: string;
    llmModel?: string;
    llmSystemPrompt?: string;
    reasoningEffort?: string;
    verbosity?: string;
  } = {};

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const llmEnabled = payload.llmEnabled;
  const llmProvider = payload.llmProvider ?? LLM_SETTINGS_DEFAULTS.llmProvider;
  const llmModel = payload.llmModel;
  const llmSystemPrompt =
    typeof payload.llmSystemPrompt === "string" ? payload.llmSystemPrompt.trim() : "";
  const reasoningEffort = payload.reasoningEffort;
  const verbosity = payload.verbosity;
  const normalizedVerbosity = normalizeVerbosity(verbosity);

  if (typeof llmEnabled !== "boolean") {
    return NextResponse.json({ error: "Invalid LLM enabled flag" }, { status: 400 });
  }

  if (llmProvider !== "openai") {
    return NextResponse.json({ error: "Invalid provider. Allowed: openai" }, { status: 400 });
  }

  if (!llmModel || !isAllowedModel(llmModel)) {
    return NextResponse.json(
      { error: `Invalid model. Allowed: ${LLM_MODEL_ALLOWLIST.join(", ")}` },
      { status: 400 },
    );
  }

  if (llmSystemPrompt.length > LLM_PROMPT_MAX_LENGTH) {
    return NextResponse.json({ error: "System prompt too long" }, { status: 400 });
  }

  if (!reasoningEffort || !isReasoningEffort(reasoningEffort)) {
    return NextResponse.json(
      {
        error: `Invalid reasoning effort. Allowed: ${LLM_REASONING_ALLOWLIST.join(", ")}`,
      },
      { status: 400 },
    );
  }

  if (!normalizedVerbosity) {
    return NextResponse.json(
      {
        error: `Invalid verbosity. Allowed: ${LLM_VERBOSITY_ALLOWLIST.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const updated = await prisma.lLMSettings.upsert({
    where: { id: "default" },
    update: {
      llmEnabled,
      llmProvider,
      llmModel,
      llmSystemPrompt,
      reasoningEffort,
      verbosity: normalizedVerbosity,
    },
    create: {
      id: "default",
      llmEnabled,
      llmProvider,
      llmModel,
      llmSystemPrompt,
      reasoningEffort,
      verbosity: normalizedVerbosity,
    },
  });

  resetLLMSettingsCache();

  return NextResponse.json(formatSettings(updated));
};

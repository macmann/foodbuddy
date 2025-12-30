import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import {
  LLM_MODEL_ALLOWLIST,
  LLM_SETTINGS_DEFAULTS,
  resetLLMSettingsCache,
} from "../../../../lib/settings/llm";

const isAllowedModel = (model: string) =>
  LLM_MODEL_ALLOWLIST.includes(model as (typeof LLM_MODEL_ALLOWLIST)[number]);

export const GET = async () => {
  const record = await prisma.lLMSettings.findUnique({
    where: { id: "default" },
  });

  if (record) {
    return NextResponse.json({
      model: record.model,
      systemPrompt: record.systemPrompt,
      temperature: record.temperature,
      maxTokens: record.maxTokens,
      updatedAt: record.updatedAt,
    });
  }

  const created = await prisma.lLMSettings.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      model: LLM_SETTINGS_DEFAULTS.model,
      systemPrompt: LLM_SETTINGS_DEFAULTS.systemPrompt,
      temperature: LLM_SETTINGS_DEFAULTS.temperature,
      maxTokens: LLM_SETTINGS_DEFAULTS.maxTokens,
    },
  });

  return NextResponse.json({
    model: created.model,
    systemPrompt: created.systemPrompt,
    temperature: created.temperature,
    maxTokens: created.maxTokens,
    updatedAt: created.updatedAt,
  });
};

export const PUT = async (request: Request) => {
  let payload: {
    model?: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
  } = {};

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const model = payload.model?.trim();
  const systemPrompt = payload.systemPrompt ?? "";
  const temperature = payload.temperature;
  const maxTokens = payload.maxTokens;

  if (!model || !isAllowedModel(model)) {
    return NextResponse.json({ error: "Invalid model" }, { status: 400 });
  }

  if (typeof systemPrompt !== "string" || systemPrompt.length > 10_000) {
    return NextResponse.json({ error: "Invalid system prompt" }, { status: 400 });
  }

  if (typeof temperature !== "number" || temperature < 0 || temperature > 1) {
    return NextResponse.json({ error: "Invalid temperature" }, { status: 400 });
  }

  if (typeof maxTokens !== "number" || maxTokens < 100 || maxTokens > 2000) {
    return NextResponse.json({ error: "Invalid max tokens" }, { status: 400 });
  }

  const updated = await prisma.lLMSettings.upsert({
    where: { id: "default" },
    update: {
      model,
      systemPrompt,
      temperature,
      maxTokens,
    },
    create: {
      id: "default",
      model,
      systemPrompt,
      temperature,
      maxTokens,
    },
  });

  resetLLMSettingsCache();

  return NextResponse.json({
    model: updated.model,
    systemPrompt: updated.systemPrompt,
    temperature: updated.temperature,
    maxTokens: updated.maxTokens,
    updatedAt: updated.updatedAt,
  });
};

import {
  deepResearchBudgetsSchema,
  deepResearchModelConfigSchema,
  type DeepResearchBudgets,
  type DeepResearchModelConfig,
  type DeepResearchRuntimeConfig,
} from "@/lib/deep-research/types";

const defaultModelConfig: DeepResearchModelConfig = {
  summarizationModel: "gpt-4.1-mini",
  summarizationModelMaxTokens: 4096,
  researchModel: "gpt-4.1",
  researchModelMaxTokens: 8000,
  compressionModel: "gpt-4.1",
  compressionModelMaxTokens: 8192,
  finalReportModel: "gpt-4.1",
  finalReportModelMaxTokens: 10000,
  maxStructuredOutputRetries: 3,
  maxContentLength: 50000,
};

const defaultBudgets: DeepResearchBudgets = {
  maxConcurrentResearchUnits: 2,
  maxResearcherIterations: 3,
  maxReactToolCalls: 4,
};

function readPositiveInt(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getDeepResearchModelConfig(): DeepResearchModelConfig {
  return deepResearchModelConfigSchema.parse({
    summarizationModel:
      process.env.DEEP_RESEARCH_SUMMARIZATION_MODEL ??
      defaultModelConfig.summarizationModel,
    summarizationModelMaxTokens: readPositiveInt(
      "DEEP_RESEARCH_SUMMARIZATION_MODEL_MAX_TOKENS",
      defaultModelConfig.summarizationModelMaxTokens,
    ),
    researchModel:
      process.env.DEEP_RESEARCH_RESEARCH_MODEL ??
      defaultModelConfig.researchModel,
    researchModelMaxTokens: readPositiveInt(
      "DEEP_RESEARCH_RESEARCH_MODEL_MAX_TOKENS",
      defaultModelConfig.researchModelMaxTokens,
    ),
    compressionModel:
      process.env.DEEP_RESEARCH_COMPRESSION_MODEL ??
      defaultModelConfig.compressionModel,
    compressionModelMaxTokens: readPositiveInt(
      "DEEP_RESEARCH_COMPRESSION_MODEL_MAX_TOKENS",
      defaultModelConfig.compressionModelMaxTokens,
    ),
    finalReportModel:
      process.env.DEEP_RESEARCH_FINAL_REPORT_MODEL ??
      defaultModelConfig.finalReportModel,
    finalReportModelMaxTokens: readPositiveInt(
      "DEEP_RESEARCH_FINAL_REPORT_MODEL_MAX_TOKENS",
      defaultModelConfig.finalReportModelMaxTokens,
    ),
    maxStructuredOutputRetries: readPositiveInt(
      "DEEP_RESEARCH_MAX_STRUCTURED_OUTPUT_RETRIES",
      defaultModelConfig.maxStructuredOutputRetries,
    ),
    maxContentLength: readPositiveInt(
      "DEEP_RESEARCH_MAX_CONTENT_LENGTH",
      defaultModelConfig.maxContentLength,
    ),
  });
}

export function getDeepResearchBudgets(): DeepResearchBudgets {
  return deepResearchBudgetsSchema.parse({
    maxConcurrentResearchUnits: readPositiveInt(
      "DEEP_RESEARCH_MAX_CONCURRENT_RESEARCH_UNITS",
      defaultBudgets.maxConcurrentResearchUnits,
    ),
    maxResearcherIterations: readPositiveInt(
      "DEEP_RESEARCH_MAX_RESEARCHER_ITERATIONS",
      defaultBudgets.maxResearcherIterations,
    ),
    maxReactToolCalls: readPositiveInt(
      "DEEP_RESEARCH_MAX_REACT_TOOL_CALLS",
      defaultBudgets.maxReactToolCalls,
    ),
  });
}

export function getRequiredOpenAiApiKey() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY for deep research.");
  }

  return apiKey;
}

export function getOptionalTavilyApiKey() {
  return process.env.TAVILY_API_KEY?.trim() || undefined;
}

export function getDatabaseConnectionString() {
  return (
    process.env.SUPABASE_DB_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    undefined
  );
}

export function getDeepResearchRuntimeConfig(
  threadId: string,
  selectedDocumentIds: string[],
): DeepResearchRuntimeConfig {
  return {
    threadId,
    selectedDocumentIds,
    openAiApiKey: getRequiredOpenAiApiKey(),
    tavilyApiKey: getOptionalTavilyApiKey(),
    modelConfig: getDeepResearchModelConfig(),
    budgets: getDeepResearchBudgets(),
  };
}

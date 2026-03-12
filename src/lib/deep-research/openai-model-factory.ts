import {
  AIMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import type { z } from "zod";

import type { DeepResearchModelConfig } from "@/lib/deep-research/types";

export type DeepResearchModelRole =
  | "summarization"
  | "research"
  | "compression"
  | "finalReport";

export interface DeepResearchModelFactory {
  invokeStructured<T>(
    role: DeepResearchModelRole,
    schema: z.ZodType<T>,
    messages: BaseMessage[],
  ): Promise<T>;
  invokeWithTools(
    role: DeepResearchModelRole,
    tools: unknown[],
    messages: BaseMessage[],
  ): Promise<AIMessage>;
  invokeText(
    role: DeepResearchModelRole,
    messages: BaseMessage[],
  ): Promise<AIMessage>;
}

interface RateLimitRetryContext {
  role: DeepResearchModelRole;
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage: string;
}

interface OpenAIDeepResearchModelFactoryOptions {
  onRateLimitRetry?: (context: RateLimitRetryContext) => Promise<void> | void;
}

const RATE_LIMIT_MAX_ATTEMPTS = 5;

function isRateLimitError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : Number.NaN;

  return (
    status === 429 ||
    message.includes("rate limit") ||
    message.includes("tokens per min") ||
    message.includes("tpm")
  );
}

function extractRetryDelayMs(error: unknown, attempt: number) {
  const message = error instanceof Error ? error.message : "";
  const retryMatch = message.match(/try again in\s+(\d+)(ms|s)/i);

  if (retryMatch) {
    const value = Number.parseInt(retryMatch[1] ?? "0", 10);
    if (Number.isFinite(value) && value > 0) {
      const multiplier = retryMatch[2]?.toLowerCase() === "s" ? 1000 : 1;
      return value * multiplier + 100 * attempt;
    }
  }

  return Math.min(4000, 400 * 2 ** attempt);
}

function sleep(delayMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function invokeWithRateLimitRetry<T>(
  role: DeepResearchModelRole,
  operation: () => Promise<T>,
  options?: OpenAIDeepResearchModelFactoryOptions,
) {
  for (let attempt = 0; attempt < RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRateLimitError(error) || attempt === RATE_LIMIT_MAX_ATTEMPTS - 1) {
        throw error;
      }

      const delayMs = extractRetryDelayMs(error, attempt);
      await options?.onRateLimitRetry?.({
        role,
        attempt: attempt + 1,
        maxAttempts: RATE_LIMIT_MAX_ATTEMPTS,
        delayMs,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await sleep(delayMs);
    }
  }

  throw new Error("Exceeded the maximum rate-limit retry attempts.");
}

function createModel(
  role: DeepResearchModelRole,
  modelConfig: DeepResearchModelConfig,
  apiKey: string,
) {
  const model =
    role === "summarization"
      ? modelConfig.summarizationModel
      : role === "research"
        ? modelConfig.researchModel
        : role === "compression"
          ? modelConfig.compressionModel
          : modelConfig.finalReportModel;

  const maxTokens =
    role === "summarization"
      ? modelConfig.summarizationModelMaxTokens
      : role === "research"
        ? modelConfig.researchModelMaxTokens
        : role === "compression"
          ? modelConfig.compressionModelMaxTokens
          : modelConfig.finalReportModelMaxTokens;

  return new ChatOpenAI({
    apiKey,
    model,
    temperature: 0,
    maxTokens,
    maxRetries: 2,
  });
}

export class OpenAIDeepResearchModelFactory
  implements DeepResearchModelFactory
{
  constructor(
    private readonly modelConfig: DeepResearchModelConfig,
    private readonly apiKey: string,
    private readonly options?: OpenAIDeepResearchModelFactoryOptions,
  ) {}

  async invokeStructured<T>(
    role: DeepResearchModelRole,
    schema: z.ZodType<T>,
    messages: BaseMessage[],
  ) {
    const runnable = createModel(role, this.modelConfig, this.apiKey)
      .withStructuredOutput(schema);
    return invokeWithRateLimitRetry(
      role,
      () => runnable.invoke(messages) as Promise<T>,
      this.options,
    );
  }

  async invokeWithTools(
    role: DeepResearchModelRole,
    tools: unknown[],
    messages: BaseMessage[],
  ) {
    const runnable = createModel(role, this.modelConfig, this.apiKey)
      .bindTools(tools as never[]);
    return invokeWithRateLimitRetry(
      role,
      () => runnable.invoke(messages) as Promise<AIMessage>,
      this.options,
    );
  }

  async invokeText(role: DeepResearchModelRole, messages: BaseMessage[]) {
    return invokeWithRateLimitRetry(
      role,
      () =>
        createModel(role, this.modelConfig, this.apiKey).invoke(
          messages,
        ) as Promise<AIMessage>,
      this.options,
    );
  }
}

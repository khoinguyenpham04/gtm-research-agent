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
  ) {}

  async invokeStructured<T>(
    role: DeepResearchModelRole,
    schema: z.ZodType<T>,
    messages: BaseMessage[],
  ) {
    const runnable = createModel(role, this.modelConfig, this.apiKey)
      .withStructuredOutput(schema);
    return runnable.invoke(messages) as Promise<T>;
  }

  async invokeWithTools(
    role: DeepResearchModelRole,
    tools: unknown[],
    messages: BaseMessage[],
  ) {
    const runnable = createModel(role, this.modelConfig, this.apiKey)
      .bindTools(tools as never[]);
    return runnable.invoke(messages) as Promise<AIMessage>;
  }

  async invokeText(role: DeepResearchModelRole, messages: BaseMessage[]) {
    return createModel(role, this.modelConfig, this.apiKey).invoke(
      messages,
    ) as Promise<AIMessage>;
  }
}

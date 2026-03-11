import { Output, generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { ZodSchema } from 'zod';

// Worker model: fast, cheap — used for page summarisation, query execution, drafting
const RESEARCH_WORKER_MODEL = process.env.RESEARCH_WORKER_MODEL?.trim() || process.env.RESEARCH_MODEL?.trim() || 'gpt-4o-mini';

// Orchestrator model: smarter — used for brief building, evidence reflection, synthesis, verification
const RESEARCH_ORCHESTRATOR_MODEL = process.env.RESEARCH_ORCHESTRATOR_MODEL?.trim() || 'gpt-4.1';

function getWorkerModel() {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error('Missing OPENAI_API_KEY.');
  }
  return openai(RESEARCH_WORKER_MODEL);
}

function getOrchestratorModel() {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error('Missing OPENAI_API_KEY.');
  }
  return openai(RESEARCH_ORCHESTRATOR_MODEL);
}

export async function generateStructuredOutput<T>({
  prompt,
  schema,
  system,
}: {
  prompt: string;
  schema: ZodSchema<T>;
  system?: string;
}) {
  const { output } = await generateText({
    model: getWorkerModel(),
    system,
    output: Output.object({
      schema,
    }),
    prompt,
  });

  return output;
}

export async function generateStructuredOutputOrchestrator<T>({
  prompt,
  schema,
  system,
}: {
  prompt: string;
  schema: ZodSchema<T>;
  system?: string;
}) {
  const { output } = await generateText({
    model: getOrchestratorModel(),
    system,
    output: Output.object({
      schema,
    }),
    prompt,
  });

  return output;
}

export async function generateTextOutput({
  prompt,
  system,
  maxOutputTokens,
}: {
  prompt: string;
  system?: string;
  maxOutputTokens?: number;
}) {
  const { text } = await generateText({
    model: getWorkerModel(),
    system,
    prompt,
    maxOutputTokens,
  });

  return text;
}

export async function generateTextOutputOrchestrator({
  prompt,
  system,
  maxOutputTokens,
}: {
  prompt: string;
  system?: string;
  maxOutputTokens?: number;
}) {
  const { text } = await generateText({
    model: getOrchestratorModel(),
    system,
    prompt,
    maxOutputTokens,
  });

  return text;
}

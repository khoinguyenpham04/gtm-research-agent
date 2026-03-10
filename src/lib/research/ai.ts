import { Output, generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { ZodSchema } from 'zod';

const RESEARCH_MODEL = process.env.RESEARCH_MODEL?.trim() || 'gpt-4o-mini';

function getModel() {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error('Missing OPENAI_API_KEY.');
  }

  return openai(RESEARCH_MODEL);
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
    model: getModel(),
    system,
    output: Output.object({
      schema,
    }),
    prompt,
  });

  return output;
}

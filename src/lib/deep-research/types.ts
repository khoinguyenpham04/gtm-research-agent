import { z } from "zod";

import type { DocumentSummary } from "@/lib/documents";

export const deepResearchRunStatusValues = [
  "queued",
  "running",
  "needs_clarification",
  "completed",
  "failed",
  "timed_out",
] as const;

export type DeepResearchRunStatus =
  (typeof deepResearchRunStatusValues)[number];

export const deepResearchRunStatusSchema = z.enum(deepResearchRunStatusValues);

export const deepResearchModelConfigSchema = z.object({
  summarizationModel: z.string().min(1),
  summarizationModelMaxTokens: z.number().int().positive(),
  researchModel: z.string().min(1),
  researchModelMaxTokens: z.number().int().positive(),
  compressionModel: z.string().min(1),
  compressionModelMaxTokens: z.number().int().positive(),
  finalReportModel: z.string().min(1),
  finalReportModelMaxTokens: z.number().int().positive(),
  maxStructuredOutputRetries: z.number().int().positive(),
  maxContentLength: z.number().int().positive(),
});

export type DeepResearchModelConfig = z.infer<
  typeof deepResearchModelConfigSchema
>;

export const deepResearchBudgetsSchema = z.object({
  maxConcurrentResearchUnits: z.number().int().positive(),
  maxResearcherIterations: z.number().int().positive(),
  maxReactToolCalls: z.number().int().positive(),
});

export type DeepResearchBudgets = z.infer<typeof deepResearchBudgetsSchema>;

export const createDeepResearchRunRequestSchema = z.object({
  topic: z.string().trim().min(1, "Topic is required."),
  objective: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
  selectedDocumentIds: z
    .array(z.string().trim().min(1))
    .min(1, "Select at least one document."),
});

export type CreateDeepResearchRunRequest = z.infer<
  typeof createDeepResearchRunRequestSchema
>;

export const resumeDeepResearchRunRequestSchema = z.object({
  clarificationResponse: z
    .string()
    .trim()
    .min(1, "Clarification response is required."),
});

export type ResumeDeepResearchRunRequest = z.infer<
  typeof resumeDeepResearchRunRequestSchema
>;

export interface DeepResearchRunEvent {
  id: string;
  runId: string;
  stage: string;
  eventType: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface DeepResearchRunRecord {
  id: string;
  thread_id: string;
  topic: string;
  objective: string | null;
  status: DeepResearchRunStatus;
  clarification_question: string | null;
  final_report_markdown: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  last_progress_at: string | null;
}

export interface DeepResearchRunResponse {
  id: string;
  status: DeepResearchRunStatus;
  topic: string;
  objective?: string;
  clarificationQuestion?: string;
  selectedDocuments: DocumentSummary[];
  events: DeepResearchRunEvent[];
  finalReportMarkdown?: string;
  errorMessage?: string;
  updatedAt: string;
  createdAt: string;
}

export interface DeepResearchRuntimeConfig {
  threadId: string;
  selectedDocumentIds: string[];
  openAiApiKey: string;
  tavilyApiKey?: string;
  modelConfig: DeepResearchModelConfig;
  budgets: DeepResearchBudgets;
}

export const clarifyWithUserSchema = z.object({
  needClarification: z.boolean(),
  question: z.string(),
  verification: z.string(),
});

export type ClarifyWithUserResult = z.infer<typeof clarifyWithUserSchema>;

export const researchQuestionSchema = z.object({
  researchBrief: z.string().min(1),
});

export type ResearchQuestionResult = z.infer<typeof researchQuestionSchema>;

export const summarySchema = z.object({
  summary: z.string(),
  keyExcerpts: z.string(),
});

export type SummaryResult = z.infer<typeof summarySchema>;

export const clarificationInterruptSchema = z.object({
  type: z.literal("clarification"),
  question: z.string().min(1),
});

export type ClarificationInterrupt = z.infer<
  typeof clarificationInterruptSchema
>;

export interface SearchMatch {
  id: number;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

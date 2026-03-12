import { z } from "zod";

import type { DocumentSummary } from "@/lib/documents";
import type { WorkspaceSummary } from "@/lib/workspaces";

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

export const researchModeValues = ["gtm", "general", "other"] as const;
export type ResearchMode = (typeof researchModeValues)[number];
export const researchModeSchema = z.enum(researchModeValues);

export const preResearchPlanSchema = z.object({
  mode: researchModeSchema,
  coreQuestions: z.array(z.string().trim().min(1)).min(3).max(8),
  requiredEvidenceCategories: z
    .array(z.string().trim().min(1))
    .min(3)
    .max(8),
  gtmSubquestions: z.array(z.string().trim().min(1)).max(8).default([]),
  documentResearchPriorities: z
    .array(z.string().trim().min(1))
    .max(5)
    .default([]),
});

export type PreResearchPlan = z.infer<typeof preResearchPlanSchema>;

export const sectionSupportValues = ["strong", "weak", "missing"] as const;
export type SectionSupportLevel = (typeof sectionSupportValues)[number];
export const sectionSupportSchema = z.enum(sectionSupportValues);

export const sourceTierValues = [
  "selected_document",
  "primary",
  "analyst",
  "trade_press",
  "vendor",
  "blog",
  "unknown",
] as const;
export type SourceTier = (typeof sourceTierValues)[number];
export const sourceTierSchema = z.enum(sourceTierValues);

export const evidenceSourceTypeValues = [
  "uploaded_document",
  "web",
  "unknown",
] as const;
export type EvidenceSourceType = (typeof evidenceSourceTypeValues)[number];
export const evidenceSourceTypeSchema = z.enum(evidenceSourceTypeValues);

export const evidenceClaimTypeValues = [
  "market_stat",
  "pricing_signal",
  "competitor_fact",
  "risk",
  "compliance",
  "recommendation",
  "qualitative_insight",
  "other",
] as const;
export type EvidenceClaimType = (typeof evidenceClaimTypeValues)[number];
export const evidenceClaimTypeSchema = z.enum(evidenceClaimTypeValues);

export const evidenceConfidenceValues = ["high", "medium", "low"] as const;
export type EvidenceConfidence = (typeof evidenceConfidenceValues)[number];
export const evidenceConfidenceSchema = z.enum(evidenceConfidenceValues);

export const sectionEvidenceRoleValues = ["primary", "supporting"] as const;
export type SectionEvidenceRole = (typeof sectionEvidenceRoleValues)[number];
export const sectionEvidenceRoleSchema = z.enum(sectionEvidenceRoleValues);

export const reportPlanSectionSchema = z.object({
  key: z.string().trim().min(1),
  title: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  relevanceReason: z.string().trim().optional(),
});

export type ReportPlanSection = z.infer<typeof reportPlanSectionSchema>;

export const reportPlanSchema = z.object({
  mode: researchModeSchema,
  sections: z.array(reportPlanSectionSchema).min(1),
  fallbackRule: z.string().trim().min(1),
  plannerType: z.string().trim().min(1),
  reportPlanVersion: z.number().int().positive(),
});

export type ReportPlan = z.infer<typeof reportPlanSchema>;

export const sectionSupportEntrySchema = z.object({
  key: z.string().trim().min(1),
  support: sectionSupportSchema,
  reason: z.string().trim().optional(),
  evidenceCount: z.number().int().min(0).optional(),
  topSourceTier: sourceTierSchema.optional(),
});

export type SectionSupport = z.infer<typeof sectionSupportEntrySchema>;
export type SectionValidation = SectionSupport;

export const sectionSupportResultSchema = z.object({
  sectionSupport: z.array(sectionSupportEntrySchema),
});

export type SectionSupportResult = z.infer<typeof sectionSupportResultSchema>;

export const candidateEvidenceRowSchema = z.object({
  claim: z.string().trim().min(1),
  claimType: evidenceClaimTypeSchema,
  value: z.string().trim().min(1),
  unit: z.string().trim().optional(),
  entity: z.string().trim().optional(),
  segment: z.string().trim().optional(),
  geography: z.string().trim().optional(),
  timeframe: z.string().trim().optional(),
  sourceType: evidenceSourceTypeSchema,
  sourceTier: sourceTierSchema,
  sourceTitle: z.string().trim().optional(),
  sourceUrl: z.string().trim().url().optional(),
  documentId: z.string().trim().optional(),
  chunkIndex: z.number().int().nonnegative().optional(),
  confidence: evidenceConfidenceSchema,
  conflictGroup: z.string().trim().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type CandidateEvidenceRow = z.infer<typeof candidateEvidenceRowSchema>;

export const evidenceRowSchema = candidateEvidenceRowSchema.extend({
  id: z.string().trim().min(1),
  allowedForFinal: z.boolean().optional(),
  resolutionId: z.string().trim().optional(),
});

export type EvidenceRow = z.infer<typeof evidenceRowSchema>;

export const evidenceResolutionSchema = z.object({
  id: z.string().trim().min(1),
  runId: z.string().trim().min(1),
  conflictGroup: z.string().trim().min(1),
  winningEvidenceRowIds: z.array(z.string().trim().min(1)).min(1),
  discardedEvidenceRowIds: z.array(z.string().trim().min(1)),
  resolutionNote: z.string().trim().min(1),
  resolvedBy: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
});

export type EvidenceResolution = z.infer<typeof evidenceResolutionSchema>;

export const sectionEvidenceLinkSchema = z.object({
  sectionKey: z.string().trim().min(1),
  evidenceRowId: z.string().trim().min(1),
  role: sectionEvidenceRoleSchema,
});

export type SectionEvidenceLink = z.infer<typeof sectionEvidenceLinkSchema>;

export const sectionPackFactOriginValues = [
  "validated_evidence",
  "anchored_fact",
] as const;
export type SectionPackFactOrigin =
  (typeof sectionPackFactOriginValues)[number];
export const sectionPackFactOriginSchema = z.enum(sectionPackFactOriginValues);

export const sectionPackFactSchema = z.object({
  statement: z.string().trim().min(1),
  factOrigin: sectionPackFactOriginSchema,
  evidenceRowIds: z.array(z.string().trim().min(1)).default([]),
  anchoredFactIds: z.array(z.string().trim().min(1)).default([]),
  sourceTier: sourceTierSchema,
  sourceType: evidenceSourceTypeSchema,
  sourceTitle: z.string().trim().optional(),
  sourceUrl: z.string().trim().url().optional(),
  documentId: z.string().trim().optional(),
  chunkIndex: z.number().int().nonnegative().optional(),
});

export type SectionPackFact = z.infer<typeof sectionPackFactSchema>;

export const sectionEvidencePackSchema = z.object({
  sectionKey: z.string().trim().min(1),
  title: z.string().trim().min(1),
  support: sectionSupportSchema,
  facts: z.array(sectionPackFactSchema),
  assumptions: z.array(z.string().trim().min(1)).default([]),
  estimates: z.array(z.string().trim().min(1)).default([]),
  gaps: z.array(z.string().trim().min(1)).default([]),
});

export type SectionEvidencePack = z.infer<typeof sectionEvidencePackSchema>;

export const evidenceExtractionSchema = z.object({
  rows: z.array(candidateEvidenceRowSchema).max(30),
});

export type EvidenceExtractionResult = z.infer<typeof evidenceExtractionSchema>;

export const gtmCoverageCategoryValues = [
  "market_size_inputs",
  "adoption",
  "buyers",
  "competitors_pricing",
  "compliance",
  "recommendations",
] as const;
export type GtmCoverageCategoryKey =
  (typeof gtmCoverageCategoryValues)[number];
export const gtmCoverageCategorySchema = z.enum(gtmCoverageCategoryValues);

export const coverageStatusValues = [
  "missing",
  "partial",
  "anchored",
  "exhausted",
] as const;
export type CoverageStatus = (typeof coverageStatusValues)[number];
export const coverageStatusSchema = z.enum(coverageStatusValues);

export const anchoredFactStrengthValues = [
  "weak",
  "moderate",
  "strong",
] as const;
export type AnchoredFactStrength = (typeof anchoredFactStrengthValues)[number];
export const anchoredFactStrengthSchema = z.enum(anchoredFactStrengthValues);

export const coverageBoardEntrySchema = z.object({
  key: gtmCoverageCategorySchema,
  status: coverageStatusSchema,
  documentHits: z.number().int().nonnegative(),
  webHits: z.number().int().nonnegative(),
  sourceTiersSeen: z.array(sourceTierSchema),
  notes: z.array(z.string().trim().min(1)).default([]),
  gapFillAttempts: z.number().int().nonnegative(),
});

export type CoverageBoardEntry = z.infer<typeof coverageBoardEntrySchema>;

export const gapFillStatsSchema = z.object({
  totalAttempts: z.number().int().nonnegative(),
  attemptsByCategory: z.object({
    market_size_inputs: z.number().int().nonnegative(),
    adoption: z.number().int().nonnegative(),
    buyers: z.number().int().nonnegative(),
    competitors_pricing: z.number().int().nonnegative(),
    compliance: z.number().int().nonnegative(),
    recommendations: z.number().int().nonnegative(),
  }),
});

export type GapFillStats = z.infer<typeof gapFillStatsSchema>;

export const anchoredFactSchema = z.object({
  id: z.string().trim().min(1),
  statement: z.string().trim().min(1),
  claimType: evidenceClaimTypeSchema,
  sourceType: evidenceSourceTypeSchema,
  sourceTier: sourceTierSchema,
  sourceTitle: z.string().trim().optional(),
  sourceUrl: z.string().trim().url().optional(),
  documentId: z.string().trim().optional(),
  chunkIndex: z.number().int().nonnegative().optional(),
  targetCategoryKeys: z.array(gtmCoverageCategorySchema).default([]),
  evidenceCategoryKeys: z.array(gtmCoverageCategorySchema).default([]),
  numericValue: z.number().optional(),
  unit: z.string().trim().optional(),
  timeframe: z.string().trim().optional(),
  entity: z.string().trim().optional(),
  strength: anchoredFactStrengthSchema,
});

export type AnchoredFact = z.infer<typeof anchoredFactSchema>;

export const documentSearchArtifactSchema = z.object({
  queries: z.array(z.string().trim().min(1)).min(1),
  matches: z.array(
    z.object({
      id: z.number().int(),
      excerpt: z.string().trim().min(1),
      similarity: z.number(),
      documentId: z.string().trim().optional(),
      chunkIndex: z.number().int().nonnegative().optional(),
      fileName: z.string().trim().optional(),
      fileUrl: z.string().trim().url().optional(),
    }),
  ),
});

export type DocumentSearchArtifact = z.infer<typeof documentSearchArtifactSchema>;

export const tavilySearchArtifactSchema = z.object({
  queries: z.array(z.string().trim().min(1)).min(1),
  results: z.array(
    z.object({
      title: z.string().trim().min(1),
      url: z.string().trim().url(),
      excerpt: z.string().trim().min(1),
      sourceTier: sourceTierSchema,
    }),
  ),
});

export type TavilySearchArtifact = z.infer<typeof tavilySearchArtifactSchema>;

export const gapFillQuerySuggestionSchema = z.object({
  query: z.string().trim().min(1).max(500),
  intendedCategories: z.array(gtmCoverageCategorySchema).max(3).default([]),
});

export type GapFillQuerySuggestion = z.infer<
  typeof gapFillQuerySuggestionSchema
>;

export const gapFillQueryPlanSchema = z.object({
  queries: z.array(gapFillQuerySuggestionSchema).min(1).max(3),
});

export type GapFillQueryPlan = z.infer<typeof gapFillQueryPlanSchema>;

export const searchToolEnvelopeSchema = z.discriminatedUnion("toolName", [
  z.object({
    toolName: z.literal("selectedDocumentsSearch"),
    renderedText: z.string(),
    artifact: documentSearchArtifactSchema,
  }),
  z.object({
    toolName: z.literal("tavilySearch"),
    renderedText: z.string(),
    artifact: tavilySearchArtifactSchema,
  }),
]);

export type SearchToolEnvelope = z.infer<typeof searchToolEnvelopeSchema>;

export const evidenceConflictResolutionSchema = z.object({
  resolutions: z
    .array(
      z.object({
        conflictGroup: z.string().trim().min(1),
        winningEvidenceRowIds: z.array(z.string().trim().min(1)).min(1),
        discardedEvidenceRowIds: z.array(z.string().trim().min(1)),
        resolutionNote: z.string().trim().min(1),
        resolvedBy: z.string().trim().min(1),
      }),
    )
    .max(20),
});

export type EvidenceConflictResolutionResult = z.infer<
  typeof evidenceConflictResolutionSchema
>;

export const evidenceValidationSchema = z.object({
  allowedEvidenceRowIds: z.array(z.string().trim().min(1)),
  sectionSupport: z.array(sectionSupportEntrySchema),
  sectionEvidenceLinks: z.array(sectionEvidenceLinkSchema).max(100),
});

export type EvidenceValidationResult = z.infer<typeof evidenceValidationSchema>;

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
  maxTargetedWebGapFillAttemptsPerCategory: z.number().int().positive(),
  maxTargetedWebGapFillAttemptsPerRun: z.number().int().positive(),
});

export type DeepResearchBudgets = z.infer<typeof deepResearchBudgetsSchema>;

export const createDeepResearchRunRequestSchema = z.object({
  workspaceId: z.string().trim().min(1, "Workspace is required."),
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
  workspace_id: string | null;
  planner_type: string | null;
  report_plan_version: number | null;
  report_plan_json: ReportPlan | null;
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
  workspaceId?: string;
  workspace?: WorkspaceSummary;
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

export interface DeepResearchRunSummary {
  id: string;
  status: DeepResearchRunStatus;
  workspaceId?: string;
  workspace?: WorkspaceSummary;
  topic: string;
  objective?: string;
  errorMessage?: string;
  updatedAt: string;
  createdAt: string;
}

export interface DeepResearchRunEvidenceResponse {
  runId: string;
  reportPlan?: ReportPlan;
  sectionSupport: SectionValidation[];
  evidenceRows: EvidenceRow[];
  evidenceResolutions: EvidenceResolution[];
  sectionEvidenceLinks: SectionEvidenceLink[];
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

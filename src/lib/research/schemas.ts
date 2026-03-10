import { z } from 'zod';

export const researchRunStatusValues = [
  'queued',
  'planning',
  'searching',
  'retrieving',
  'drafting',
  'verifying',
  'completed',
  'failed',
] as const;

export const researchStageValues = [
  'plan',
  'web_search',
  'mock_document_retrieval',
  'draft_report',
  'verification',
  'finalize',
] as const;

export const confidenceValues = ['high', 'medium', 'low'] as const;
export const findingStatusValues = ['draft', 'verified', 'needs-review'] as const;
export const sourceCategoryValues = ['official', 'research', 'vendor', 'media', 'blog', 'community'] as const;
export const sourceQualityLabelValues = ['high', 'medium', 'low'] as const;
export const sourceRecencyValues = ['current', 'recent', 'dated', 'historical', 'unknown'] as const;
export const searchIntentValues = [
  'market-size',
  'adoption',
  'competitor-features',
  'pricing',
  'buyer-pain',
  'gtm-channels',
] as const;
export const finalReportSectionKeyValues = [
  'market-landscape',
  'icp-and-buyer',
  'competitor-landscape',
  'pricing-and-packaging',
  'gtm-motion',
  'risks-and-unknowns',
  'recommendation',
] as const;

export const createResearchRunInputSchema = z.object({
  topic: z.string().trim().min(3, 'Topic must be at least 3 characters long.'),
  objective: z.string().trim().max(1000).optional().transform((value) => value || undefined),
  selectedDocumentIds: z.array(z.string().trim().min(1)).max(20).optional().default([]),
});

export const plannedSectionSchema = z.object({
  key: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
});

export const searchIntentSchema = z.enum(searchIntentValues);

export const plannedSearchQuerySchema = z.object({
  intent: searchIntentSchema,
  query: z.string().trim().min(1),
  sourcePreference: z.enum(['primary', 'mixed', 'commercial']),
});

export const researchPlanSchema = z.object({
  researchQuestions: z.array(z.string().trim().min(1)).min(3).max(5),
  searchQueries: z.array(plannedSearchQuerySchema).length(6),
  sections: z.array(plannedSectionSchema).length(4),
});

export const normalizedWebSourceSchema = z.object({
  title: z.string().trim().min(1),
  url: z.string().trim().url().nullable(),
  snippet: z.string().trim().min(1),
  query: z.string().trim().min(1),
  queryIntent: searchIntentSchema,
  domain: z.string().trim().nullable(),
});

export const scoredSourceSchema = normalizedWebSourceSchema.extend({
  id: z.string(),
  sourceType: z.literal('web'),
  sourceCategory: z.enum(sourceCategoryValues),
  qualityScore: z.number().min(0).max(1),
  qualityLabel: z.enum(sourceQualityLabelValues),
  recency: z.enum(sourceRecencyValues),
  publishedYear: z.number().int().nullable(),
  rationale: z.string().trim().min(1),
  isPrimary: z.boolean(),
});

export const linkedDocumentSchema = z.object({
  id: z.string(),
  documentExternalId: z.string(),
  fileName: z.string().nullable(),
});

export const documentContextSchema = z.object({
  documentExternalId: z.string(),
  fileName: z.string().nullable(),
  summary: z.string(),
});

export const citationSchema = z.object({
  sourceId: z.string(),
  title: z.string(),
  url: z.string().nullable(),
});

export const researchFindingSchema = z.object({
  sectionKey: z.string().trim().min(1),
  claim: z.string().trim().min(1),
  evidence: z.array(citationSchema).min(1),
  confidence: z.enum(confidenceValues),
  status: z.enum(findingStatusValues),
  verificationNotes: z.string().trim(),
  gaps: z.array(z.string()),
});

export const draftReportSectionSchema = z.object({
  sectionKey: z.string().trim().min(1),
  title: z.string().trim().min(1),
  contentMarkdown: z.string().trim().min(1),
  citations: z.array(z.string()),
});

export const draftReportSchema = z.object({
  executiveSummary: z.string().trim().min(1),
  findings: z.array(researchFindingSchema).min(1),
  sections: z.array(draftReportSectionSchema).min(1),
});

export const finalReportSectionKeySchema = z.enum(finalReportSectionKeyValues);

export const finalReportSectionSchema = z.object({
  title: z.string().trim().min(1),
  contentMarkdown: z.string().trim().min(1),
  citations: z.array(z.string()),
});

export const competitorMatrixEntrySchema = z.object({
  vendor: z.string().trim().min(1),
  icp: z.string().trim().min(1),
  coreFeatures: z.array(z.string().trim().min(1)).min(1),
  crmIntegrations: z.array(z.string().trim().min(1)),
  pricingEvidence: z.string().trim().min(1),
  targetSegment: z.string().trim().min(1),
  confidence: z.enum(confidenceValues),
});

export const verifiedFindingSchema = researchFindingSchema.extend({
  sectionKey: finalReportSectionKeySchema,
  status: z.enum(['verified', 'needs-review']),
});

export const verifiedReportSchema = z.object({
  executiveSummary: z.string().trim().min(1),
  keyTakeaways: z.array(z.string().trim().min(1)).min(3).max(5),
  findings: z.array(verifiedFindingSchema).min(4),
  competitorMatrix: z.array(competitorMatrixEntrySchema).min(2).max(6),
  sections: z.object({
    marketLandscape: finalReportSectionSchema,
    icpAndBuyer: finalReportSectionSchema,
    competitorLandscape: finalReportSectionSchema,
    pricingAndPackaging: finalReportSectionSchema,
    gtmMotion: finalReportSectionSchema,
    risksAndUnknowns: finalReportSectionSchema,
    recommendation: finalReportSectionSchema,
  }),
});

export const researchGraphStateSchema = z.object({
  runId: z.string().uuid(),
  topic: z.string(),
  objective: z.string().optional(),
  selectedDocumentIds: z.array(z.string()),
  linkedDocuments: z.array(linkedDocumentSchema).default([]),
  plan: researchPlanSchema.nullable().default(null),
  webSources: z.array(scoredSourceSchema).default([]),
  documentContext: z.array(documentContextSchema).default([]),
  findings: z.array(researchFindingSchema).default([]),
  reportSections: z.array(draftReportSectionSchema).default([]),
  finalReportMarkdown: z.string().nullable().default(null),
  status: z.enum(researchRunStatusValues),
  currentStage: z.string(),
});

export type CreateResearchRunInput = z.infer<typeof createResearchRunInputSchema>;
export type ResearchRunStatus = (typeof researchRunStatusValues)[number];
export type ResearchStage = (typeof researchStageValues)[number];
export type ResearchPlan = z.infer<typeof researchPlanSchema>;
export type SearchIntent = z.infer<typeof searchIntentSchema>;
export type PlannedSearchQuery = z.infer<typeof plannedSearchQuerySchema>;
export type NormalizedWebSource = z.infer<typeof normalizedWebSourceSchema>;
export type ScoredSource = z.infer<typeof scoredSourceSchema>;
export type LinkedDocument = z.infer<typeof linkedDocumentSchema>;
export type DocumentContext = z.infer<typeof documentContextSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type ResearchFinding = z.infer<typeof researchFindingSchema>;
export type DraftReportSection = z.infer<typeof draftReportSectionSchema>;
export type DraftReport = z.infer<typeof draftReportSchema>;
export type VerifiedFinding = z.infer<typeof verifiedFindingSchema>;
export type CompetitorMatrixEntry = z.infer<typeof competitorMatrixEntrySchema>;
export type VerifiedReport = z.infer<typeof verifiedReportSchema>;
export type ResearchGraphState = z.infer<typeof researchGraphStateSchema>;

export interface ResearchRunSnapshot {
  run: {
    id: string;
    topic: string;
    objective: string | null;
    status: ResearchRunStatus;
    currentStage: string;
    planJson: ResearchPlan | null;
    finalReportMarkdown: string | null;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
  };
  linkedDocuments: LinkedDocument[];
  sources: Array<{
    id: string;
    sourceType: string;
    title: string;
    url: string | null;
    snippet: string | null;
    metadataJson: Record<string, unknown>;
    createdAt: string;
  }>;
  findings: Array<{
    id: string;
    sectionKey: string;
    claim: string;
    evidenceJson: Citation[];
    confidence: ResearchFinding['confidence'];
    status: string;
    verificationNotes: string;
    gapsJson: string[];
    createdAt: string;
  }>;
  reportSections: Array<{
    id: string;
    sectionKey: string;
    title: string;
    contentMarkdown: string;
    citationsJson: string[];
    createdAt: string;
  }>;
}

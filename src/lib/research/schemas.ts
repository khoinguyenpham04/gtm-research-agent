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
  'document_retrieval',
  'draft_report',
  'verification',
  'finalize',
] as const;
export const researchEngineVersionValues = ['v1', 'v2', 'v3'] as const;

export const confidenceValues = ['high', 'medium', 'low'] as const;
export const findingStatusValues = ['draft', 'verified', 'needs-review'] as const;
export const sectionStatusValues = ['ready', 'needs-review', 'insufficient_evidence'] as const;
export const sourceCategoryValues = ['official', 'research', 'vendor', 'media', 'blog', 'community'] as const;
export const sourceQualityLabelValues = ['high', 'medium', 'low'] as const;
export const sourceRecencyValues = ['current', 'recent', 'dated', 'historical', 'unknown'] as const;
export const evidenceSourceTypeValues = ['web', 'document'] as const;
export const retrievalCandidateSourceTypeValues = ['web', 'document'] as const;
export const retrieverTypeValues = ['web_search', 'dense', 'lexical', 'fusion'] as const;
export const claimTypeValues = [
  'market-sizing',
  'adoption-signal',
  'buyer-pain',
  'competitor-feature',
  'pricing',
  'gtm-channel',
  'risk',
  'recommendation-input',
] as const;
export const evidenceModeValues = [
  'market-adjacent',
  'product-specific',
  'vendor-primary',
  'independent-validation',
  'document-internal',
] as const;
export const inferenceLabelValues = ['direct', 'inferred', 'speculative'] as const;
export const vendorPageTypeValues = [
  'product',
  'pricing',
  'docs',
  'newsroom',
  'comparison',
  'unknown',
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
export const searchIntentValues = [
  'market-size',
  'adoption',
  'competitor-features',
  'pricing',
  'buyer-pain',
  'gtm-channels',
] as const;
export const sourcePreferenceValues = ['primary', 'mixed', 'commercial'] as const;
export const coverageStatusValues = [
  'unstarted',
  'in_progress',
  'satisfied',
  'needs_repair',
  'insufficient_evidence',
] as const;
export const researchTaskTypeValues = [
  'web_gap',
  'vendor_gap',
  'document_gap',
  'contradiction_check',
  'vendor_profile',
  'vendor_pricing',
  'buyer_research',
  'market_research',
  'gtm_research',
  'risk_research',
] as const;
export const researchTaskResultStatusValues = ['completed', 'no_new_evidence', 'failed'] as const;
export const pauseStateStatusValues = ['running', 'awaiting_user', 'failed'] as const;
export const finalReportSectionKeySchema = z.enum(finalReportSectionKeyValues);
export const claimTypeSchema = z.enum(claimTypeValues);
export const evidenceModeSchema = z.enum(evidenceModeValues);
export const inferenceLabelSchema = z.enum(inferenceLabelValues);
export const vendorPageTypeSchema = z.enum(vendorPageTypeValues);
export const sourcePreferenceSchema = z.enum(sourcePreferenceValues);

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
  sectionKey: finalReportSectionKeySchema,
  subtopic: z.string().trim().min(1),
  query: z.string().trim().min(1),
  sourcePreference: sourcePreferenceSchema,
  claimType: claimTypeSchema,
  evidenceMode: evidenceModeSchema,
  vendorTarget: z.string().trim().min(1).nullable(),
});

export const researchBriefSchema = z.object({
  topic: z.string().trim().min(1),
  productCategory: z.string().trim().min(1).nullable(),
  targetBuyer: z.string().trim().min(1).nullable(),
  companyType: z.string().trim().min(1).nullable(),
  geo: z.string().trim().min(1).nullable(),
  timeHorizon: z.string().trim().min(1).nullable(),
  knownVendors: z.array(z.string().trim().min(1)).default([]),
  coreUnknowns: z.array(z.string().trim().min(1)).default([]),
  clarificationNeeded: z.boolean().default(false),
});

export const coveragePlanSectionSchema = z.object({
  requiredEvidenceBuckets: z.array(z.string().trim().min(1)).min(1),
  minStrongEvidence: z.number().int().min(0),
  preferredSourceTypes: z.array(sourcePreferenceSchema).min(1),
  repairPriority: z.number().int().min(1).max(5),
});

export const coveragePlanSchema = z.object({
  'market-landscape': coveragePlanSectionSchema,
  'icp-and-buyer': coveragePlanSectionSchema,
  'competitor-landscape': coveragePlanSectionSchema,
  'pricing-and-packaging': coveragePlanSectionSchema,
  'gtm-motion': coveragePlanSectionSchema,
  'risks-and-unknowns': coveragePlanSectionSchema,
  recommendation: coveragePlanSectionSchema,
});

export const queryStrategySchema = z.object({
  seedQueries: z.array(plannedSearchQuerySchema).default([]),
  sourcePreferenceBySection: z.record(z.string(), sourcePreferenceSchema).default({}),
  notes: z.array(z.string().trim().min(1)).default([]),
});

export const repairHistoryEntrySchema = z.object({
  iteration: z.number().int().min(0),
  taskId: z.string().trim().min(1),
  sectionKey: finalReportSectionKeySchema,
  taskType: z.enum(researchTaskTypeValues),
  result: z.enum(researchTaskResultStatusValues),
  selectedEvidenceDelta: z.number().int().min(0).default(0),
  improved: z.boolean().default(false),
  note: z.string().trim().min(1).nullable().default(null),
});

export const researchPlanSchema = z.object({
  researchQuestions: z.array(z.string().trim().min(1)).min(3).max(5),
  searchQueries: z.array(plannedSearchQuerySchema).min(6).max(18),
  sections: z.array(plannedSectionSchema).length(4),
  brief: researchBriefSchema.optional(),
  coveragePlan: coveragePlanSchema.optional(),
  queryStrategy: queryStrategySchema.optional(),
  repairHistory: z.array(repairHistoryEntrySchema).default([]),
});

export const researchPlanOutputSchema = z.object({
  researchQuestions: z.array(z.string().trim().min(1)).min(3).max(5),
  searchQueries: z.array(plannedSearchQuerySchema).min(6).max(18),
  sections: z.array(plannedSectionSchema).length(4),
});

export const normalizedWebSourceSchema = z.object({
  title: z.string().trim().min(1),
  url: z.string().trim().url().nullable(),
  snippet: z.string().trim().min(1),
  query: z.string().trim().min(1),
  subtopic: z.string().trim().min(1),
  queryIntent: searchIntentSchema,
  sectionKey: finalReportSectionKeySchema,
  claimType: claimTypeSchema,
  evidenceMode: evidenceModeSchema,
  vendorTarget: z.string().trim().min(1).nullable(),
  domain: z.string().trim().nullable(),
  vendorPageType: vendorPageTypeSchema.nullable().default(null),
  productName: z.string().trim().min(1).nullable().default(null),
  targetUser: z.string().trim().min(1).nullable().default(null),
  coreFeatures: z.array(z.string().trim().min(1)).default([]),
  crmIntegrations: z.array(z.string().trim().min(1)).default([]),
  planPricingText: z.string().trim().min(1).nullable().default(null),
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
  evidenceId: z.string(),
  documentExternalId: z.string(),
  fileName: z.string().nullable(),
  summary: z.string(),
  sectionKey: finalReportSectionKeySchema.optional(),
  documentChunkId: z.number().int().nullable().optional(),
  similarity: z.number().nullable().optional(),
});

export const citationSchema = z.object({
  evidenceId: z.string(),
  sourceId: z.string(),
  sourceType: z.enum(evidenceSourceTypeValues),
  title: z.string(),
  url: z.string().nullable(),
  excerpt: z.string().trim().min(1),
  documentExternalId: z.string().nullable(),
  documentChunkId: z.number().int().nullable(),
});

export const researchEvidenceSchema = z.object({
  id: z.string(),
  sourceType: z.enum(evidenceSourceTypeValues),
  sourceId: z.string().nullable(),
  title: z.string().trim().min(1),
  url: z.string().trim().nullable(),
  excerpt: z.string().trim().min(1),
  sectionKey: z.enum(finalReportSectionKeyValues).nullable(),
  documentExternalId: z.string().nullable(),
  documentChunkId: z.number().int().nullable(),
  metadataJson: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const retrievalCandidateSchema = z.object({
  id: z.string(),
  sourceType: z.enum(retrievalCandidateSourceTypeValues),
  retrieverType: z.enum(retrieverTypeValues),
  sectionKey: z.enum(finalReportSectionKeyValues).nullable(),
  query: z.string().trim().min(1),
  sourceId: z.string().nullable(),
  title: z.string().trim().min(1),
  url: z.string().trim().nullable(),
  documentExternalId: z.string().nullable(),
  documentChunkId: z.number().int().nullable(),
  claimType: claimTypeSchema,
  evidenceMode: evidenceModeSchema,
  vendorTarget: z.string().trim().min(1).nullable(),
  rawScore: z.number(),
  fusedScore: z.number().nullable(),
  rerankScore: z.number().nullable(),
  selected: z.boolean(),
  metadataJson: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const researchFindingSchema = z.object({
  sectionKey: finalReportSectionKeySchema,
  claimType: claimTypeSchema,
  claim: z.string().trim().min(1),
  evidence: z.array(citationSchema).min(1),
  evidenceMode: evidenceModeSchema,
  inferenceLabel: inferenceLabelSchema,
  confidence: z.enum(confidenceValues),
  status: z.enum(findingStatusValues),
  verificationNotes: z.string().trim(),
  gaps: z.array(z.string()),
  contradictions: z.array(z.string()),
});

export const draftReportSectionSchema = z.object({
  sectionKey: z.string().trim().min(1),
  title: z.string().trim().min(1),
  contentMarkdown: z.string().trim().min(1),
  citations: z.array(z.string()),
  status: z.enum(sectionStatusValues).default('ready'),
  statusNotes: z.array(z.string()).default([]),
});

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

export const structuredRecommendationSchema = z.object({
  icp: z.string().trim().min(1),
  triggerProblem: z.string().trim().min(1),
  positionAgainstIncumbentWorkflow: z.string().trim().min(1),
  pricingHypothesis: z.string().trim().min(1),
  gtmChannelHypothesis: z.string().trim().min(1),
  implementationRisk: z.string().trim().min(1),
  confidence: z.enum(confidenceValues),
  openQuestions: z.array(z.string().trim().min(1)).min(1).max(6),
});

export const verifiedFindingSchema = researchFindingSchema.extend({
  status: z.enum(['verified', 'needs-review']),
});

export const draftReportSchema = z.object({
  findings: z.array(researchFindingSchema).min(4).max(14),
});

export const verificationOutputSchema = z.object({
  keyTakeaways: z.array(z.string().trim().min(1)).min(3).max(5),
  findings: z.array(verifiedFindingSchema).min(4),
});

export const sectionStateSchema = z.object({
  sectionKey: finalReportSectionKeySchema,
  coverageStatus: z.enum(coverageStatusValues),
  selectedEvidenceIds: z.array(z.string()).default([]),
  selectedCandidateIds: z.array(z.string()).default([]),
  gaps: z.array(z.string().trim().min(1)).default([]),
  contradictions: z.array(z.string().trim().min(1)).default([]),
  lastImprovedIteration: z.number().int().min(0).nullable().default(null),
});

export const researchTaskSchema = z.object({
  id: z.string().trim().min(1),
  type: z.enum(researchTaskTypeValues),
  sectionKey: finalReportSectionKeySchema,
  goal: z.string().trim().min(1),
  gapType: z.string().trim().min(1),
  priority: z.number().int().min(1).max(5),
  queryHints: z.array(z.string().trim().min(1)).default([]),
  sourcePreference: sourcePreferenceSchema,
  vendorTarget: z.string().trim().min(1).nullable(),
  attempt: z.number().int().min(0).default(0),
});

export const researchTaskResultSchema = z.object({
  taskId: z.string().trim().min(1),
  status: z.enum(researchTaskResultStatusValues),
  newSourceIds: z.array(z.string()).default([]),
  newEvidenceIds: z.array(z.string()).default([]),
  newCandidateIds: z.array(z.string()).default([]),
  remainingGaps: z.array(z.string().trim().min(1)).default([]),
  recommendedFollowups: z.array(z.string().trim().min(1)).default([]),
});

export const loopControlSchema = z.object({
  supervisorIteration: z.number().int().min(0).default(0),
  maxSupervisorIterations: z.number().int().min(1).default(4),
  maxConcurrentWorkers: z.number().int().min(1).default(4),
  maxTaskAttemptsPerSection: z.number().int().min(1).default(2),
  maxStallIterations: z.number().int().min(1).default(2),
});

export const pauseStateSchema = z.object({
  status: z.enum(pauseStateStatusValues).default('running'),
  question: z.string().trim().min(1).nullable().default(null),
  resumeToken: z.string().trim().min(1).nullable().default(null),
});

export const researchWorkerOutputSchema = z.object({
  taskId: z.string().trim().min(1),
  taskType: z.enum(researchTaskTypeValues),
  sectionKey: finalReportSectionKeySchema,
  summary: z.string().trim().min(1).nullable().default(null),
  vendor: z.string().trim().min(1).nullable().default(null),
  urls: z.array(z.string().trim().url()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const queryLedgerEntrySchema = z.object({
  fingerprint: z.string().trim().min(1),
  sectionKey: finalReportSectionKeySchema,
  query: z.string().trim().min(1),
  sourcePreference: sourcePreferenceSchema,
  attempt: z.number().int().min(0).default(0),
  yieldedEvidenceCount: z.number().int().min(0).default(0),
});

export const sourceFetchLedgerEntrySchema = z.object({
  url: z.string().trim().url(),
  sectionKey: finalReportSectionKeySchema,
  taskId: z.string().trim().min(1),
  fetchedAt: z.string(),
});

export const rejectedSearchCandidateSchema = z.object({
  taskId: z.string().trim().min(1),
  taskType: z.enum(researchTaskTypeValues),
  sectionKey: finalReportSectionKeySchema,
  query: z.string().trim().min(1),
  title: z.string().trim().min(1),
  url: z.string().trim().nullable(),
  domain: z.string().trim().nullable(),
  sourceCategory: z.enum(sourceCategoryValues),
  qualityScore: z.number().min(0).max(1),
  reason: z.string().trim().min(1),
  attempt: z.number().int().min(0).default(0),
  widened: z.boolean().default(false),
});

export const canonicalVendorPageRecordSchema = z.object({
  url: z.string().trim().url(),
  title: z.string().trim().min(1),
  vendorPageType: z.enum(['product', 'pricing', 'docs', 'newsroom', 'comparison']),
  intents: z.array(searchIntentSchema).min(1),
});

export const researchGraphStateSchema = z.object({
  runId: z.string().uuid(),
  topic: z.string(),
  objective: z.string().nullable().optional(),
  selectedDocumentIds: z.array(z.string()),
  linkedDocuments: z.array(linkedDocumentSchema).default([]),
  plan: researchPlanSchema.nullable().default(null),
  webSources: z.array(scoredSourceSchema).default([]),
  retrievalCandidates: z.array(retrievalCandidateSchema).default([]),
  evidenceRecords: z.array(researchEvidenceSchema).default([]),
  documentContext: z.array(documentContextSchema).default([]),
  findings: z.array(researchFindingSchema).default([]),
  reportSections: z.array(draftReportSectionSchema).default([]),
  keyTakeaways: z.array(z.string()).default([]),
  competitorMatrix: z.array(competitorMatrixEntrySchema).default([]),
  finalReportMarkdown: z.string().nullable().default(null),
  status: z.enum(researchRunStatusValues),
  currentStage: z.string(),
});

export const researchGraphStateV2Schema = researchGraphStateSchema.extend({
  userRequest: z.string().trim().min(1),
  publicStage: z.enum(researchStageValues).default('plan'),
  internalStage: z.string().trim().min(1).default('hydrate_run'),
  engineVersion: z.enum(researchEngineVersionValues).default('v2'),
  brief: researchBriefSchema.nullable().default(null),
  legacyPlan: researchPlanSchema.nullable().default(null),
  coveragePlan: coveragePlanSchema.nullable().default(null),
  sectionStates: z.array(sectionStateSchema).default([]),
  taskQueue: z.array(researchTaskSchema).default([]),
  activeTasks: z.array(researchTaskSchema).default([]),
  completedTasks: z.array(researchTaskResultSchema).default([]),
  queryLedger: z.array(queryLedgerEntrySchema).default([]),
  sourceFetchLedger: z.array(sourceFetchLedgerEntrySchema).default([]),
  evidenceLedger: z.array(z.string()).default([]),
  draftFindings: z.array(researchFindingSchema).default([]),
  verifiedFindings: z.array(verifiedFindingSchema).default([]),
  contradictions: z.array(z.string().trim().min(1)).default([]),
  postVerificationRepairPasses: z.number().int().min(0).default(0),
  loopControl: loopControlSchema.default({
    supervisorIteration: 0,
    maxSupervisorIterations: 4,
    maxConcurrentWorkers: 4,
    maxTaskAttemptsPerSection: 2,
    maxStallIterations: 2,
  }),
  pauseState: pauseStateSchema.default({
    status: 'running',
    question: null,
    resumeToken: null,
  }),
  resumeClarificationResponse: z.string().trim().min(1).nullable().default(null),
});

export const researchGraphStateV3Schema = researchGraphStateV2Schema.extend({
  engineVersion: z.enum(researchEngineVersionValues).default('v3'),
  workerPlan: z.array(researchTaskSchema).default([]),
  workerOutputs: z.array(researchWorkerOutputSchema).default([]),
  optionalRepairUsed: z.boolean().default(false),
  rejectedSearchCandidates: z.array(rejectedSearchCandidateSchema).default([]),
  requestedResolvedVendors: z.array(z.string().trim().min(1)).default([]),
  selectedComparisonVendors: z.array(z.string().trim().min(1)).default([]),
  rejectedResolvedVendors: z.array(z.string().trim().min(1)).default([]),
  unresolvedRequestedVendors: z.array(z.string().trim().min(1)).default([]),
  discoveredVendorPages: z.record(z.string(), z.array(canonicalVendorPageRecordSchema)).default({}),
  // Evidence reflection — populated by the reflect_on_evidence node
  reflectionUsed: z.boolean().default(false),
  reflectionExcludedEvidenceIds: z.array(z.string()).default([]),
});

export type CreateResearchRunInput = z.infer<typeof createResearchRunInputSchema>;
export type ResearchRunStatus = (typeof researchRunStatusValues)[number];
export type ResearchStage = (typeof researchStageValues)[number];
export type ResearchEngineVersion = (typeof researchEngineVersionValues)[number];
export type ResearchPlan = z.infer<typeof researchPlanSchema>;
export type ResearchPlanOutput = z.infer<typeof researchPlanOutputSchema>;
export type SearchIntent = z.infer<typeof searchIntentSchema>;
export type SourcePreference = z.infer<typeof sourcePreferenceSchema>;
export type PlannedSearchQuery = z.infer<typeof plannedSearchQuerySchema>;
export type NormalizedWebSource = z.infer<typeof normalizedWebSourceSchema>;
export type ScoredSource = z.infer<typeof scoredSourceSchema>;
export type ClaimType = z.infer<typeof claimTypeSchema>;
export type EvidenceMode = z.infer<typeof evidenceModeSchema>;
export type InferenceLabel = z.infer<typeof inferenceLabelSchema>;
export type VendorPageType = z.infer<typeof vendorPageTypeSchema>;
export type SectionStatus = (typeof sectionStatusValues)[number];
export type LinkedDocument = z.infer<typeof linkedDocumentSchema>;
export type DocumentContext = z.infer<typeof documentContextSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type ResearchEvidence = z.infer<typeof researchEvidenceSchema>;
export type RetrievalCandidate = z.infer<typeof retrievalCandidateSchema>;
export type ResearchFinding = z.infer<typeof researchFindingSchema>;
export type DraftReportSection = z.infer<typeof draftReportSectionSchema>;
export type DraftReport = z.infer<typeof draftReportSchema>;
export type VerifiedFinding = z.infer<typeof verifiedFindingSchema>;
export type CompetitorMatrixEntry = z.infer<typeof competitorMatrixEntrySchema>;
export type StructuredRecommendation = z.infer<typeof structuredRecommendationSchema>;
export type VerificationOutput = z.infer<typeof verificationOutputSchema>;
export type ResearchGraphState = z.infer<typeof researchGraphStateSchema>;
export type ResearchBrief = z.infer<typeof researchBriefSchema>;
export type CoveragePlan = z.infer<typeof coveragePlanSchema>;
export type SectionState = z.infer<typeof sectionStateSchema>;
export type ResearchTask = z.infer<typeof researchTaskSchema>;
export type ResearchTaskResult = z.infer<typeof researchTaskResultSchema>;
export type LoopControl = z.infer<typeof loopControlSchema>;
export type PauseState = z.infer<typeof pauseStateSchema>;
export type ResearchWorkerOutput = z.infer<typeof researchWorkerOutputSchema>;
export type QueryStrategy = z.infer<typeof queryStrategySchema>;
export type RepairHistoryEntry = z.infer<typeof repairHistoryEntrySchema>;
export type QueryLedgerEntry = z.infer<typeof queryLedgerEntrySchema>;
export type SourceFetchLedgerEntry = z.infer<typeof sourceFetchLedgerEntrySchema>;
export type RejectedSearchCandidate = z.infer<typeof rejectedSearchCandidateSchema>;
export type CanonicalVendorPageRecord = z.infer<typeof canonicalVendorPageRecordSchema>;
export type CoverageStatus = (typeof coverageStatusValues)[number];
export type ResearchTaskType = (typeof researchTaskTypeValues)[number];
export type ResearchGraphStateV2 = z.infer<typeof researchGraphStateV2Schema>;
export type ResearchGraphStateV3 = z.infer<typeof researchGraphStateV3Schema>;

export interface ResearchRunSnapshot {
  run: {
    id: string;
    topic: string;
    objective: string | null;
    status: ResearchRunStatus;
    currentStage: string;
    engineVersion: ResearchEngineVersion;
    internalStage: string | null;
    loopIteration: number;
    awaitingClarification: boolean;
    clarificationQuestion: string | null;
    lastProgressAt: string | null;
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
    claimType: ClaimType;
    claim: string;
    evidenceJson: Citation[];
    evidenceMode: EvidenceMode;
    inferenceLabel: InferenceLabel;
    confidence: ResearchFinding['confidence'];
    status: string;
    verificationNotes: string;
    gapsJson: string[];
    contradictionsJson: string[];
    createdAt: string;
  }>;
  evidence: ResearchEvidence[];
  retrievalCandidates: RetrievalCandidate[];
  reportSections: Array<{
    id: string;
    sectionKey: string;
    title: string;
    contentMarkdown: string;
    citationsJson: string[];
    status: SectionStatus;
    statusNotesJson: string[];
    createdAt: string;
  }>;
}

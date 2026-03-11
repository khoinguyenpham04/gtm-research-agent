import OpenAI from 'openai';
import { Command, END, START, StateGraph } from '@langchain/langgraph';
import { z } from 'zod';
import { generateStructuredOutput, generateStructuredOutputOrchestrator } from '@/lib/research/ai';
import { buildDeterministicCompetitorProfiles, countDistinctCompetitorVendors } from '@/lib/research/competitor-extraction';
import { buildInitialGraphState } from '@/lib/research/graph';
import { runFinalizeNode } from '@/lib/research/nodes/finalize';
import { runVerificationNodeForceRefresh } from '@/lib/research/nodes/verification';
import {
  appendResearchEvent,
  getResearchRun,
  listResearchEvidence,
  listResearchSources,
  replaceResearchFindings,
  saveResearchEvidence,
  saveResearchRetrievalCandidates,
  saveResearchSources,
  saveRunPlan,
  updateRunExecutionState,
} from '@/lib/research/repository';
import { buildLexicalQuery, buildSectionQuery, reciprocalRankFuse } from '@/lib/research/retrieval';
import {
  assessSectionStatus,
  filterCandidatesForSection,
  getGtmEvidenceSignals,
  selectEvidenceForSection,
} from '@/lib/research/section-policy';
import {
  claimTypeSchema,
  evidenceModeSchema,
  researchGraphStateV3Schema,
  sourceCategoryValues,
  type CoveragePlan,
  type Citation,
  type CanonicalVendorPageRecord,
  type PlannedSearchQuery,
  type ResearchBrief,
  type ResearchEngineVersion,
  type ResearchEvidence,
  type ResearchFinding,
  type ResearchGraphState,
  type ResearchGraphStateV3,
  type ResearchPlan,
  type ResearchStage,
  type ResearchTask,
  type ResearchTaskResult,
  type ResearchWorkerOutput,
  type RejectedSearchCandidate,
  type ScoredSource,
  type SearchIntent,
  type SectionState,
  type SourceFetchLedgerEntry,
  vendorPageTypeSchema,
} from '@/lib/research/schemas';
import { coerceClaimType, coerceEvidenceMode } from '@/lib/research/source-scoring';
import { sanitizeOutboundQuery, type WebSearchService } from '@/lib/research/search';
import { hasTopicSignal } from '@/lib/research/topic-utils';
import { resolveCanonicalVendorPages, type CanonicalVendorPage } from '@/lib/research/vendor-registry';
import { createSupabaseServerClient } from '@/lib/supabase';

const openai = new OpenAI();

const DEFAULT_ENGINE_VERSION: ResearchEngineVersion = 'v3';
const MAX_VENDOR_COMPARISON_WIDTH = 2;
const MAX_WORKERS = 7;
const MAX_OPTIONAL_REPAIR_WORKERS = 2;

const nonDerivedSectionKeys = [
  'market-landscape',
  'icp-and-buyer',
  'competitor-landscape',
  'pricing-and-packaging',
  'gtm-motion',
  'risks-and-unknowns',
] as const;

type NonDerivedSectionKey = (typeof nonDerivedSectionKeys)[number];
type FixedWorkerTaskType =
  | 'vendor_profile'
  | 'vendor_pricing'
  | 'buyer_research'
  | 'market_research'
  | 'gtm_research'
  | 'risk_research';

interface DocumentMatchRow {
  id: number;
  content: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
}

interface LexicalMatchRow {
  id: number;
  content: string;
  metadata: Record<string, unknown> | null;
  rank_score: number;
}

const evidenceReflectionSchema = z.object({
  segmentMismatchIds: z
    .array(z.string())
    .describe(
      'IDs of evidence records that are clearly from the wrong market segment (e.g. industrial policy when the topic is residential consumer products). Only include records that are unambiguously off-topic, not merely weak.',
    ),
  replacementQueries: z
    .array(
      z.object({
        query: z.string().trim().min(1),
        intent: z.enum(['market-size', 'adoption', 'competitor-features', 'pricing', 'buyer-pain', 'gtm-channels']),
        sectionKey: z.enum([
          'market-landscape',
          'icp-and-buyer',
          'competitor-landscape',
          'pricing-and-packaging',
          'gtm-motion',
          'risks-and-unknowns',
        ]),
        claimType: z.enum([
          'market-sizing',
          'adoption-signal',
          'buyer-pain',
          'competitor-feature',
          'pricing',
          'gtm-channel',
          'risk',
          'recommendation-input',
        ]),
        rationale: z.string().trim().min(1),
      }),
    )
    .describe('Targeted replacement queries. Only generate these when segment-mismatch evidence was found.'),
  reflectionSummary: z.string().trim().min(1).describe('One-sentence summary of what was wrong and what the replacement queries target.'),
});

const scopeAssessmentSchema = z.object({
  productCategory: z.string().trim().min(1).nullable(),
  targetBuyer: z.string().trim().min(1).nullable(),
  companyType: z.string().trim().min(1).nullable(),
  geo: z.string().trim().min(1).nullable(),
  timeHorizon: z.string().trim().min(1).nullable(),
  knownVendors: z.array(z.string().trim().min(1)),
  coreUnknowns: z.array(z.string().trim().min(1)),
  comparisonScope: z.string().trim().min(1).nullable(),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().trim().min(1).nullable(),
});

const pageSummarySchema = z.object({
  summary: z.string().trim().min(1),
  excerpt: z.string().trim().min(1),
  evidenceBuckets: z.array(z.string().trim().min(1)),
  targetUser: z.string().trim().min(1).nullable(),
  coreFeatures: z.array(z.string().trim().min(1)),
  crmIntegrations: z.array(z.string().trim().min(1)),
  pricingText: z.string().trim().min(1).nullable(),
  contradictionSignals: z.array(z.string().trim().min(1)),
});

type FetchedPage = {
  url: string;
  title: string;
  text: string;
  domain: string | null;
  query: string;
  subtopic: string;
  queryIntent: SearchIntent;
  publishedYear: number | null;
  sourceCategory: (typeof sourceCategoryValues)[number];
  qualityScore: number;
  snippet: string;
  vendorPageType: z.infer<typeof vendorPageTypeSchema> | null;
  vendorTarget: string | null;
  claimType: z.infer<typeof claimTypeSchema>;
  evidenceMode: z.infer<typeof evidenceModeSchema>;
};
type SummarizedPage = {
  page: FetchedPage;
  summary: z.infer<typeof pageSummarySchema>;
};

type WorkerSourcePolicy = {
  allowedCategories: Array<(typeof sourceCategoryValues)[number]>;
  minFetchQuality: number;
  directTopicThreshold: number;
  maxResults: number;
  preferredDomains: string[];
  preferredTerms: string[];
  allowPreferredFallback: boolean;
  allowAdjacentFetch: boolean;
};

function buildUserRequest(topic: string, objective?: string | null, clarificationResponse?: string | null) {
  return [
    `Topic: ${topic}`,
    objective ? `Objective: ${objective}` : null,
    clarificationResponse ? `Clarification: ${clarificationResponse}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function normalizeStage(value: string | null | undefined): ResearchStage {
  if (value === 'mock_document_retrieval') {
    return 'document_retrieval';
  }

  switch (value) {
    case 'plan':
    case 'web_search':
    case 'document_retrieval':
    case 'draft_report':
    case 'verification':
    case 'finalize':
      return value;
    default:
      return 'plan';
  }
}

function dedupeStrings(values: string[]) {
  return values.filter((value, index) => Boolean(value) && values.indexOf(value) === index);
}

function dedupeTasks(tasks: ResearchTask[]) {
  const seen = new Set<string>();
  return tasks.filter((task) => {
    const key = `${task.type}:${task.sectionKey}:${task.vendorTarget ?? ''}:${task.gapType}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}

function projectPublicStage(internalStage: string): ResearchStage {
  if (
    internalStage === 'hydrate_run' ||
    internalStage === 'clarify_scope' ||
    internalStage === 'build_gtm_brief' ||
    internalStage === 'build_fixed_task_plan'
  ) {
    return 'plan';
  }

  if (internalStage === 'run_workers' || internalStage === 'optional_repair_pass' || internalStage === 'reflect_on_evidence' || internalStage === 'reflection_refetch') {
    return 'web_search';
  }

  if (internalStage === 'synthesize') {
    return 'draft_report';
  }

  if (internalStage === 'verify' || internalStage === 'decide_optional_repair') {
    return 'verification';
  }

  return 'finalize';
}

function projectStatus(publicStage: ResearchStage, completed = false) {
  if (completed) {
    return 'completed' as const;
  }

  switch (publicStage) {
    case 'plan':
      return 'planning' as const;
    case 'web_search':
      return 'searching' as const;
    case 'document_retrieval':
      return 'retrieving' as const;
    case 'draft_report':
      return 'drafting' as const;
    case 'verification':
      return 'verifying' as const;
    case 'finalize':
      return 'completed' as const;
  }
}

function buildDefaultCoveragePlan(): CoveragePlan {
  return {
    'market-landscape': {
      requiredEvidenceBuckets: ['market-adjacent', 'product-specific'],
      minStrongEvidence: 1,
      preferredSourceTypes: ['primary', 'mixed'],
      repairPriority: 2,
    },
    'icp-and-buyer': {
      requiredEvidenceBuckets: ['buyer-workflow', 'adoption-readiness'],
      minStrongEvidence: 1,
      preferredSourceTypes: ['primary', 'mixed'],
      repairPriority: 1,
    },
    'competitor-landscape': {
      requiredEvidenceBuckets: ['canonical-vendor-1', 'canonical-vendor-2'],
      minStrongEvidence: 0,
      preferredSourceTypes: ['commercial'],
      repairPriority: 1,
    },
    'pricing-and-packaging': {
      requiredEvidenceBuckets: ['canonical-pricing-1', 'canonical-pricing-2'],
      minStrongEvidence: 0,
      preferredSourceTypes: ['commercial'],
      repairPriority: 1,
    },
    'gtm-motion': {
      requiredEvidenceBuckets: ['buying-process', 'channel-preference', 'partner-direct', 'purchase-friction'],
      minStrongEvidence: 1,
      preferredSourceTypes: ['primary', 'mixed'],
      repairPriority: 3,
    },
    'risks-and-unknowns': {
      requiredEvidenceBuckets: ['risk-or-barrier'],
      minStrongEvidence: 1,
      preferredSourceTypes: ['primary', 'mixed'],
      repairPriority: 2,
    },
    recommendation: {
      requiredEvidenceBuckets: ['derived-only'],
      minStrongEvidence: 0,
      preferredSourceTypes: ['mixed'],
      repairPriority: 5,
    },
  };
}

function getRequestedVendors(brief: ResearchBrief | null) {
  return dedupeStrings(brief?.knownVendors ?? []);
}

function buildTaskId(runId: string, task: Omit<ResearchTask, 'id'>, index: number) {
  return `${runId}-${task.type}-${task.sectionKey}-${task.vendorTarget ?? 'general'}-${index}`;
}

function buildFixedWorkerPlan(
  state: ResearchGraphStateV3,
  vendorTargets: string[],
  options?: { repair?: boolean },
) {
  const tasks: Omit<ResearchTask, 'id'>[] = [
    ...vendorTargets.map((vendor) => ({
      type: 'vendor_profile' as const,
      sectionKey: 'competitor-landscape' as const,
      goal: `Build a canonical vendor profile for ${vendor}.`,
      gapType: 'vendor-profile',
      priority: 1,
      queryHints: ['core-capabilities', 'integrations', 'security-compliance'],
      sourcePreference: 'commercial' as const,
      vendorTarget: vendor,
      attempt: options?.repair ? 1 : 0,
    })),
    ...vendorTargets.map((vendor) => ({
      type: 'vendor_pricing' as const,
      sectionKey: 'pricing-and-packaging' as const,
      goal: `Build canonical pricing evidence for ${vendor}.`,
      gapType: 'vendor-pricing',
      priority: 1,
      queryHints: ['pricing', 'plans', 'enterprise-path'],
      sourcePreference: 'commercial' as const,
      vendorTarget: vendor,
      attempt: options?.repair ? 1 : 0,
    })),
    {
      type: 'buyer_research',
      sectionKey: 'icp-and-buyer',
      goal: 'Find direct buyer-role, workflow pain, and buying-trigger evidence for the target ICP.',
      gapType: 'buyer-evidence',
      priority: 2,
      queryHints: ['buyer-roles', 'workflow-pain', 'buying-triggers'],
      sourcePreference: 'primary',
      vendorTarget: null,
      attempt: options?.repair ? 1 : 0,
    },
    {
      type: 'market_research',
      sectionKey: 'market-landscape',
      goal: 'Find readable market or adoption evidence with extractable statistics for the product category.',
      gapType: 'market-evidence',
      priority: 2,
      queryHints: ['market-size', 'adoption-statistics'],
      sourcePreference: 'primary',
      vendorTarget: null,
      attempt: options?.repair ? 1 : 0,
    },
    {
      type: 'gtm_research',
      sectionKey: 'gtm-motion',
      goal: 'Find direct evidence on buying process, route to market, channel preference, and purchase friction.',
      gapType: 'gtm-evidence',
      priority: 2,
      queryHints: ['buying-process', 'channel-preference', 'partner-direct', 'purchase-friction'],
      sourcePreference: 'mixed',
      vendorTarget: null,
      attempt: options?.repair ? 1 : 0,
    },
    {
      type: 'risk_research',
      sectionKey: 'risks-and-unknowns',
      goal: 'Find direct privacy, compliance, integration, or deployment barrier evidence for the target segment.',
      gapType: 'risk-evidence',
      priority: 2,
      queryHints: ['privacy-compliance', 'integration-friction', 'deployment-barriers'],
      sourcePreference: 'primary',
      vendorTarget: null,
      attempt: options?.repair ? 1 : 0,
    },
  ];

  return dedupeTasks(
    tasks.slice(0, MAX_WORKERS).map((task, index) => ({
      ...task,
      id: buildTaskId(state.runId, task, index),
    })),
  );
}

function buildCuratedSourcePackQueries(task: ResearchTask, state: ResearchGraphStateV3): PlannedSearchQuery[] {
  const geo = state.brief?.geo ?? 'United Kingdom';
  const category = state.brief?.productCategory ?? state.topic;
  const buyerCompanyType = state.brief?.companyType ?? 'UK SMBs';
  const buyer = state.brief?.targetBuyer ?? buyerCompanyType;

  switch (task.type as FixedWorkerTaskType) {
    case 'buyer_research':
      return [
        {
          intent: 'buyer-pain',
          sectionKey: 'icp-and-buyer',
          subtopic: 'buyer-survey',
          query: `${geo} ${category} ${buyer} survey report adoption barriers decision factors`,
          sourcePreference: 'primary',
          claimType: 'buyer-pain',
          evidenceMode: 'independent-validation',
          vendorTarget: null,
        },
        {
          intent: 'adoption',
          sectionKey: 'icp-and-buyer',
          subtopic: 'buyer-guide',
          query: `${geo} ${category} ${buyer} review comparison guide cost concerns benefits`,
          sourcePreference: 'primary',
          claimType: 'adoption-signal',
          evidenceMode: 'independent-validation',
          vendorTarget: null,
        },
      ];
    case 'market_research':
      return [
        {
          intent: 'market-size',
          sectionKey: 'market-landscape',
          subtopic: 'market-report',
          query: `${geo} ${category} market size adoption statistics report forecast`,
          sourcePreference: 'primary',
          claimType: 'market-sizing',
          evidenceMode: 'product-specific',
          vendorTarget: null,
        },
        {
          intent: 'adoption',
          sectionKey: 'market-landscape',
          subtopic: 'market-demand',
          query: `${geo} ${category} demand adoption consumer business survey report`,
          sourcePreference: 'primary',
          claimType: 'adoption-signal',
          evidenceMode: 'product-specific',
          vendorTarget: null,
        },
      ];
    case 'gtm_research':
      return [
        {
          intent: 'gtm-channels',
          sectionKey: 'gtm-motion',
          subtopic: 'gtm-buying-process',
          query: `${geo} ${category} ${buyer} how to buy buying process quote review comparison`,
          sourcePreference: 'mixed',
          claimType: 'gtm-channel',
          evidenceMode: 'independent-validation',
          vendorTarget: null,
        },
        {
          intent: 'gtm-channels',
          sectionKey: 'gtm-motion',
          subtopic: 'gtm-channel-friction',
          query: `${geo} ${category} ${buyerCompanyType} direct installer retailer partner financing friction`,
          sourcePreference: 'mixed',
          claimType: 'gtm-channel',
          evidenceMode: 'independent-validation',
          vendorTarget: null,
        },
      ];
    default:
      return [];
  }
}

function buildQueriesForTask(task: ResearchTask, state: ResearchGraphStateV3): PlannedSearchQuery[] {
  const geo = state.brief?.geo ?? 'United Kingdom';
  const buyer = state.brief?.targetBuyer ?? state.brief?.companyType ?? 'buyers';
  const category = state.brief?.productCategory ?? state.topic;
  const buyerCompanyType = state.brief?.companyType ?? 'UK SMBs';
  const curatedSourcePackQueries = buildCuratedSourcePackQueries(task, state);
  const marketAttemptConstraint =
    task.attempt > 0
      ? 'site:gov.uk OR site:ons.gov.uk OR site:oecd.org OR site:erc.ac.uk OR filetype:pdf report survey'
      : 'report survey statistics forecast';
  const buyerAttemptConstraint =
    task.attempt > 0
      ? 'survey research benchmark case study'
      : 'survey report benchmark';
  const gtmAttemptConstraint =
    task.attempt > 0
      ? 'marketplace partner reseller direct sales self-serve case study'
      : 'survey benchmark';
  const riskAttemptConstraint =
    task.attempt > 0
      ? 'GDPR consent security integration case study'
      : 'compliance security research';
  const vendorAttemptConstraint =
    task.attempt > 0 ? 'official pricing product docs' : 'official';

  switch (task.type) {
    case 'vendor_profile':
      return [
        {
          intent: 'competitor-features' as const,
          sectionKey: 'competitor-landscape' as const,
          subtopic: 'vendor-profile',
          query: `${task.vendorTarget ?? category} product features official ${vendorAttemptConstraint}`.trim(),
          sourcePreference: 'commercial' as const,
          claimType: 'competitor-feature' as const,
          evidenceMode: 'vendor-primary' as const,
          vendorTarget: task.vendorTarget,
        } satisfies PlannedSearchQuery,
      ];
    case 'vendor_pricing':
      return [
        {
          intent: 'pricing' as const,
          sectionKey: 'pricing-and-packaging' as const,
          subtopic: 'vendor-pricing',
          query: `${task.vendorTarget ?? category} pricing plans official ${vendorAttemptConstraint}`.trim(),
          sourcePreference: 'commercial' as const,
          claimType: 'pricing' as const,
          evidenceMode: 'vendor-primary' as const,
          vendorTarget: task.vendorTarget,
        } satisfies PlannedSearchQuery,
      ];
    case 'buyer_research':
      return [
        ...curatedSourcePackQueries,
        {
          intent: 'buyer-pain' as const,
          sectionKey: 'icp-and-buyer' as const,
          subtopic: 'buyer-official-research',
          query: `site:gov.uk OR site:ons.gov.uk OR site:yougov.com OR site:mintel.com ${geo} ${category} ${buyer} survey report ${buyerAttemptConstraint}`.trim(),
          sourcePreference: 'primary' as const,
          claimType: 'buyer-pain' as const,
          evidenceMode: 'independent-validation' as const,
          vendorTarget: null,
        } satisfies PlannedSearchQuery,
        {
          intent: 'adoption' as const,
          sectionKey: 'icp-and-buyer' as const,
          subtopic: 'buyer-adoption',
          query: `${geo} ${category} ${buyerCompanyType} adoption drivers pain points workflow ${buyerAttemptConstraint}`.trim(),
          sourcePreference: 'primary' as const,
          claimType: 'adoption-signal' as const,
          evidenceMode: 'independent-validation' as const,
          vendorTarget: null,
        } satisfies PlannedSearchQuery,
      ].slice(0, 4);
    case 'market_research':
      return [
        ...curatedSourcePackQueries,
        {
          intent: 'market-size' as const,
          sectionKey: 'market-landscape' as const,
          subtopic: 'market-official-research',
          query: `site:gov.uk OR site:ons.gov.uk OR site:oecd.org OR site:statista.com ${geo} ${category} market report statistics ${marketAttemptConstraint}`.trim(),
          sourcePreference: 'primary' as const,
          claimType: 'market-sizing' as const,
          evidenceMode: 'product-specific' as const,
          vendorTarget: null,
        } satisfies PlannedSearchQuery,
        {
          intent: 'adoption' as const,
          sectionKey: 'market-landscape' as const,
          subtopic: 'market-adoption',
          query: `${geo} ${category} ${buyer} adoption survey report statistics ${marketAttemptConstraint}`.trim(),
          sourcePreference: 'primary' as const,
          claimType: 'adoption-signal' as const,
          evidenceMode: 'product-specific' as const,
          vendorTarget: null,
        } satisfies PlannedSearchQuery,
      ].slice(0, 4);
    case 'risk_research':
      return [
        {
          intent: 'buyer-pain' as const,
          sectionKey: 'risks-and-unknowns' as const,
          subtopic: 'compliance-regulation',
          query: `${geo} ${category} compliance regulation consumer protection legal risk barrier ${riskAttemptConstraint}`.trim(),
          sourcePreference: 'primary' as const,
          claimType: 'risk' as const,
          evidenceMode: 'independent-validation' as const,
          vendorTarget: null,
        } satisfies PlannedSearchQuery,
        {
          intent: 'buyer-pain' as const,
          sectionKey: 'risks-and-unknowns' as const,
          subtopic: 'adoption-friction',
          query: `${geo} ${buyer} ${category} adoption barrier friction rollout concern case study ${riskAttemptConstraint}`.trim(),
          sourcePreference: 'primary' as const,
          claimType: 'risk' as const,
          evidenceMode: 'independent-validation' as const,
          vendorTarget: null,
        } satisfies PlannedSearchQuery,
        {
          intent: 'buyer-pain' as const,
          sectionKey: 'risks-and-unknowns' as const,
          subtopic: 'deployment-barriers',
          query: `${geo} ${buyerCompanyType} ${category} deployment installation consumer concern objection barrier ${riskAttemptConstraint}`.trim(),
          sourcePreference: 'primary' as const,
          claimType: 'risk' as const,
          evidenceMode: 'independent-validation' as const,
          vendorTarget: null,
        } satisfies PlannedSearchQuery,
        {
          intent: 'buyer-pain' as const,
          sectionKey: 'risks-and-unknowns' as const,
          subtopic: 'risk-source-seeded',
          query: `site:gov.uk OR site:which.co.uk OR site:moneysavingexpert.com ${geo} ${category} ${buyer} consumer guidance regulation risk`.trim(),
          sourcePreference: 'primary' as const,
          claimType: 'risk' as const,
          evidenceMode: 'independent-validation' as const,
          vendorTarget: null,
        } satisfies PlannedSearchQuery,
      ];
    case 'gtm_research':
      return [
        ...curatedSourcePackQueries,
        {
          intent: 'gtm-channels' as const,
          sectionKey: 'gtm-motion' as const,
          subtopic: 'gtm-direct-evidence',
          query: `${geo} ${category} ${buyer} buying process direct installer retailer partner ${gtmAttemptConstraint}`.trim(),
          sourcePreference: 'mixed' as const,
          claimType: 'gtm-channel' as const,
          evidenceMode: 'independent-validation' as const,
          vendorTarget: null,
        } satisfies PlannedSearchQuery,
        {
          intent: 'gtm-channels' as const,
          sectionKey: 'gtm-motion' as const,
          subtopic: 'gtm-guidance',
          query: `site:gov.uk OR site:which.co.uk OR site:moneysavingexpert.com OR site:energysavingtrust.org.uk ${geo} ${category} buying guide quote installer`.trim(),
          sourcePreference: 'mixed' as const,
          claimType: 'gtm-channel' as const,
          evidenceMode: 'independent-validation' as const,
          vendorTarget: null,
        } satisfies PlannedSearchQuery,
      ].slice(0, 4);
    default:
      return [];
  }
}

function buildTaskTopicSeed(task: ResearchTask, topic: string, brief: ResearchBrief | null) {
  const category = brief?.productCategory ?? topic;
  switch (task.type as FixedWorkerTaskType) {
    case 'market_research':
      return [category, brief?.companyType, brief?.geo].filter(Boolean).join(' ');
    case 'buyer_research':
      return [category, brief?.targetBuyer, brief?.companyType].filter(Boolean).join(' ');
    case 'gtm_research':
      return [category, brief?.targetBuyer, brief?.companyType, brief?.geo].filter(Boolean).join(' ');
    case 'risk_research':
      return [category, brief?.geo].filter(Boolean).join(' ');
    default:
      return category;
  }
}

function buildTaskContextSeed(task: ResearchTask, brief: ResearchBrief | null) {
  switch (task.type as FixedWorkerTaskType) {
    case 'buyer_research':
      return [brief?.targetBuyer, brief?.companyType, brief?.geo].filter(Boolean).join(' ');
    case 'gtm_research':
      return [brief?.targetBuyer, brief?.companyType, brief?.geo, 'buying process channel purchase acquisition'].filter(Boolean).join(' ');
    default:
      return [brief?.targetBuyer, brief?.companyType, brief?.geo].filter(Boolean).join(' ');
  }
}

function buildCompatPlan(state: ResearchGraphStateV3, workerPlan: ResearchTask[]): ResearchPlan {
  const searchQueries = workerPlan.flatMap((task) => buildQueriesForTask(task, state)).slice(0, 18);
  const researchQuestions = dedupeStrings([
    `What direct evidence describes ${state.brief?.targetBuyer ?? 'the target buyer'} and their workflow pain for ${state.brief?.productCategory ?? state.topic}?`,
    `Which vendors best represent the comparison set for ${state.brief?.productCategory ?? state.topic}, and how do their product and pricing pages differ?`,
    `What readable market or adoption statistics exist for ${state.brief?.geo ?? 'the target geography'} in this category?`,
    `What direct evidence exists for the buying process, route to market, and purchase friction for ${state.brief?.targetBuyer ?? 'the target buyer'}?`,
    `What regulatory, compliance, safety, or adoption barriers materially affect uptake for this category?`,
  ]).slice(0, 5);

  return {
    researchQuestions,
    searchQueries,
    sections: [
      {
        key: 'market-landscape',
        title: 'Market Landscape',
        description: 'Category demand, adoption, and market sizing signals.',
      },
      {
        key: 'icp-and-buyer',
        title: 'ICP and Buyer',
        description: 'Buyer roles, pain points, readiness, and adoption triggers.',
      },
      {
        key: 'competitor-landscape',
        title: 'Competitor Landscape',
        description: 'Canonical vendor positioning and competitive differences.',
      },
      {
        key: 'pricing-and-packaging',
        title: 'Pricing and Packaging',
        description: 'Canonical pricing, self-serve versus sales-led packaging, and enterprise path.',
      },
    ],
    brief: state.brief ?? undefined,
    coveragePlan: buildDefaultCoveragePlan(),
    queryStrategy: {
      seedQueries: searchQueries,
      sourcePreferenceBySection: {
        'market-landscape': 'primary',
        'icp-and-buyer': 'primary',
        'competitor-landscape': 'commercial',
        'pricing-and-packaging': 'commercial',
        'gtm-motion': 'mixed',
        'risks-and-unknowns': 'primary',
      },
      notes: [
        'Use canonical vendor pages first for vendor profile and pricing tasks.',
        'Discard unreadable PDFs and non-topic public procurement artefacts.',
        'Do not draft competitor or pricing sections until at least two vendors are present.',
        'Use worker-specific source policies for market, buyer, GTM, and risk evidence instead of one generic primary lane.',
        'Use a lower fetch-admission bar than the strong-evidence verification bar for buyer and GTM workers so adjacent research can be inspected before being trusted.',
      ],
    },
    repairHistory: state.plan?.repairHistory ?? [],
  };
}

function buildFallbackQueriesForTask(task: ResearchTask, state: ResearchGraphStateV3): PlannedSearchQuery[] {
  const geo = state.brief?.geo ?? 'United Kingdom';
  const category = state.brief?.productCategory ?? state.topic;
  const buyerCompanyType = state.brief?.companyType ?? 'UK SMBs';

  switch (task.type as FixedWorkerTaskType) {
    case 'market_research':
      return [
        {
          intent: 'market-size',
          sectionKey: 'market-landscape',
          subtopic: 'market-report-fallback',
          query: `site:ons.gov.uk OR site:gov.uk OR site:oecd.org OR site:erc.ac.uk OR site:statista.com ${geo} SMB AI adoption survey report`,
          sourcePreference: 'primary',
          claimType: 'market-sizing',
          evidenceMode: 'product-specific',
          vendorTarget: null,
        },
        {
          intent: 'adoption',
          sectionKey: 'market-landscape',
          subtopic: 'market-trade-fallback',
          query: `site:statista.com OR site:mintel.com OR site:yougov.com ${category} adoption statistics benchmark report`,
          sourcePreference: 'primary',
          claimType: 'adoption-signal',
          evidenceMode: 'product-specific',
          vendorTarget: null,
        },
      ];
    case 'buyer_research':
      return [
        {
          intent: 'buyer-pain',
          sectionKey: 'icp-and-buyer',
          subtopic: 'buyer-evidence-fallback',
          query: `site:gov.uk OR site:ons.gov.uk OR site:yougov.com OR site:statista.com ${category} ${buyerCompanyType} buyer survey pain point`,
          sourcePreference: 'primary',
          claimType: 'buyer-pain',
          evidenceMode: 'independent-validation',
          vendorTarget: null,
        },
        {
          intent: 'adoption',
          sectionKey: 'icp-and-buyer',
          subtopic: 'buyer-role-fallback',
          query: `site:which.co.uk OR site:moneysavingexpert.com OR site:trustpilot.com ${category} ${buyerCompanyType} review buyer experience`,
          sourcePreference: 'primary',
          claimType: 'adoption-signal',
          evidenceMode: 'independent-validation',
          vendorTarget: null,
        },
      ];
    case 'gtm_research':
      return [
        {
          intent: 'gtm-channels',
          sectionKey: 'gtm-motion',
          subtopic: 'gtm-evidence-fallback',
          query: `${category} ${geo} how to buy channel purchase route installer direct online retailer`,
          sourcePreference: 'mixed',
          claimType: 'gtm-channel',
          evidenceMode: 'independent-validation',
          vendorTarget: null,
        },
      ];
    case 'risk_research':
      return [
        {
          intent: 'buyer-pain',
          sectionKey: 'risks-and-unknowns',
          subtopic: 'risk-evidence-fallback',
          query: `site:ico.org.uk OR site:gov.uk ${geo} meeting recording transcription gdpr consent guidance`,
          sourcePreference: 'primary',
          claimType: 'risk',
          evidenceMode: 'independent-validation',
          vendorTarget: null,
        },
      ];
    default:
      return [];
  }
}

function normalizeVendorToken(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getVendorSearchTokens(vendor: string) {
  return dedupeStrings(
    normalizeVendorToken(vendor)
      .split(' ')
      .filter((token) => token.length >= 3 && token !== 'ai'),
  );
}

function looksLikeVendorOwnedResult(source: ScoredSource, vendor: string) {
  const tokens = getVendorSearchTokens(vendor);
  const haystack = [source.domain ?? '', source.url ?? '', source.title, source.snippet].join(' ').toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

function looksLikeVendorDomain(domain: string | null | undefined, vendor: string) {
  if (!domain) {
    return false;
  }

  const normalizedDomain = domain.toLowerCase();
  const compactDomain = normalizedDomain.replace(/[^a-z0-9]/g, '');
  const vendorTokens = getVendorSearchTokens(vendor);
  const compactVendor = normalizeVendorToken(vendor).replace(/\s+/g, '');

  return (
    vendorTokens.some((token) => normalizedDomain === token || normalizedDomain.includes(`${token}.`) || normalizedDomain.includes(`.${token}`)) ||
    compactVendor.length >= 4 && compactDomain.includes(compactVendor)
  );
}

function inferCanonicalPageType(source: ScoredSource): CanonicalVendorPage['vendorPageType'] | null {
  const haystack = `${source.url ?? ''} ${source.title} ${source.snippet}`.toLowerCase();
  if (haystack.includes('/pricing') || haystack.includes('pricing') || haystack.includes('plans')) {
    return 'pricing';
  }
  if (haystack.includes('/help') || haystack.includes('/docs') || haystack.includes('help center') || haystack.includes('integration guide')) {
    return 'docs';
  }
  if (haystack.includes('/blog') || haystack.includes('/news')) {
    return 'newsroom';
  }
  if (haystack.includes('/compare') || haystack.includes('/vs-') || haystack.includes('comparison')) {
    return 'comparison';
  }
  return 'product';
}

async function discoverCanonicalVendorPagesForVendor(
  searchService: WebSearchService,
  vendor: string,
): Promise<CanonicalVendorPage[]> {
  const existingProductPages = resolveCanonicalVendorPages(vendor, 'competitor-features');
  const existingPricingPages = resolveCanonicalVendorPages(vendor, 'pricing');
  if (existingProductPages.length > 0 || existingPricingPages.length > 0) {
    const pagesByUrl = new Map<string, CanonicalVendorPage>();
    for (const page of [...existingProductPages, ...existingPricingPages]) {
      pagesByUrl.set(page.url, page);
    }
    return Array.from(pagesByUrl.values());
  }

  const searchQueries: PlannedSearchQuery[] = [
    {
      intent: 'competitor-features',
      sectionKey: 'competitor-landscape',
      subtopic: 'vendor-discovery-product',
      query: `${vendor} official product`,
      sourcePreference: 'commercial',
      claimType: 'competitor-feature',
      evidenceMode: 'vendor-primary',
      vendorTarget: vendor,
    },
    {
      intent: 'pricing',
      sectionKey: 'pricing-and-packaging',
      subtopic: 'vendor-discovery-pricing',
      query: `${vendor} official pricing`,
      sourcePreference: 'commercial',
      claimType: 'pricing',
      evidenceMode: 'vendor-primary',
      vendorTarget: vendor,
    },
    {
      intent: 'competitor-features',
      sectionKey: 'competitor-landscape',
      subtopic: 'vendor-discovery-docs',
      query: `${vendor} official docs integrations`,
      sourcePreference: 'commercial',
      claimType: 'competitor-feature',
      evidenceMode: 'vendor-primary',
      vendorTarget: vendor,
    },
  ];

  const searchResults = await searchService.searchMany(searchQueries);
  const candidatePages = searchResults
    .filter(
      (source) =>
        Boolean(source.url) &&
        source.sourceCategory === 'vendor' &&
        looksLikeVendorOwnedResult(source, vendor) &&
        looksLikeVendorDomain(source.domain, vendor),
    )
    .map((source) => ({
      url: source.url as string,
      title: source.title,
      vendorPageType: inferCanonicalPageType(source),
      source,
    }))
    .filter(
      (entry): entry is { url: string; title: string; vendorPageType: CanonicalVendorPage['vendorPageType']; source: ScoredSource } =>
        entry.vendorPageType != null,
    )
    .sort((left, right) => right.source.qualityScore - left.source.qualityScore);

  const pagesByType = new Map<CanonicalVendorPage['vendorPageType'], CanonicalVendorPage>();
  for (const entry of candidatePages) {
    if (entry.vendorPageType === 'newsroom' || entry.vendorPageType === 'comparison') {
      continue;
    }
    if (pagesByType.has(entry.vendorPageType)) {
      continue;
    }
    pagesByType.set(entry.vendorPageType, {
      url: entry.url,
      title: entry.title,
      vendorPageType: entry.vendorPageType,
      intents:
        entry.vendorPageType === 'pricing'
          ? ['pricing']
          : ['competitor-features'],
    });
  }

  return Array.from(pagesByType.values());
}

async function resolveVendorTargetsForPlanning(
  searchService: WebSearchService,
  brief: ResearchBrief | null,
) {
  const requestedVendors = getRequestedVendors(brief);
  const requestedResolvedVendors: string[] = [];
  const unresolvedRequestedVendors: string[] = [];
  const discoveredVendorPages: Record<string, CanonicalVendorPageRecord[]> = {};

  for (const vendor of requestedVendors) {
    const pages = await discoverCanonicalVendorPagesForVendor(searchService, vendor);
    const hasProductOrDocs = pages.some(
      (page) => page.vendorPageType === 'product' || page.vendorPageType === 'docs',
    );
    const hasPricing = pages.some((page) => page.vendorPageType === 'pricing');

    if (hasProductOrDocs || hasPricing) {
      requestedResolvedVendors.push(vendor);
      discoveredVendorPages[vendor] = pages.map((page) => ({
        url: page.url,
        title: page.title,
        vendorPageType: page.vendorPageType,
        intents: page.intents,
      }));
    } else {
      unresolvedRequestedVendors.push(vendor);
    }
  }

  const selectedComparisonVendors = requestedResolvedVendors.slice(0, MAX_VENDOR_COMPARISON_WIDTH);
  const rejectedResolvedVendors = requestedResolvedVendors.filter(
    (vendor) => !selectedComparisonVendors.includes(vendor),
  );

  return {
    requestedResolvedVendors,
    selectedComparisonVendors,
    rejectedResolvedVendors,
    unresolvedRequestedVendors,
    discoveredVendorPages,
  };
}

function fingerprintQuery(query: string) {
  return sanitizeOutboundQuery(query).toLowerCase();
}

async function checkpointState(
  state: ResearchGraphStateV3,
  partial: Partial<ResearchGraphStateV3>,
  options?: { completed?: boolean },
) {
  const merged = researchGraphStateV3Schema.parse({
    ...state,
    ...partial,
  });
  const publicStage = projectPublicStage(merged.internalStage);
  const status =
    partial.status ??
    (options?.completed ? 'completed' : projectStatus(publicStage));

  await updateRunExecutionState(merged.runId, {
    engineVersion: DEFAULT_ENGINE_VERSION,
    status,
    currentStage: publicStage,
    internalStage: merged.internalStage,
    loopIteration: merged.optionalRepairUsed ? 1 : 0,
    awaitingClarification: merged.pauseState.status === 'awaiting_user',
    clarificationQuestion: merged.pauseState.question,
    workflowStateJson: merged as unknown as Record<string, unknown>,
  });

  return {
    ...merged,
    status,
    publicStage,
    currentStage: publicStage,
  };
}

async function appendV3Event(
  state: ResearchGraphStateV3,
  stage: ResearchStage,
  eventType: string,
  message: string,
  payload: Record<string, unknown> = {},
) {
  await appendResearchEvent(state.runId, stage, eventType, message, {
    internalStage: state.internalStage,
    iteration: state.optionalRepairUsed ? 1 : 0,
    ...payload,
  });
}

function stripHtml(input: string) {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksUnreadableDocument(url: string, contentType: string | null, body: string) {
  const normalizedUrl = url.toLowerCase();
  const normalizedType = (contentType ?? '').toLowerCase();
  const sample = body.slice(0, 4000);
  const printableSample = sample.replace(/\s+/g, ' ').trim();
  const asciiWordChars = (printableSample.match(/[a-zA-Z]{2,}/g) ?? []).join('').length;
  const controlChars = (sample.match(/[\u0000-\u0008\u000B-\u001F\uFFFD]/g) ?? []).length;
  const pdfMarkers = /%pdf-|startxref|endobj|stream|endstream|\/flatedecode|xref/i.test(sample);

  if ((normalizedUrl.endsWith('.pdf') || normalizedType.includes('pdf')) && pdfMarkers) {
    return true;
  }

  if (printableSample.length >= 300 && asciiWordChars / printableSample.length < 0.2 && controlChars > 0) {
    return true;
  }

  return false;
}

function hasSubstantiveVisibleText(page: Pick<FetchedPage, 'url' | 'title' | 'text'>) {
  const normalizedUrl = page.url.toLowerCase();
  const normalizedTitle = page.title.toLowerCase();
  const normalizedText = page.text.toLowerCase();
  const wordCount = page.text.split(/\s+/).filter(Boolean).length;
  const uniqueWordCount = new Set(
    normalizedText
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4),
  ).size;
  const navSignals = [
    'app marketplace',
    'filters',
    'all apps',
    'sort by',
    'categories',
    'sign in',
    'cookie preferences',
    'privacy notice',
  ].filter((signal) => normalizedText.includes(signal)).length;

  if (normalizedUrl.includes('/apps?') || normalizedUrl.includes('/search?') || normalizedUrl.includes('/filter')) {
    return false;
  }

  if (
    normalizedTitle.includes('filters') ||
    normalizedTitle.includes('category') ||
    normalizedTitle.includes('marketplace')
  ) {
    return false;
  }

  if (wordCount < 140) {
    return false;
  }

  if (uniqueWordCount < 45) {
    return false;
  }

  if (navSignals >= 3 && wordCount < 260) {
    return false;
  }

  return true;
}

async function fetchPageRecord(source: ScoredSource): Promise<FetchedPage | null> {
  if (!source.url) {
    return null;
  }

  try {
    const response = await fetch(source.url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type');
    const html = await response.text();
    if (looksUnreadableDocument(source.url, contentType, html)) {
      return null;
    }

    const text = stripHtml(html).slice(0, 10_000);
    if (!text) {
      return null;
    }

    return {
      url: source.url,
      title: source.title,
      text,
      domain: source.domain,
      query: source.query,
      subtopic: source.subtopic,
      queryIntent: source.queryIntent,
      publishedYear: source.publishedYear,
      sourceCategory: source.sourceCategory,
      qualityScore: source.qualityScore,
      snippet: source.snippet,
      vendorPageType: source.vendorPageType,
      vendorTarget: source.vendorTarget,
      claimType: source.claimType,
      evidenceMode: source.evidenceMode,
    };
  } catch {
    return null;
  }
}

async function fetchCanonicalPageRecord(task: ResearchTask, page: CanonicalVendorPage): Promise<FetchedPage | null> {
  try {
    const response = await fetch(page.url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type');
    const html = await response.text();
    if (looksUnreadableDocument(page.url, contentType, html)) {
      return null;
    }

    const text = stripHtml(html).slice(0, 10_000);
    if (!text) {
      return null;
    }

    return {
      url: page.url,
      title: page.title,
      text,
      domain: (() => {
        try {
          return new URL(page.url).hostname;
        } catch {
          return null;
        }
      })(),
      query: `${task.vendorTarget ?? page.title} ${task.type === 'vendor_pricing' ? 'pricing' : 'product'}`,
      subtopic: task.type === 'vendor_pricing' ? 'vendor-pricing' : 'vendor-profile',
      queryIntent: getSearchIntentForTask(task),
      publishedYear: null,
      sourceCategory: 'vendor',
      qualityScore: 0.92,
      snippet: text.slice(0, 500),
      vendorPageType: page.vendorPageType,
      vendorTarget: task.vendorTarget,
      claimType: getClaimTypeForTask(task),
      evidenceMode: 'vendor-primary',
    };
  } catch {
    return null;
  }
}

async function summarizeFetchedPage(task: ResearchTask, page: FetchedPage) {
  return generateStructuredOutput<z.infer<typeof pageSummarySchema>>({
    schema: pageSummarySchema,
    system:
      'You are a GTM evidence summarizer. Summarize only what the provided page directly supports for the requested research task.',
    prompt: [
      `Task type: ${task.type}`,
      `Section: ${task.sectionKey}`,
      `Goal: ${task.goal}`,
      `Page title: ${page.title}`,
      `Page URL: ${page.url}`,
      `Page text:\n${page.text.slice(0, 6000)}`,
      'Return a concise summary, one direct excerpt, the covered evidence buckets, user cues, core features, CRM and ecosystem integrations (crmIntegrations must contain only explicitly named tool or product names such as "Salesforce", "HubSpot", or "Slack" — do not include counts like "5+ CRMs" or "100+ apps", generalizations, or editorial notes like "not listed on page"), pricing text if present, and contradiction signals.',
    ].join('\n\n'),
  });
}

function isThinOrIndexLikePage(page: FetchedPage, summary: z.infer<typeof pageSummarySchema>) {
  const combinedText = `${page.title} ${page.text} ${summary.summary} ${summary.excerpt}`.toLowerCase();
  const wordCount = combinedText.split(/\s+/).filter(Boolean).length;
  const evidenceBucketCount = summary.evidenceBuckets.filter(Boolean).length;
  const featureCount = summary.coreFeatures.filter(Boolean).length;
  const indexSignals = [
    'app marketplace',
    'filters',
    'category page',
    'search results',
    'all apps',
    'sort by',
    'showing results',
  ].filter((signal) => combinedText.includes(signal)).length;

  if (!hasSubstantiveVisibleText(page)) {
    return true;
  }

  if (wordCount < 180 && evidenceBucketCount === 0 && featureCount === 0) {
    return true;
  }

  if (indexSignals >= 2 && evidenceBucketCount < 2 && featureCount === 0) {
    return true;
  }

  return false;
}

function hasExtractableStatistic(text: string) {
  return /(\d+(\.\d+)?\s?%|\$ ?\d|\£ ?\d|\€ ?\d|\b\d+(\.\d+)?\s?(million|billion|m|bn)\b|\bcagr\b|\byoy\b|\busers?\b|\bcompanies\b)/i.test(text);
}

function getSearchIntentForTask(task: ResearchTask): SearchIntent {
  switch (task.type as FixedWorkerTaskType) {
    case 'vendor_profile':
      return 'competitor-features';
    case 'vendor_pricing':
      return 'pricing';
    case 'market_research':
      return 'market-size';
    case 'gtm_research':
      return 'gtm-channels';
    case 'buyer_research':
      return 'adoption';
    case 'risk_research':
    default:
      return 'buyer-pain';
  }
}

function getClaimTypeForTask(task: ResearchTask): ResearchFinding['claimType'] {
  switch (task.type as FixedWorkerTaskType) {
    case 'vendor_profile':
      return 'competitor-feature';
    case 'vendor_pricing':
      return 'pricing';
    case 'market_research':
      return 'market-sizing';
    case 'gtm_research':
      return 'gtm-channel';
    case 'risk_research':
      return 'risk';
    case 'buyer_research':
    default:
      return 'buyer-pain';
  }
}

function getCanonicalPagesForTask(task: ResearchTask) {
  if (task.type !== 'vendor_profile' && task.type !== 'vendor_pricing') {
    return [] as CanonicalVendorPage[];
  }

  const intent = getSearchIntentForTask(task);
  return resolveCanonicalVendorPages(task.vendorTarget, intent).filter((page) =>
    task.type === 'vendor_pricing'
      ? page.vendorPageType === 'pricing'
      : page.vendorPageType === 'product' || page.vendorPageType === 'docs',
  );
}

function getCanonicalPagesForTaskFromState(state: ResearchGraphStateV3, task: ResearchTask) {
  if (task.type !== 'vendor_profile' && task.type !== 'vendor_pricing') {
    return [] as CanonicalVendorPage[];
  }

  const discovered = task.vendorTarget ? state.discoveredVendorPages[task.vendorTarget] ?? [] : [];
  const registryPages = getCanonicalPagesForTask(task);
  const combined = [...registryPages, ...discovered];
  const seen = new Set<string>();
  return combined.filter((page) => {
    if (seen.has(page.url)) {
      return false;
    }
    seen.add(page.url);
    return task.type === 'vendor_pricing'
      ? page.vendorPageType === 'pricing'
      : page.vendorPageType === 'product' || page.vendorPageType === 'docs';
  });
}

function deriveEvidenceModeForPage(task: ResearchTask, page: Pick<FetchedPage, 'url' | 'sourceCategory' | 'vendorPageType'>) {
  if (
    (task.type === 'vendor_profile' || task.type === 'vendor_pricing') &&
    page.sourceCategory === 'vendor' &&
    page.vendorPageType &&
    page.vendorPageType !== 'unknown'
  ) {
    return 'vendor-primary' as const;
  }

  if (task.type === 'market_research') {
    return 'product-specific' as const;
  }

  if (task.type === 'buyer_research' || task.type === 'risk_research') {
    return 'independent-validation' as const;
  }

  if (page.sourceCategory === 'vendor') {
    return 'vendor-primary' as const;
  }

  return 'independent-validation' as const;
}

function classifyGtmEvidence(
  page: FetchedPage,
  summary: z.infer<typeof pageSummarySchema>,
) {
  const combined = [
    page.title,
    page.text,
    summary.summary,
    summary.excerpt,
    summary.evidenceBuckets.join(' '),
  ]
    .join(' ')
    .toLowerCase();

  const directSignals = [
    'buying process',
    'buyer journey',
    'evaluation',
    'shortlist',
    'self-serve',
    'self-service',
    'direct sales',
    'direct purchase',
    'marketplace',
    'reseller',
    'partner-led',
    'trial',
    'free trial',
    'freemium',
    'free tier',
    'demo',
    'approval',
    'security review',
    'purchase friction',
    'product-led',
    'plg',
    'sign up',
    'signup',
    'saas buying',
    'software buying',
    'purchase process',
    'purchasing process',
    'pilot program',
    'proof of concept',
    'how to buy',
    'get started',
    'try for free',
    'app store',
    'onboard',
    'software purchase',
    'buying guide',
  ].some((signal) => combined.includes(signal));
  const adjacentSignals = [
    'managed service provider',
    'msp market',
    'sector revenue',
    'board of trade',
    'business rates',
    'employment allowance',
    'fair payments code',
    'export support',
    'public procurement regime',
  ].some((signal) => combined.includes(signal));

  // Vendor pages that explicitly show distribution channels (self-serve, demo, trial) are
  // direct GTM evidence — the vendor is demonstrating their own route-to-market.
  // Only treat vendor pages as adjacent if they contain no direct GTM signals.
  if (page.sourceCategory === 'vendor' && !directSignals) {
    return 'adjacent' as const;
  }

  if (adjacentSignals && !directSignals) {
    return 'adjacent' as const;
  }

  return directSignals ? ('direct' as const) : ('adjacent' as const);
}

function buildEvidenceBucketsForTask(task: ResearchTask, summary: z.infer<typeof pageSummarySchema>) {
  const current = new Set(summary.evidenceBuckets);

  switch (task.type as FixedWorkerTaskType) {
    case 'buyer_research':
      current.add('buyer-workflow');
      current.add('adoption-readiness');
      break;
    case 'market_research':
      current.add('market-evidence');
      current.add('product-category');
      break;
    case 'gtm_research':
      if (summary.evidenceBuckets.some((bucket) => bucket.includes('buy') || bucket.includes('procurement'))) {
        current.add('buying-process');
      }
      if (summary.evidenceBuckets.some((bucket) => bucket.includes('channel') || bucket.includes('marketplace'))) {
        current.add('channel-preference');
      }
      if (
        summary.evidenceBuckets.some(
          (bucket) => bucket.includes('partner') || bucket.includes('reseller') || bucket.includes('direct'),
        )
      ) {
        current.add('partner-direct');
      }
      if (
        summary.evidenceBuckets.some(
          (bucket) =>
            bucket.includes('friction') ||
            bucket.includes('barrier') ||
            bucket.includes('privacy') ||
            bucket.includes('security'),
        )
      ) {
        current.add('purchase-friction');
      }
      break;
    case 'risk_research':
      current.add('risk-or-barrier');
      break;
    case 'vendor_pricing':
      current.add('canonical-pricing');
      current.add('purchase-friction');
      break;
    case 'vendor_profile':
      current.add('canonical-vendor');
      break;
  }

  return Array.from(current);
}

function addSubtopicEvidenceBuckets(evidenceBuckets: string[], subtopic: string) {
  const buckets = new Set(evidenceBuckets);
  const normalizedSubtopic = subtopic.toLowerCase();

  if (normalizedSubtopic === 'buying-process') {
    buckets.add('buying-process');
  }
  if (normalizedSubtopic === 'channel-preference') {
    buckets.add('channel-preference');
  }
  if (normalizedSubtopic === 'partner-msp-direct') {
    buckets.add('partner-direct');
  }
  if (normalizedSubtopic === 'purchase-friction') {
    buckets.add('purchase-friction');
  }

  return Array.from(buckets);
}

function getSectionHintsForTask(task: ResearchTask): NonDerivedSectionKey[] {
  switch (task.type as FixedWorkerTaskType) {
    case 'vendor_profile':
      return ['competitor-landscape'];
    case 'vendor_pricing':
      return ['pricing-and-packaging'];
    case 'buyer_research':
      return ['icp-and-buyer'];
    case 'market_research':
      return ['market-landscape'];
    case 'gtm_research':
      return ['gtm-motion'];
    case 'risk_research':
      // Regulatory and policy content often describes the channel landscape (installer schemes, SEG, grants)
      // so risk evidence is also admitted to the GTM section for selection.
      return ['risks-and-unknowns', 'gtm-motion'];
    default:
      return [task.sectionKey as NonDerivedSectionKey];
  }
}

function getWorkerSourcePolicy(task: ResearchTask, widened = false): WorkerSourcePolicy {
  const adjust = <T extends WorkerSourcePolicy>(policy: T): T => ({
    ...policy,
    minFetchQuality: widened ? Math.max(0.38, policy.minFetchQuality - 0.06) : policy.minFetchQuality,
    maxResults: widened ? policy.maxResults + 2 : policy.maxResults,
    allowedCategories:
      widened && policy.allowPreferredFallback
        ? dedupeStrings([...policy.allowedCategories, 'blog', 'community']) as T['allowedCategories']
        : policy.allowedCategories,
  });

  switch (task.type as FixedWorkerTaskType) {
    case 'market_research':
      return adjust({
        allowedCategories: ['official', 'research', 'media', 'blog'],
        minFetchQuality: task.attempt > 0 ? 0.5 : 0.56,
        directTopicThreshold: 1,
        maxResults: 4,
        preferredDomains: ['gov.uk', 'ons.gov.uk', 'oecd.org', 'statista.com'],
        preferredTerms: ['market', 'adoption', 'statistics', 'survey', 'forecast', 'report', 'benchmark'],
        allowPreferredFallback: true,
        allowAdjacentFetch: false,
      });
    case 'buyer_research':
      return adjust({
        allowedCategories: ['official', 'research', 'media', 'blog'],
        minFetchQuality: task.attempt > 0 ? 0.42 : 0.46,
        directTopicThreshold: 1,
        maxResults: 4,
        preferredDomains: ['gov.uk', 'ons.gov.uk', 'yougov.com', 'mintel.com', 'which.co.uk'],
        preferredTerms: ['survey', 'benchmark', 'buyer', 'workflow', 'pain point', 'adoption', 'decision', 'review'],
        allowPreferredFallback: true,
        allowAdjacentFetch: true,
      });
    case 'gtm_research':
      return adjust({
        allowedCategories: ['official', 'research', 'media', 'blog', 'vendor'],
        minFetchQuality: task.attempt > 0 ? 0.4 : 0.42,
        directTopicThreshold: 1,
        maxResults: 4,
        preferredDomains: ['gov.uk', 'which.co.uk', 'moneysavingexpert.com', 'energysavingtrust.org.uk'],
        preferredTerms: ['buying process', 'how to buy', 'purchase channel', 'route to market', 'direct', 'installer', 'partner', 'reseller', 'quote', 'comparison'],
        allowPreferredFallback: true,
        allowAdjacentFetch: true,
      });
    case 'risk_research':
      return adjust({
        allowedCategories: ['official', 'research', 'media', 'blog', 'vendor'],
        minFetchQuality: task.attempt > 0 ? 0.5 : 0.56,
        directTopicThreshold: 1,
        maxResults: 4,
        preferredDomains: ['gov.uk', 'which.co.uk', 'moneysavingexpert.com', 'ico.org.uk'],
        preferredTerms: ['regulation', 'compliance', 'risk', 'barrier', 'friction', 'warranty', 'installation', 'safety', 'privacy'],
        allowPreferredFallback: true,
        allowAdjacentFetch: true,
      });
    case 'vendor_profile':
    case 'vendor_pricing':
    default:
      return adjust({
        allowedCategories: ['vendor'],
        minFetchQuality: 0.8,
        directTopicThreshold: 1,
        maxResults: 2,
        preferredDomains: [],
        preferredTerms: [],
        allowPreferredFallback: false,
        allowAdjacentFetch: false,
      });
  }
}

function matchesPreferredDomain(domain: string | null | undefined, preferredDomains: string[]) {
  if (!domain) {
    return false;
  }

  return preferredDomains.some((preferredDomain) => domain === preferredDomain || domain.endsWith(`.${preferredDomain}`));
}

function matchesPreferredTerm(text: string, preferredTerms: string[]) {
  const lowered = text.toLowerCase();
  return preferredTerms.some((term) => lowered.includes(term));
}

function hasAdjacentWorkerSignal(
  task: ResearchTask,
  combinedText: string,
  brief: ResearchBrief | null,
  policy: WorkerSourcePolicy,
  source: ScoredSource,
) {
  if (!policy.allowAdjacentFetch) {
    return false;
  }

  const contextSeed = buildTaskContextSeed(task, brief);
  const contextMatch = contextSeed
    ? hasTopicSignal(combinedText, contextSeed, null, 1)
    : false;
  const preferredSignal =
    matchesPreferredDomain(source.domain, policy.preferredDomains) ||
    matchesPreferredTerm(combinedText, policy.preferredTerms);

  return contextMatch || preferredSignal;
}

function evaluateSearchResultsForTask(
  task: ResearchTask,
  results: ScoredSource[],
  topic: string,
  brief: ResearchBrief | null,
  options?: { widened?: boolean },
) {
  const topicSeed = buildTaskTopicSeed(task, topic, brief);
  const policy = getWorkerSourcePolicy(task, options?.widened ?? false);
  const rejected: RejectedSearchCandidate[] = [];

  const shortlisted = results
    .filter((source) => {
      const combined = [source.title, source.snippet, source.url ?? '', source.query, source.subtopic].join(' ');

      if (task.type === 'vendor_profile' || task.type === 'vendor_pricing') {
        const accepted = Boolean(source.url) && getCanonicalPagesForTask(task).some((page) => page.url === source.url);
        if (!accepted) {
          rejected.push({
            taskId: task.id,
            taskType: task.type,
            sectionKey: task.sectionKey,
            query: source.query,
            title: source.title,
            url: source.url,
            domain: source.domain,
            sourceCategory: source.sourceCategory,
            qualityScore: source.qualityScore,
            reason: 'not_canonical_vendor_url',
            attempt: task.attempt,
            widened: options?.widened ?? false,
          });
        }
        return accepted;
      }

      if (!policy.allowedCategories.includes(source.sourceCategory)) {
        rejected.push({
          taskId: task.id,
          taskType: task.type,
          sectionKey: task.sectionKey,
          query: source.query,
          title: source.title,
          url: source.url,
          domain: source.domain,
          sourceCategory: source.sourceCategory,
          qualityScore: source.qualityScore,
          reason: 'category_not_allowed',
          attempt: task.attempt,
          widened: options?.widened ?? false,
        });
        return false;
      }

      if (source.qualityScore < policy.minFetchQuality) {
        rejected.push({
          taskId: task.id,
          taskType: task.type,
          sectionKey: task.sectionKey,
          query: source.query,
          title: source.title,
          url: source.url,
          domain: source.domain,
          sourceCategory: source.sourceCategory,
          qualityScore: source.qualityScore,
          reason: 'quality_below_threshold',
          attempt: task.attempt,
          widened: options?.widened ?? false,
        });
        return false;
      }

      const directTopicMatch = hasTopicSignal(
        combined,
        topicSeed,
        task.vendorTarget,
        policy.directTopicThreshold,
      );
      const adjacentWorkerSignal = hasAdjacentWorkerSignal(task, combined, brief, policy, source);

      if (!directTopicMatch && !adjacentWorkerSignal) {
        rejected.push({
          taskId: task.id,
          taskType: task.type,
          sectionKey: task.sectionKey,
          query: source.query,
          title: source.title,
          url: source.url,
          domain: source.domain,
          sourceCategory: source.sourceCategory,
          qualityScore: source.qualityScore,
          reason: 'weak_topic_match',
          attempt: task.attempt,
          widened: options?.widened ?? false,
        });
        return false;
      }

      return true;
    })
    .sort((left, right) => {
      const leftText = [left.title, left.snippet, left.query, left.subtopic].join(' ');
      const rightText = [right.title, right.snippet, right.query, right.subtopic].join(' ');
      const leftScore =
        left.qualityScore +
        (matchesPreferredDomain(left.domain, policy.preferredDomains) ? 0.2 : 0) +
        (matchesPreferredTerm(leftText, policy.preferredTerms) ? 0.08 : 0) +
        (hasAdjacentWorkerSignal(task, leftText, brief, policy, left) ? 0.04 : 0);
      const rightScore =
        right.qualityScore +
        (matchesPreferredDomain(right.domain, policy.preferredDomains) ? 0.2 : 0) +
        (matchesPreferredTerm(rightText, policy.preferredTerms) ? 0.08 : 0) +
        (hasAdjacentWorkerSignal(task, rightText, brief, policy, right) ? 0.04 : 0);
      return rightScore - leftScore;
    })
    .slice(0, policy.maxResults);

  return {
    shortlisted,
    rejected,
  };
}

async function persistSummarizedPages(
  state: ResearchGraphStateV3,
  runId: string,
  task: ResearchTask,
  plannedQueries: PlannedSearchQuery[],
  summarizedPages: SummarizedPage[],
) {
  const sectionHints = getSectionHintsForTask(task);
  const persistedSources = await saveResearchSources(
    runId,
    summarizedPages.map(({ page, summary }) => {
      const evidenceMode = deriveEvidenceModeForPage(task, page);
      const claimType = getClaimTypeForTask(task);
      const evidenceBuckets = addSubtopicEvidenceBuckets(
        buildEvidenceBucketsForTask(task, summary),
        page.subtopic,
      );
      const gtmEvidenceClass = task.type === 'gtm_research' ? classifyGtmEvidence(page, summary) : null;
      return {
        sourceType: 'web' as const,
        title: page.title,
        url: page.url,
        snippet: summary.excerpt,
        metadataJson: {
          query: page.query,
          subtopic: page.subtopic,
          queryIntent: page.queryIntent,
          taskType: task.type,
          taskSectionKey: task.sectionKey,
          primarySectionHint: sectionHints[0] ?? task.sectionKey,
          sectionHints,
          claimType,
          evidenceMode,
          evidenceBuckets,
          gtmEvidenceClass,
          vendorTarget: task.vendorTarget,
          vendorPageType: page.vendorPageType,
          domain: page.domain,
          sourceCategory: page.sourceCategory,
          qualityScore: page.qualityScore,
          qualityLabel: page.qualityScore >= 0.8 ? 'high' : page.qualityScore >= 0.62 ? 'medium' : 'low',
          recency:
            page.publishedYear != null && new Date().getUTCFullYear() - page.publishedYear <= 1
              ? 'current'
              : page.publishedYear != null
                ? 'recent'
                : 'unknown',
          publishedYear: page.publishedYear,
          rationale: summary.summary,
          fullPageSummary: summary.summary,
          contradictionSignals: summary.contradictionSignals,
          targetUser: summary.targetUser,
          coreFeatures: summary.coreFeatures,
          crmIntegrations: summary.crmIntegrations,
          planPricingText: summary.pricingText,
          usedInSynthesis: true,
          fetchedFullPage: true,
          isPrimary: page.sourceCategory === 'official' || page.sourceCategory === 'research',
          canonicalVendorEvidence: getCanonicalPagesForTaskFromState(state, task).some(
            (candidatePage) => candidatePage.url === page.url,
          ),
        },
      };
    }),
  );

  const evidence = await saveResearchEvidence(
    runId,
    persistedSources.map((source, index) => ({
      sourceType: 'web',
      sourceId: source.id,
      sectionKey: null,
      title: source.title,
      url: source.url,
      excerpt: summarizedPages[index]?.summary.excerpt ?? source.snippet ?? source.title,
      metadataJson: source.metadataJson,
    })),
  );

  const candidates = await saveResearchRetrievalCandidates(
    runId,
    persistedSources.map((source) => ({
      sourceType: 'web',
      retrieverType: 'web_search',
      sectionKey: null,
      query: plannedQueries[0]?.query ?? task.goal,
      sourceId: source.id,
      title: source.title,
      url: source.url,
      claimType: coerceClaimType(source.metadataJson.claimType),
      evidenceMode: coerceEvidenceMode(source.metadataJson.evidenceMode),
      vendorTarget: typeof source.metadataJson.vendorTarget === 'string' ? source.metadataJson.vendorTarget : null,
      rawScore: typeof source.metadataJson.qualityScore === 'number' ? source.metadataJson.qualityScore : 0,
      fusedScore: typeof source.metadataJson.qualityScore === 'number' ? source.metadataJson.qualityScore : 0,
      selected: true,
      metadataJson: source.metadataJson,
    })),
  );

  return {
    sources: persistedSources,
    evidence,
    candidates,
  };
}

async function runDocumentSupport(
  state: ResearchGraphStateV3,
  task: ResearchTask,
) {
  if (state.selectedDocumentIds.length === 0) {
    return {
      evidenceIds: [] as string[],
      candidateIds: [] as string[],
    };
  }

  const graphishState = {
    topic: state.topic,
    objective: state.objective ?? undefined,
    plan: state.plan as ResearchPlan | null,
  } as ResearchGraphState;

  const denseQuery = buildSectionQuery(graphishState, task.sectionKey);
  const lexicalQuery = buildLexicalQuery(graphishState, task.sectionKey);
  const embedding = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: denseQuery,
  });
  const supabase = createSupabaseServerClient();

  const [denseResponse, lexicalResponse] = await Promise.all([
    supabase.rpc('match_run_documents', {
      query_embedding: JSON.stringify(embedding.data[0].embedding),
      match_count: 4,
      document_ids: state.selectedDocumentIds,
    }),
    supabase.rpc('match_run_documents_lexical', {
      search_query: lexicalQuery,
      match_count: 4,
      document_ids: state.selectedDocumentIds,
    }),
  ]);

  if (denseResponse.error) {
    throw new Error(denseResponse.error.message);
  }

  if (lexicalResponse.error) {
    throw new Error(lexicalResponse.error.message);
  }

  const denseMatches = ((denseResponse.data ?? []) as DocumentMatchRow[]).map((match, index) => ({
    id: String(match.id),
    rank: index + 1,
    score: Number((match.similarity ?? 0).toFixed(6)),
    match,
  }));
  const lexicalMatches = ((lexicalResponse.data ?? []) as LexicalMatchRow[]).map((match, index) => ({
    id: String(match.id),
    rank: index + 1,
    score: Number((match.rank_score ?? 0).toFixed(6)),
    match,
  }));
  const fused = reciprocalRankFuse(
    [...denseMatches, ...lexicalMatches].length === 0
      ? []
      : ([denseMatches, lexicalMatches] as Array<Array<{ id: string; rank: number; score: number; match: DocumentMatchRow | LexicalMatchRow }>>),
  ).slice(0, 2);

  const existingSources = await listResearchSources(state.runId);
  const sourceIdByDocument = new Map(
    existingSources
      .filter((source) => source.sourceType === 'document')
      .map((source) => [
        typeof source.metadataJson.documentExternalId === 'string'
          ? source.metadataJson.documentExternalId
          : '',
        source.id,
      ]),
  );

  const missingDocuments = state.linkedDocuments.filter(
    (document) => !sourceIdByDocument.has(document.documentExternalId),
  );

  if (missingDocuments.length > 0) {
    const persisted = await saveResearchSources(
      state.runId,
      missingDocuments.map((document) => ({
        sourceType: 'document',
        title: document.fileName ?? `Document ${document.documentExternalId}`,
        url: null,
        snippet: null,
        metadataJson: {
          documentExternalId: document.documentExternalId,
          fileName: document.fileName,
        },
      })),
    );
    for (const source of persisted) {
      if (typeof source.metadataJson.documentExternalId === 'string') {
        sourceIdByDocument.set(source.metadataJson.documentExternalId, source.id);
      }
    }
  }

  const existingEvidence = await listResearchEvidence(state.runId);
  const existingChunkKeys = new Set(
    existingEvidence
      .filter((record) => record.sourceType === 'document')
      .map((record) => `${record.documentExternalId ?? 'unknown'}:${record.documentChunkId ?? 'none'}`),
  );

  const evidenceInputs = fused
    .map(({ candidate, fusedScore }) => {
      const denseMatch = denseMatches.find((entry) => entry.id === candidate.id)?.match;
      const lexicalMatch = lexicalMatches.find((entry) => entry.id === candidate.id)?.match;
      const match = denseMatch ?? lexicalMatch;
      if (!match) {
        return null;
      }

      const metadata = match.metadata ?? {};
      const documentExternalId =
        typeof metadata.document_id === 'string' ? metadata.document_id : null;
      const chunkKey = `${documentExternalId ?? 'unknown'}:${match.id}`;
      if (existingChunkKeys.has(chunkKey)) {
        return null;
      }

      return {
        sourceType: 'document' as const,
        sourceId: documentExternalId ? sourceIdByDocument.get(documentExternalId) ?? null : null,
        documentChunkId: match.id ?? null,
        documentExternalId,
        sectionKey: null,
        title: typeof metadata.file_name === 'string' ? metadata.file_name : `Document chunk ${match.id}`,
        url: typeof metadata.file_url === 'string' ? metadata.file_url : null,
        excerpt: match.content ?? '',
        metadataJson: {
          fileName: typeof metadata.file_name === 'string' ? metadata.file_name : null,
          similarity: denseMatch?.similarity ?? null,
          lexicalRankScore: lexicalMatch?.rank_score ?? null,
          qualityScore: 0.84,
          sourceCategory: 'research',
          claimType: getClaimTypeForTask(task),
          evidenceMode: 'document-internal',
          queryIntent: getSearchIntentForTask(task),
          subtopic: task.gapType,
          taskType: task.type,
          taskSectionKey: task.sectionKey,
          primarySectionHint: task.sectionKey,
          sectionHints: [task.sectionKey],
          gtmEvidenceClass: task.type === 'gtm_research' ? 'direct' : null,
          usedInSynthesis: true,
          fusedScore,
        },
      };
    })
    .filter(isPresent);

  const persistedEvidence = await saveResearchEvidence(state.runId, evidenceInputs);
  const persistedCandidates = await saveResearchRetrievalCandidates(
    state.runId,
    evidenceInputs.map((input) => ({
      sourceType: 'document',
      retrieverType: 'fusion',
      sectionKey: null,
      query: denseQuery,
      sourceId: input.sourceId,
      documentExternalId: input.documentExternalId,
      documentChunkId: input.documentChunkId,
      title: input.title,
      url: input.url,
      claimType: coerceClaimType(input.metadataJson.claimType),
      evidenceMode: coerceEvidenceMode(input.metadataJson.evidenceMode),
      vendorTarget: null,
      rawScore: typeof input.metadataJson.similarity === 'number' ? input.metadataJson.similarity : 0.84,
      fusedScore: typeof input.metadataJson.fusedScore === 'number' ? input.metadataJson.fusedScore : 0.84,
      selected: true,
      metadataJson: input.metadataJson,
    })),
  );

  return {
    evidenceIds: persistedEvidence.map((record) => record.id),
    candidateIds: persistedCandidates.map((candidate) => candidate.id),
  };
}

function buildWorkerOutput(
  task: ResearchTask,
  persistedUrls: string[],
  evidenceIds: string[],
  summaries: SummarizedPage[],
  documentEvidenceIds: string[],
): ResearchWorkerOutput {
  const payload: Record<string, unknown> = {};
  const combinedSummary = dedupeStrings(
    summaries.map((entry) => entry.summary.summary.trim()).filter(Boolean),
  )
    .slice(0, 3)
    .join(' ');

  if (task.type === 'vendor_profile') {
    payload.coreCapabilities = dedupeStrings(summaries.flatMap((entry) => entry.summary.coreFeatures)).slice(0, 8);
    payload.crmIntegrations = dedupeStrings(summaries.flatMap((entry) => entry.summary.crmIntegrations)).slice(0, 8);
    payload.securityClaims = summaries
      .flatMap((entry) => entry.summary.contradictionSignals)
      .slice(0, 4);
    payload.productExcerpts = summaries.map((entry) => entry.summary.excerpt).slice(0, 4);
  }

  if (task.type === 'vendor_pricing') {
    payload.publishedPrices = dedupeStrings(
      summaries.map((entry) => entry.summary.pricingText ?? '').filter(Boolean),
    );
    payload.ambiguities = summaries.flatMap((entry) => entry.summary.contradictionSignals).slice(0, 4);
  }

  if (task.type === 'buyer_research') {
    payload.buyerRoles = dedupeStrings(
      summaries.map((entry) => entry.summary.targetUser ?? '').filter(Boolean),
    );
    payload.workflowPains = summaries.flatMap((entry) => entry.summary.evidenceBuckets).slice(0, 6);
  }

  if (task.type === 'market_research') {
    payload.marketSignals = summaries.map((entry) => entry.summary.excerpt).slice(0, 3);
  }

  if (task.type === 'gtm_research') {
    payload.gtmSignals = dedupeStrings(summaries.flatMap((entry) => entry.summary.evidenceBuckets)).slice(0, 10);
    payload.buyingSignals = summaries
      .filter((entry) => entry.page.subtopic === 'buying-process')
      .map((entry) => entry.summary.summary)
      .slice(0, 2);
    payload.channelSignals = summaries
      .filter((entry) => entry.page.subtopic === 'channel-preference' || entry.page.subtopic === 'partner-msp-direct')
      .map((entry) => entry.summary.summary)
      .slice(0, 3);
    payload.frictionSignals = summaries
      .filter((entry) => entry.page.subtopic === 'purchase-friction')
      .map((entry) => entry.summary.summary)
      .slice(0, 2);
  }

  if (task.type === 'risk_research') {
    payload.barriers = summaries.flatMap((entry) => entry.summary.evidenceBuckets).slice(0, 6);
  }

  if (documentEvidenceIds.length > 0) {
    payload.documentEvidenceIds = documentEvidenceIds;
  }

  return {
    taskId: task.id,
    taskType: task.type,
    sectionKey: task.sectionKey,
    summary: combinedSummary || summaries[0]?.summary.summary || null,
    vendor: task.vendorTarget,
    urls: persistedUrls,
    evidenceIds: [...evidenceIds, ...documentEvidenceIds],
    payload,
  };
}

function summarizeTaskResult(
  task: ResearchTask,
  sourceIds: string[],
  evidenceIds: string[],
  candidateIds: string[],
): ResearchTaskResult {
  const completed = evidenceIds.length > 0 || candidateIds.length > 0;
  return {
    taskId: task.id,
    status: completed ? 'completed' : 'no_new_evidence',
    newSourceIds: sourceIds,
    newEvidenceIds: evidenceIds,
    newCandidateIds: candidateIds,
    remainingGaps: completed ? [] : [task.gapType],
    recommendedFollowups: completed ? [] : ['No strong evidence was found for this worker.'],
  };
}

async function runOneWorker(
  state: ResearchGraphStateV3,
  task: ResearchTask,
  searchService: WebSearchService,
) {
  const plannedQueries = buildQueriesForTask(task, state);
  const priorFingerprints = new Set(state.queryLedger.map((entry) => entry.fingerprint));
  const executableQueries = plannedQueries.filter((query) => !priorFingerprints.has(fingerprintQuery(query.query)));
  const canonicalPages = getCanonicalPagesForTaskFromState(state, task);
  const searchResults =
    task.type === 'vendor_profile' || task.type === 'vendor_pricing'
      ? []
      : executableQueries.length > 0
        ? await searchService.searchMany(executableQueries)
        : [];
  const initialEvaluation = evaluateSearchResultsForTask(task, searchResults, state.topic, state.brief);
  const fallbackQueries = buildFallbackQueriesForTask(task, state).filter(
    (query) => !priorFingerprints.has(fingerprintQuery(query.query)) && !executableQueries.some((existing) => existing.query === query.query),
  );
  const fallbackSearchResults =
    task.type === 'vendor_profile' || task.type === 'vendor_pricing'
      ? []
      : initialEvaluation.shortlisted.length === 0 && fallbackQueries.length > 0
        ? await searchService.searchMany(fallbackQueries)
        : [];
  const executedQueries = [
    ...executableQueries,
    ...(fallbackSearchResults.length > 0 ? fallbackQueries : []),
  ];
  const fallbackEvaluation =
    fallbackSearchResults.length > 0
      ? evaluateSearchResultsForTask(task, fallbackSearchResults, state.topic, state.brief, {
          widened: true,
        })
      : { shortlisted: [] as ScoredSource[], rejected: [] as RejectedSearchCandidate[] };
  const shortlisted = [...initialEvaluation.shortlisted, ...fallbackEvaluation.shortlisted]
    .filter((source, index, allSources) => allSources.findIndex((candidate) => candidate.url === source.url) === index);
  const fetchedPages =
    task.type === 'vendor_profile' || task.type === 'vendor_pricing'
      ? (await Promise.all(canonicalPages.map(async (page) => ({ page, fetched: await fetchCanonicalPageRecord(task, page) })))).map((entry) => entry.fetched).filter(isPresent)
      : (
          await Promise.all(
            shortlisted.map(async (source) => ({
              source,
              fetched: await fetchPageRecord(source),
            })),
          )
        )
          .filter((entry) => {
            if (entry.fetched) {
              return true;
            }
            return false;
          })
          .map((entry) => entry.fetched)
          .filter(isPresent);
  const rawSummaries = await Promise.all(
    fetchedPages.map(async (page) => ({
      page,
      summary: await summarizeFetchedPage(task, page),
    })),
  );
  const thinPageRejections: RejectedSearchCandidate[] = [];
  const summarizedPages = rawSummaries.filter((entry) => {
    if (isThinOrIndexLikePage(entry.page, entry.summary)) {
      thinPageRejections.push({
        taskId: task.id,
        taskType: task.type,
        sectionKey: task.sectionKey,
        query: entry.page.query,
        title: entry.page.title,
        url: entry.page.url,
        domain: entry.page.domain,
        sourceCategory: entry.page.sourceCategory,
        qualityScore: entry.page.qualityScore,
        reason: 'thin_page_content',
        attempt: task.attempt,
        widened: false,
      });
      return false;
    }

    if (task.type === 'market_research') {
      if (!hasExtractableStatistic(`${entry.summary.summary} ${entry.summary.excerpt} ${entry.page.text}`)) {
        thinPageRejections.push({
          taskId: task.id,
          taskType: task.type,
          sectionKey: task.sectionKey,
          query: entry.page.query,
          title: entry.page.title,
          url: entry.page.url,
          domain: entry.page.domain,
          sourceCategory: entry.page.sourceCategory,
          qualityScore: entry.page.qualityScore,
          reason: 'no_extractable_market_statistic',
          attempt: task.attempt,
          widened: false,
        });
        return false;
      }
      return true;
    }
    return true;
  });

  const persisted = await persistSummarizedPages(state, state.runId, task, plannedQueries, summarizedPages);
  const documentSupport =
    task.type === 'buyer_research' ||
    task.type === 'market_research' ||
    task.type === 'risk_research' ||
    task.type === 'gtm_research'
      ? await runDocumentSupport(state, task)
      : { evidenceIds: [] as string[], candidateIds: [] as string[] };
  const workerOutput = buildWorkerOutput(
    task,
    persisted.sources.map((source) => source.url).filter((url): url is string => Boolean(url)),
    persisted.evidence.map((record) => record.id),
    summarizedPages,
    documentSupport.evidenceIds,
  );

  return {
    task,
    taskResult: summarizeTaskResult(
      task,
      persisted.sources.map((source) => source.id),
      [...persisted.evidence.map((record) => record.id), ...documentSupport.evidenceIds],
      [...persisted.candidates.map((candidate) => candidate.id), ...documentSupport.candidateIds],
    ),
    queryLedger: executedQueries.map((query) => ({
      fingerprint: fingerprintQuery(query.query),
      sectionKey: query.sectionKey,
      query: query.query,
      sourcePreference: query.sourcePreference,
      attempt: task.attempt,
      yieldedEvidenceCount: persisted.evidence.length + documentSupport.evidenceIds.length,
    })),
    sourceFetchLedger: summarizedPages.map((entry) => ({
      url: entry.page.url,
      sectionKey: task.sectionKey,
      taskId: task.id,
      fetchedAt: new Date().toISOString(),
    })) satisfies SourceFetchLedgerEntry[],
    rejectedSearchCandidates: [...initialEvaluation.rejected, ...fallbackEvaluation.rejected, ...thinPageRejections],
    workerOutput,
  };
}

async function hydrateLedgerState(
  state: Pick<ResearchGraphStateV3, 'runId' | 'topic' | 'objective' | 'status' | 'currentStage' | 'plan' | 'finalReportMarkdown'>,
) {
  return buildInitialGraphState(state.runId, {
    topic: state.topic,
    objective: state.objective ?? null,
    status: state.status,
    currentStage: state.currentStage,
    planJson: state.plan,
    finalReportMarkdown: state.finalReportMarkdown,
  });
}

function buildSectionStates(state: ResearchGraphStateV3): SectionState[] {
  const pricingProfiles = buildDeterministicCompetitorProfiles(state.evidenceRecords)
    .filter((profile) => profile.hasPricingEvidence);
  const pricingVendorCount = new Set(pricingProfiles.map((profile) => profile.vendor)).size;

  return [
    ...nonDerivedSectionKeys.map((sectionKey) => {
      const selectedEvidence = selectEvidenceForSection(sectionKey, state.evidenceRecords);
      const selectedCandidates = filterCandidatesForSection(sectionKey, state.retrievalCandidates)
        .filter((candidate) => candidate.selected);
      const assessment = assessSectionStatus(sectionKey, state.evidenceRecords, state.findings);
      const contradictions = state.findings
        .filter((finding) => finding.sectionKey === sectionKey)
        .flatMap((finding) => finding.contradictions);
      const gaps = [...assessment.notes];
      let coverageStatus: SectionState['coverageStatus'] =
        assessment.status === 'ready'
          ? 'satisfied'
          : assessment.status === 'needs-review'
            ? 'needs_repair'
          : selectedEvidence.length === 0 && selectedCandidates.length === 0
            ? 'unstarted'
            : 'insufficient_evidence';

      if (sectionKey === 'competitor-landscape') {
        const vendorCount = countDistinctCompetitorVendors(selectedEvidence);
        if (vendorCount < 2) {
          coverageStatus = selectedEvidence.length === 0 ? 'unstarted' : 'insufficient_evidence';
          gaps.push('Competitor section needs canonical evidence from at least two distinct vendors.');
        }
      }

      if (sectionKey === 'pricing-and-packaging' && pricingVendorCount < 2) {
        coverageStatus = selectedEvidence.length === 0 ? 'unstarted' : 'insufficient_evidence';
        gaps.push('Pricing section needs canonical pricing evidence from at least two distinct vendors.');
      }

      return {
        sectionKey,
        coverageStatus,
        selectedEvidenceIds: dedupeStrings(selectedEvidence.map((record) => record.id)),
        selectedCandidateIds: dedupeStrings(selectedCandidates.map((candidate) => candidate.id)),
        gaps: dedupeStrings(gaps),
        contradictions: dedupeStrings(contradictions),
        lastImprovedIteration: state.optionalRepairUsed ? 1 : 0,
      } satisfies SectionState;
    }),
    {
      sectionKey: 'recommendation',
      coverageStatus: 'unstarted',
      selectedEvidenceIds: [],
      selectedCandidateIds: [],
      gaps: [],
      contradictions: [],
      lastImprovedIteration: null,
    } satisfies SectionState,
  ];
}

function hasNonVendorEvidence(sectionKey: NonDerivedSectionKey, evidenceRecords: ResearchEvidence[]) {
  return selectEvidenceForSection(sectionKey, evidenceRecords).some((record) => {
    const category = typeof record.metadataJson.sourceCategory === 'string'
      ? record.metadataJson.sourceCategory
      : record.sourceType === 'document'
        ? 'research'
        : 'blog';
    return category === 'official' || category === 'research' || category === 'media' || record.sourceType === 'document';
  });
}

const SAME_SHAPE_REJECTION_REASONS = new Set([
  'quality_below_threshold',
  'weak_topic_match',
]);

function shouldSkipOptionalRepairForTask(
  state: ResearchGraphStateV3,
  taskType: FixedWorkerTaskType,
  sectionKey: NonDerivedSectionKey,
) {
  const priorQueries = state.queryLedger.filter(
    (entry) => entry.sectionKey === sectionKey && entry.attempt === 0,
  );
  if (priorQueries.length === 0) {
    return false;
  }

  const zeroYield = priorQueries.every((entry) => entry.yieldedEvidenceCount === 0);
  if (!zeroYield) {
    return false;
  }

  const priorRejections = state.rejectedSearchCandidates.filter(
    (entry) =>
      entry.taskType === taskType &&
      entry.sectionKey === sectionKey &&
      entry.attempt === 0,
  );

  return priorRejections.length > 0 && priorRejections.every((entry) => SAME_SHAPE_REJECTION_REASONS.has(entry.reason));
}

function filterFindingsForV3(
  findings: ResearchFinding[],
  evidenceRecords: ResearchEvidence[],
) {
  const competitorVendorCount = countDistinctCompetitorVendors(
    selectEvidenceForSection('competitor-landscape', evidenceRecords),
  );
  const pricingVendorCount = new Set(
    buildDeterministicCompetitorProfiles(evidenceRecords)
      .filter((profile) => profile.hasPricingEvidence)
      .map((profile) => profile.vendor),
  ).size;

  return findings.filter((finding) => {
    switch (finding.sectionKey) {
      case 'competitor-landscape':
        return competitorVendorCount >= 2;
      case 'pricing-and-packaging':
        return pricingVendorCount >= 2;
      default:
        return true;
    }
  });
}

function buildCitationIndex(evidenceRecords: ResearchEvidence[]) {
  return new Map(
    evidenceRecords.map((record) => [
      record.id,
      {
        evidenceId: record.id,
        sourceId: record.sourceId ?? record.id,
        sourceType: record.sourceType,
        title: record.title,
        url: record.url,
        excerpt: record.excerpt,
        documentExternalId: record.documentExternalId ?? null,
        documentChunkId: record.documentChunkId ?? null,
      } satisfies Citation,
    ]),
  );
}

function citationsFromEvidenceIds(evidenceIds: string[], citationIndex: Map<string, Citation>) {
  return dedupeStrings(evidenceIds).map((evidenceId) => citationIndex.get(evidenceId)).filter(isPresent);
}

function getWorkerOutputsByType(state: ResearchGraphStateV3, type: FixedWorkerTaskType) {
  return state.workerOutputs.filter(
    (output): output is ResearchWorkerOutput & { taskType: FixedWorkerTaskType } =>
      output.taskType === type,
  );
}

function buildWorkerDrivenFindings(
  state: ResearchGraphStateV3,
  evidenceRecords: ResearchEvidence[],
) {
  const citationIndex = buildCitationIndex(evidenceRecords);
  const findings: ResearchFinding[] = [];
  const competitorOutputs = getWorkerOutputsByType(state, 'vendor_profile').filter(
    (output) => output.evidenceIds.length > 0,
  );
  const pricingOutputs = getWorkerOutputsByType(state, 'vendor_pricing').filter(
    (output) => output.evidenceIds.length > 0,
  );
  const buyerOutputs = getWorkerOutputsByType(state, 'buyer_research').filter(
    (output) => output.evidenceIds.length > 0,
  );
  const marketOutputs = getWorkerOutputsByType(state, 'market_research').filter(
    (output) => output.evidenceIds.length > 0,
  );
  const gtmOutputs = getWorkerOutputsByType(state, 'gtm_research').filter(
    (output) => output.evidenceIds.length > 0,
  );
  const riskOutputs = getWorkerOutputsByType(state, 'risk_research').filter(
    (output) => output.evidenceIds.length > 0,
  );
  const gtmEvidenceSignals = getGtmEvidenceSignals(
    selectEvidenceForSection('gtm-motion', evidenceRecords),
  );

  if (competitorOutputs.length >= 2) {
    const vendorSummaries = competitorOutputs.slice(0, 2).map((output) => {
      const capabilities = Array.isArray(output.payload.coreCapabilities)
        ? output.payload.coreCapabilities.filter((value): value is string => typeof value === 'string')
        : [];
      const crmIntegrations = Array.isArray(output.payload.crmIntegrations)
        ? output.payload.crmIntegrations
            .filter((value): value is string => typeof value === 'string')
            // Keep only short, explicitly named tools — drop counts ("5+ CRMs"), generalizations, and editorial annotations
            .filter((v) => v.trim().length <= 50 && !/^\d+\+/i.test(v.trim()) && !v.includes('—') && !v.toLowerCase().includes('not listed'))
        : [];
      const capabilityText = capabilities.slice(0, 3).join(', ');
      const integrationText =
        crmIntegrations.length > 0 ? `; named CRM integrations include ${crmIntegrations.slice(0, 3).join(', ')}` : '';
      return `${output.vendor}: ${capabilityText}${integrationText}`;
    });
    findings.push({
      sectionKey: 'competitor-landscape',
      claimType: 'competitor-feature',
      claim: `Canonical vendor product pages show differentiated positioning across the comparison set. ${vendorSummaries.join(' ')}`,
      evidence: citationsFromEvidenceIds(competitorOutputs.flatMap((output) => output.evidenceIds), citationIndex),
      evidenceMode: 'vendor-primary',
      inferenceLabel: 'direct',
      confidence: 'medium',
      status: 'draft',
      verificationNotes:
        'Built only from canonical vendor product and integrations evidence using directly named capabilities and CRM integrations from worker payloads.',
      gaps: [
        'No independent head-to-head benchmark or UK SMB buyer outcome evidence in the current set.',
      ],
      contradictions: [],
    });
  }

  if (pricingOutputs.length >= 2) {
    const pricingLines = pricingOutputs.slice(0, 2).map((output) => {
      const publishedPrices = Array.isArray(output.payload.publishedPrices)
        ? output.payload.publishedPrices.filter((value): value is string => typeof value === 'string')
        : [];
      return `${output.vendor}: ${publishedPrices[0] ?? 'pricing structure documented on canonical pricing page'}`;
    });
    findings.push({
      sectionKey: 'pricing-and-packaging',
      claimType: 'pricing',
      claim: `Canonical pricing pages indicate a split between self-serve entry pricing and enterprise contact-sales packaging across the comparison set. ${pricingLines.join(' ')}`,
      evidence: citationsFromEvidenceIds(pricingOutputs.flatMap((output) => output.evidenceIds), citationIndex),
      evidenceMode: 'vendor-primary',
      inferenceLabel: 'direct',
      confidence: 'high',
      status: 'draft',
      verificationNotes: 'Built only from canonical vendor pricing pages returned by the fixed worker plan.',
      gaps: [
        'No UK-local currency, VAT, or reseller discount evidence in the current set.',
      ],
      contradictions: [],
    });
  }

  if (marketOutputs.length > 0) {
    const usableMarketOutput = marketOutputs.find((output) => Boolean(output.summary));
    if (usableMarketOutput) {
      findings.push({
        sectionKey: 'market-landscape',
        claimType: 'market-sizing',
        claim: usableMarketOutput.summary ?? '',
        evidence: citationsFromEvidenceIds(usableMarketOutput.evidenceIds, citationIndex),
        evidenceMode: 'product-specific',
        inferenceLabel: 'direct',
        confidence: 'medium',
        status: 'draft',
        verificationNotes: 'Built from readable, extractable market/adoption sources only.',
        gaps: [],
        contradictions: [],
      });
    }
  }

  if (buyerOutputs.length > 0) {
    const usableBuyerOutput = buyerOutputs.find((output) => Boolean(output.summary));
    if (usableBuyerOutput) {
      findings.push({
        sectionKey: 'icp-and-buyer',
        claimType: 'buyer-pain',
        claim: usableBuyerOutput.summary ?? '',
        evidence: citationsFromEvidenceIds(usableBuyerOutput.evidenceIds, citationIndex),
        evidenceMode: 'independent-validation',
        inferenceLabel: 'direct',
        confidence: 'medium',
        status: 'draft',
        verificationNotes: 'Built from buyer worker outputs and non-vendor supporting evidence.',
        gaps: [],
        contradictions: [],
      });
    }
  }

  if (riskOutputs.length > 0) {
    const usableRiskOutput = riskOutputs.find((output) => Boolean(output.summary));
    if (usableRiskOutput) {
      findings.push({
        sectionKey: 'risks-and-unknowns',
        claimType: 'risk',
        claim: usableRiskOutput.summary ?? '',
        evidence: citationsFromEvidenceIds(usableRiskOutput.evidenceIds, citationIndex),
        evidenceMode: 'independent-validation',
        inferenceLabel: 'direct',
        confidence: 'medium',
        status: 'draft',
        verificationNotes: 'Built from non-vendor risk, compliance, or rollout evidence.',
        gaps: [],
        contradictions: [],
      });
    }
  }

  if (gtmOutputs.length > 0 && gtmEvidenceSignals.directEvidenceCount > 0) {
    const usableGtmOutput = gtmOutputs.find((output) => Boolean(output.summary));
    if (usableGtmOutput) {
      findings.push({
        sectionKey: 'gtm-motion',
        claimType: 'gtm-channel',
        claim: usableGtmOutput.summary ?? '',
        evidence: citationsFromEvidenceIds(usableGtmOutput.evidenceIds, citationIndex),
        evidenceMode: 'independent-validation',
        inferenceLabel: 'direct',
        confidence: 'medium',
        status: 'draft',
        verificationNotes: 'Built from dedicated GTM worker outputs covering buying process, channel preference, partner or direct routes, and purchase friction.',
        gaps: [],
        contradictions: [],
      });
    }
  } else if (buyerOutputs.length > 0 && pricingOutputs.length > 0 && competitorOutputs.length > 0) {
    findings.push({
      sectionKey: 'gtm-motion',
      claimType: 'gtm-channel',
      claim: 'The comparison set suggests a mixed GTM motion: self-serve or free entry for initial adoption, with a sales-assisted or custom path for larger deployments and more advanced packaging.',
      evidence: citationsFromEvidenceIds(
        [
          ...buyerOutputs.flatMap((output) => output.evidenceIds),
          ...pricingOutputs.flatMap((output) => output.evidenceIds),
          ...competitorOutputs.flatMap((output) => output.evidenceIds),
        ],
        citationIndex,
      ).slice(0, 6),
      evidenceMode: 'independent-validation',
      inferenceLabel: 'inferred',
      confidence: 'medium',
      status: 'draft',
      verificationNotes: 'Derived from buyer, vendor profile, and pricing worker outputs rather than a dedicated GTM search lane.',
      gaps: [
        'No direct UK SMB channel-preference or partner-led route evidence in the current set.',
      ],
      contradictions: [],
    });
  }

  return findings.filter((finding) => finding.evidence.length > 0);
}

function buildOptionalRepairTasks(state: ResearchGraphStateV3) {
  if (state.optionalRepairUsed) {
    return [] as ResearchTask[];
  }

  const vendorTargets = state.selectedComparisonVendors;
  const competitorVendors = new Set(
    buildDeterministicCompetitorProfiles(state.evidenceRecords)
      .filter((profile) => profile.hasFeatureEvidence)
      .map((profile) => profile.vendor.toLowerCase()),
  );
  const pricingVendors = new Set(
    buildDeterministicCompetitorProfiles(state.evidenceRecords)
      .filter((profile) => profile.hasPricingEvidence)
      .map((profile) => profile.vendor.toLowerCase()),
  );
  const tasks: ResearchTask[] = [];

  if (competitorVendors.size < 2) {
    const missingVendor = vendorTargets.find((vendor) => !competitorVendors.has(vendor.toLowerCase()));
    if (missingVendor) {
      tasks.push({
        id: buildTaskId(state.runId, {
          type: 'vendor_profile',
          sectionKey: 'competitor-landscape',
          goal: `Repair missing vendor profile evidence for ${missingVendor}.`,
          gapType: 'vendor-profile-repair',
          priority: 1,
          queryHints: ['canonical-product', 'integrations'],
          sourcePreference: 'commercial',
          vendorTarget: missingVendor,
          attempt: 1,
        }, 0),
        type: 'vendor_profile',
        sectionKey: 'competitor-landscape',
        goal: `Repair missing vendor profile evidence for ${missingVendor}.`,
        gapType: 'vendor-profile-repair',
        priority: 1,
        queryHints: ['canonical-product', 'integrations'],
        sourcePreference: 'commercial',
        vendorTarget: missingVendor,
        attempt: 1,
      });
    }
  }

  if (pricingVendors.size < 2) {
    const missingVendor = vendorTargets.find((vendor) => !pricingVendors.has(vendor.toLowerCase()));
    if (missingVendor) {
      tasks.push({
        id: buildTaskId(state.runId, {
          type: 'vendor_pricing',
          sectionKey: 'pricing-and-packaging',
          goal: `Repair missing pricing evidence for ${missingVendor}.`,
          gapType: 'vendor-pricing-repair',
          priority: 1,
          queryHints: ['canonical-pricing'],
          sourcePreference: 'commercial',
          vendorTarget: missingVendor,
          attempt: 1,
        }, 1),
        type: 'vendor_pricing',
        sectionKey: 'pricing-and-packaging',
        goal: `Repair missing pricing evidence for ${missingVendor}.`,
        gapType: 'vendor-pricing-repair',
        priority: 1,
        queryHints: ['canonical-pricing'],
        sourcePreference: 'commercial',
        vendorTarget: missingVendor,
        attempt: 1,
      });
    }
  }

  if (!hasNonVendorEvidence('icp-and-buyer', state.evidenceRecords)) {
    if (!shouldSkipOptionalRepairForTask(state, 'buyer_research', 'icp-and-buyer')) {
      tasks.push({
        id: buildTaskId(state.runId, {
          type: 'buyer_research',
          sectionKey: 'icp-and-buyer',
          goal: 'Repair missing non-vendor buyer evidence.',
          gapType: 'buyer-evidence-repair',
          priority: 2,
          queryHints: ['buyer-roles', 'workflow-pain'],
          sourcePreference: 'primary',
          vendorTarget: null,
          attempt: 1,
        }, 2),
        type: 'buyer_research',
        sectionKey: 'icp-and-buyer',
        goal: 'Repair missing non-vendor buyer evidence.',
        gapType: 'buyer-evidence-repair',
        priority: 2,
        queryHints: ['buyer-roles', 'workflow-pain'],
        sourcePreference: 'primary',
        vendorTarget: null,
        attempt: 1,
      });
    }
  }

  if (!hasNonVendorEvidence('risks-and-unknowns', state.evidenceRecords)) {
    if (!shouldSkipOptionalRepairForTask(state, 'risk_research', 'risks-and-unknowns')) {
      tasks.push({
        id: buildTaskId(state.runId, {
          type: 'risk_research',
          sectionKey: 'risks-and-unknowns',
          goal: 'Repair missing non-vendor risk evidence.',
          gapType: 'risk-evidence-repair',
          priority: 2,
          queryHints: ['privacy-compliance', 'integration-friction'],
          sourcePreference: 'primary',
          vendorTarget: null,
          attempt: 1,
        }, 3),
        type: 'risk_research',
        sectionKey: 'risks-and-unknowns',
        goal: 'Repair missing non-vendor risk evidence.',
        gapType: 'risk-evidence-repair',
        priority: 2,
        queryHints: ['privacy-compliance', 'integration-friction'],
        sourcePreference: 'primary',
        vendorTarget: null,
        attempt: 1,
      });
    }
  }

  const gtmSectionState = state.sectionStates?.find((s) => s.sectionKey === 'gtm-motion');
  if (gtmSectionState?.coverageStatus === 'insufficient_evidence') {
    if (!shouldSkipOptionalRepairForTask(state, 'gtm_research', 'gtm-motion')) {
      tasks.push({
        id: buildTaskId(state.runId, {
          type: 'gtm_research',
          sectionKey: 'gtm-motion',
          goal: 'Repair missing GTM motion evidence: buying process, channel preference, and purchase friction for target buyer.',
          gapType: 'gtm-evidence-repair',
          priority: 1,
          queryHints: ['buying-process', 'channel-preference', 'purchase-friction'],
          sourcePreference: 'mixed',
          vendorTarget: null,
          attempt: 1,
        }, 4),
        type: 'gtm_research',
        sectionKey: 'gtm-motion',
        goal: 'Repair missing GTM motion evidence: buying process, channel preference, and purchase friction for target buyer.',
        gapType: 'gtm-evidence-repair',
        priority: 1,
        queryHints: ['buying-process', 'channel-preference', 'purchase-friction'],
        sourcePreference: 'mixed',
        vendorTarget: null,
        attempt: 1,
      });
    }
  }

  return dedupeTasks(tasks).slice(0, MAX_OPTIONAL_REPAIR_WORKERS);
}

async function hydrateRunNode(state: ResearchGraphStateV3) {
  const partial = {
    internalStage: 'hydrate_run',
    publicStage: 'plan' as const,
    currentStage: 'plan' as const,
    status: projectStatus('plan'),
    pauseState:
      state.pauseState.status === 'awaiting_user'
        ? state.pauseState
        : {
            status: 'running' as const,
            question: null,
            resumeToken: state.runId,
          },
    evidenceLedger: state.evidenceRecords.map((record) => record.id),
  };
  await checkpointState(state, partial);
  return partial;
}

async function clarifyScopeNode(state: ResearchGraphStateV3) {
  if (state.pauseState.status === 'awaiting_user' && !state.resumeClarificationResponse) {
    return new Command({
      goto: END,
    });
  }

  const userRequest = state.resumeClarificationResponse
    ? buildUserRequest(state.topic, state.objective, state.resumeClarificationResponse)
    : state.userRequest;

  const assessment = await generateStructuredOutputOrchestrator<z.infer<typeof scopeAssessmentSchema>>({
    schema: scopeAssessmentSchema,
    system:
      'You are a GTM scope analyst. Extract the product category, target buyer, company type, geography, time horizon, known vendors, and whether a clarification question is required before GTM research starts. Be precise about the market segment — distinguish consumer/residential from industrial/commercial, hardware from software, B2C from B2B.',
    prompt: [
      userRequest,
      'Only require clarification when the product category, target buyer, or comparison scope is too vague to guide GTM research.',
      'If clarification is required, ask one concise question that unblocks research.',
      'For productCategory, be specific about the end-market: e.g. "residential home battery storage systems" not just "battery storage", "consumer AI meeting assistant for SMBs" not just "AI software".',
    ].join('\n\n'),
  });

  const brief: ResearchBrief = {
    topic: state.topic,
    productCategory: assessment.productCategory,
    targetBuyer: assessment.targetBuyer,
    companyType: assessment.companyType,
    geo: assessment.geo,
    timeHorizon: assessment.timeHorizon,
    knownVendors: assessment.knownVendors,
    coreUnknowns: assessment.coreUnknowns,
    clarificationNeeded: assessment.needsClarification,
  };

  if (
    assessment.needsClarification &&
    !state.resumeClarificationResponse &&
    (!assessment.productCategory || !assessment.targetBuyer || !assessment.comparisonScope)
  ) {
    const partial = {
      userRequest,
      brief,
      internalStage: 'clarify_scope',
      pauseState: {
        status: 'awaiting_user' as const,
        question:
          assessment.clarificationQuestion ??
          'What product category, target buyer, and comparison scope should this research focus on?',
        resumeToken: state.runId,
      },
      resumeClarificationResponse: null,
    };
    await checkpointState(state, partial);
    await appendV3Event(state, 'plan', 'clarification_requested', partial.pauseState.question ?? 'Clarification requested.');
    return new Command({
      update: partial,
      goto: END,
    });
  }

  const partial = {
    userRequest,
    brief: {
      ...brief,
      clarificationNeeded: false,
    },
    internalStage: 'clarify_scope',
    pauseState: {
      status: 'running' as const,
      question: null,
      resumeToken: state.runId,
    },
    resumeClarificationResponse: null,
  };
  await checkpointState(state, partial);
  return new Command({
    update: partial,
    goto: 'build_gtm_brief',
  });
}

async function buildGtmBriefNode(state: ResearchGraphStateV3) {
  const brief = state.brief ?? {
    topic: state.topic,
    productCategory: null,
    targetBuyer: null,
    companyType: null,
    geo: null,
    timeHorizon: null,
    knownVendors: [],
    coreUnknowns: [],
    clarificationNeeded: false,
  };
  const partial = {
    brief,
    internalStage: 'build_gtm_brief',
  };
  await checkpointState(state, partial);
  return partial;
}

async function buildFixedTaskPlanNode(state: ResearchGraphStateV3, searchService: WebSearchService) {
  const vendorResolution = await resolveVendorTargetsForPlanning(searchService, state.brief);
  const workerPlan = buildFixedWorkerPlan(
    {
      ...state,
      requestedResolvedVendors: vendorResolution.requestedResolvedVendors,
      selectedComparisonVendors: vendorResolution.selectedComparisonVendors,
      rejectedResolvedVendors: vendorResolution.rejectedResolvedVendors,
      unresolvedRequestedVendors: vendorResolution.unresolvedRequestedVendors,
      discoveredVendorPages: vendorResolution.discoveredVendorPages,
    } as ResearchGraphStateV3,
    vendorResolution.selectedComparisonVendors,
  );
  const plan = buildCompatPlan(state, workerPlan);
  await saveRunPlan(state.runId, plan);
  const partial = {
    plan,
    coveragePlan: buildDefaultCoveragePlan(),
    workerPlan,
    taskQueue: workerPlan,
    requestedResolvedVendors: vendorResolution.requestedResolvedVendors,
    selectedComparisonVendors: vendorResolution.selectedComparisonVendors,
    rejectedResolvedVendors: vendorResolution.rejectedResolvedVendors,
    unresolvedRequestedVendors: vendorResolution.unresolvedRequestedVendors,
    discoveredVendorPages: vendorResolution.discoveredVendorPages,
    internalStage: 'build_fixed_task_plan',
  };
  await checkpointState(state, partial);
  await appendV3Event(state, 'plan', 'stage_started', 'Drafting research plan.');
  await appendV3Event(state, 'plan', 'stage_completed', 'Research plan saved.', {
    workerCount: workerPlan.length,
    searchQueryCount: plan.searchQueries.length,
    requestedResolvedVendors: vendorResolution.requestedResolvedVendors,
    selectedComparisonVendors: vendorResolution.selectedComparisonVendors,
    rejectedResolvedVendors: vendorResolution.rejectedResolvedVendors,
    unresolvedRequestedVendors: vendorResolution.unresolvedRequestedVendors,
  });
  return partial;
}

async function runWorkersNode(state: ResearchGraphStateV3, searchService: WebSearchService) {
  const tasks = state.taskQueue.length > 0 ? state.taskQueue : state.workerPlan;
  const partialStage = {
    internalStage: state.optionalRepairUsed ? 'optional_repair_pass' : 'run_workers',
    publicStage: 'web_search' as const,
    currentStage: 'web_search' as const,
    status: projectStatus('web_search'),
  };
  await checkpointState(state, partialStage);

  const workerResults = await Promise.all(tasks.map((task) => runOneWorker(state, task, searchService)));
  const refreshed = await hydrateLedgerState(state);
  const merged = {
    ...state,
    ...refreshed,
    taskQueue: [],
    completedTasks: [...state.completedTasks, ...workerResults.map((result) => result.taskResult)],
    queryLedger: [...state.queryLedger, ...workerResults.flatMap((result) => result.queryLedger)],
    sourceFetchLedger: [...state.sourceFetchLedger, ...workerResults.flatMap((result) => result.sourceFetchLedger)],
    rejectedSearchCandidates: [
      ...state.rejectedSearchCandidates,
      ...workerResults.flatMap((result) => result.rejectedSearchCandidates),
    ],
    workerOutputs: [...state.workerOutputs, ...workerResults.map((result) => result.workerOutput)],
    evidenceLedger: refreshed.evidenceRecords.map((record) => record.id),
    internalStage: state.optionalRepairUsed ? 'optional_repair_pass' : 'run_workers',
  } satisfies ResearchGraphStateV3;
  const sectionStates = buildSectionStates(merged);
  await checkpointState(state, {
    ...merged,
    sectionStates,
  });
  await appendV3Event(
    merged,
    'web_search',
    'workers_dispatched',
    'Supervisor workers completed.',
    {
      taskCount: tasks.length,
      tasks: tasks.map((task) => ({
        taskId: task.id,
        taskType: task.type,
        sectionKey: task.sectionKey,
      })),
    },
  );
  return {
    ...merged,
    sectionStates,
  };
}

async function synthesizeNode(state: ResearchGraphStateV3) {
  const refreshed = await hydrateLedgerState(state);
  await appendV3Event(state, 'draft_report', 'stage_started', 'Extracting draft claims from evidence.');

  // Filter out any evidence records excluded by the reflection node
  const excluded = new Set(state.reflectionExcludedEvidenceIds ?? []);
  const usableEvidence = excluded.size > 0
    ? refreshed.evidenceRecords.filter((r) => !excluded.has(r.id))
    : refreshed.evidenceRecords;

  const findings = buildWorkerDrivenFindings(
    {
      ...state,
      ...refreshed,
    } as ResearchGraphStateV3,
    usableEvidence,
  );
  await replaceResearchFindings(state.runId, findings);
  const partial = {
    findings,
    draftFindings: findings,
    internalStage: 'synthesize',
    publicStage: 'draft_report' as const,
    currentStage: 'draft_report' as const,
    status: projectStatus('draft_report'),
  };
  await checkpointState(
    {
      ...state,
      ...refreshed,
    } as ResearchGraphStateV3,
    partial,
  );
  await appendV3Event(state, 'draft_report', 'stage_completed', 'Draft claims saved.', {
    findingCount: findings.length,
  });
  return partial;
}

async function verifyNode(state: ResearchGraphStateV3) {
  const refreshed = await hydrateLedgerState(state);
  const result = await runVerificationNodeForceRefresh({
    ...state,
    ...refreshed,
  });
  const filteredFindings = filterFindingsForV3(result.findings, refreshed.evidenceRecords);
  await replaceResearchFindings(state.runId, filteredFindings);
  const sectionStates = buildSectionStates({
    ...state,
    ...refreshed,
    findings: filteredFindings,
  } as ResearchGraphStateV3);
  const optionalRepairTasks = buildOptionalRepairTasks({
    ...state,
    ...refreshed,
    findings: filteredFindings,
    sectionStates,
  } as ResearchGraphStateV3);
  const partial = {
    findings: filteredFindings,
    verifiedFindings: filteredFindings.filter(
      (finding): finding is ResearchGraphStateV3['verifiedFindings'][number] =>
        finding.status === 'verified' || finding.status === 'needs-review',
    ),
    contradictions: dedupeStrings(filteredFindings.flatMap((finding) => finding.contradictions)),
    sectionStates,
    taskQueue: optionalRepairTasks,
    internalStage: 'verify',
    publicStage: 'verification' as const,
    currentStage: 'verification' as const,
    status: projectStatus('verification'),
  };
  await checkpointState(
    {
      ...state,
      ...refreshed,
    } as ResearchGraphStateV3,
    partial,
  );
  return partial;
}

async function reflectOnEvidenceNode(state: ResearchGraphStateV3) {
  // Second pass: reflection already ran, re-fetch workers just completed — go straight to synthesize
  if (state.reflectionUsed) {
    const partial = { internalStage: 'reflect_on_evidence' };
    await checkpointState(state, partial);
    return new Command({ update: partial, goto: 'synthesize' });
  }

  const refreshed = await hydrateLedgerState(state);
  const evidenceRecords = refreshed.evidenceRecords;

  if (evidenceRecords.length === 0) {
    const partial = { reflectionUsed: true, internalStage: 'reflect_on_evidence' };
    await checkpointState(state, partial);
    return new Command({ update: partial, goto: 'synthesize' });
  }

  const brief = state.brief;
  const targetSegment = [
    brief?.productCategory ?? state.topic,
    brief?.targetBuyer,
    brief?.companyType,
    brief?.geo,
  ].filter(Boolean).join(', ');

  // Compact evidence summary — use only fields available on ResearchEvidence
  const evidenceSummaryLines = evidenceRecords.map((r) =>
    `ID: ${r.id} | Title: ${r.title} | URL: ${r.url ?? 'unknown'} | Excerpt: ${r.excerpt.slice(0, 180)}`,
  );

  const reflection = await generateStructuredOutputOrchestrator<z.infer<typeof evidenceReflectionSchema>>({
    schema: evidenceReflectionSchema,
    system: [
      'You are a research quality auditor. Your job is to identify evidence records that are from the wrong market segment for the research brief, and generate targeted replacement queries.',
      'Be conservative: only flag evidence that is unambiguously from a different market segment (e.g. industrial/automotive battery supply chain policy when the brief asks for residential home battery systems; enterprise fleet software when the brief is consumer products).',
      'Do NOT flag evidence just because it is weak, partial, or tangential — only flag it when the market segment is clearly wrong.',
      'If all evidence is broadly relevant to the correct segment, return empty segmentMismatchIds and empty replacementQueries.',
    ].join('\n'),
    prompt: [
      `Research brief — target market segment: ${targetSegment}`,
      `Research topic: ${state.topic}`,
      '',
      'Evidence records fetched so far:',
      ...evidenceSummaryLines,
      '',
      'Step 1: Identify any records clearly from the wrong market segment. List their IDs in segmentMismatchIds.',
      'Step 2: For each gap left by mismatch records, write one targeted replacement search query (max 4 total) that will find evidence from the correct market segment.',
      'Step 3: Write a one-sentence reflectionSummary describing what was wrong and what the replacement queries target.',
    ].join('\n'),
  });

  const mismatchCount = reflection.segmentMismatchIds.length;
  console.info(`[research:${state.runId}] reflect_on_evidence`, {
    totalEvidence: evidenceRecords.length,
    mismatchCount,
    summary: reflection.reflectionSummary,
  });

  await appendResearchEvent(
    state.runId,
    'web_search',
    mismatchCount > 0 ? 'reflection_mismatch_found' : 'reflection_passed',
    reflection.reflectionSummary,
    { mismatchCount, replacementQueryCount: reflection.replacementQueries.length },
  );

  // No mismatch — proceed directly to synthesize
  if (mismatchCount === 0 || reflection.replacementQueries.length === 0) {
    const partial = { reflectionUsed: true, internalStage: 'reflect_on_evidence' };
    await checkpointState(state, partial);
    return new Command({ update: partial, goto: 'synthesize' });
  }

  // Build well-typed replacement tasks so run_workers can execute them
  const replacementTasks: ResearchTask[] = reflection.replacementQueries.map((rq, idx) => {
    const taskType = (
      rq.intent === 'market-size' || rq.intent === 'adoption' ? 'market_research'
      : rq.intent === 'gtm-channels' ? 'gtm_research'
      : rq.intent === 'buyer-pain' ? 'buyer_research'
      : 'buyer_research'
    ) as ResearchTask['type'];
    const sectionKey = (rq.sectionKey ?? 'icp-and-buyer') as ResearchTask['sectionKey'];
    return {
      id: `reflection-replacement-${state.runId}-${idx}`,
      type: taskType,
      sectionKey,
      goal: rq.rationale,
      gapType: 'reflection-segment-mismatch',
      priority: 1,
      queryHints: [rq.query.slice(0, 60)],
      sourcePreference: 'mixed' as const,
      vendorTarget: null,
      attempt: 0,
    };
  });

  const partial = {
    reflectionUsed: true,
    reflectionExcludedEvidenceIds: [
      ...(state.reflectionExcludedEvidenceIds ?? []),
      ...reflection.segmentMismatchIds,
    ],
    taskQueue: replacementTasks,
    internalStage: 'reflect_on_evidence',
    publicStage: 'web_search' as const,
    currentStage: 'web_search' as const,
    status: projectStatus('web_search'),
  };
  await checkpointState(state, partial);

  // Route to run_workers for the replacement fetch; after that run_workers → reflect_on_evidence
  // → reflectionUsed=true → routes to synthesize
  return new Command({ update: partial, goto: 'run_workers' });
}

async function decideOptionalRepairNode(state: ResearchGraphStateV3) {
  const partial = {
    internalStage: 'decide_optional_repair',
  };
  await checkpointState(state, partial);
  return new Command({
    update: partial,
    goto: 'finalize',
  });
}

async function optionalRepairNode(state: ResearchGraphStateV3, searchService: WebSearchService) {
  const repairedState = {
    ...state,
    optionalRepairUsed: true,
  } satisfies ResearchGraphStateV3;
  await checkpointState(state, {
    optionalRepairUsed: true,
    loopControl: {
      ...state.loopControl,
      supervisorIteration: 1,
    },
  });
  return runWorkersNode(repairedState, searchService);
}

async function finalizeNode(state: ResearchGraphStateV3) {
  const refreshed = await hydrateLedgerState(state);
  const result = await runFinalizeNode({
    ...state,
    ...refreshed,
  });
  const partial = {
    ...result,
    internalStage: 'finalize_run',
    publicStage: 'finalize' as const,
    currentStage: 'finalize' as const,
    status: 'completed' as const,
  };
  await checkpointState(
    {
      ...state,
      ...refreshed,
    } as ResearchGraphStateV3,
    partial,
    { completed: true },
  );
  return partial;
}

export function createResearchGraphV3(searchService: WebSearchService) {
  return new StateGraph(researchGraphStateV3Schema)
    .addNode('hydrate_run', hydrateRunNode)
    .addNode('clarify_scope', clarifyScopeNode, {
      ends: ['build_gtm_brief', END],
    })
    .addNode('build_gtm_brief', buildGtmBriefNode)
    .addNode('build_fixed_task_plan', (state) => buildFixedTaskPlanNode(state, searchService))
    .addNode('run_workers', (state) => runWorkersNode(state, searchService))
    .addNode('reflect_on_evidence', (state: ResearchGraphStateV3) => reflectOnEvidenceNode(state), {
      ends: ['synthesize', 'run_workers'],
    })
    .addNode('synthesize', synthesizeNode)
    .addNode('verify', verifyNode)
    .addNode('decide_optional_repair', decideOptionalRepairNode, {
      ends: ['optional_repair', 'finalize'],
    })
    .addNode('optional_repair', (state) => optionalRepairNode(state, searchService))
    .addNode('finalize', finalizeNode)
    .addEdge(START, 'hydrate_run')
    .addEdge('hydrate_run', 'clarify_scope')
    .addEdge('build_gtm_brief', 'build_fixed_task_plan')
    .addEdge('build_fixed_task_plan', 'run_workers')
    .addEdge('run_workers', 'reflect_on_evidence')
    .addEdge('synthesize', 'verify')
    .addEdge('verify', 'decide_optional_repair')
    .addEdge('optional_repair', 'synthesize')
    .addEdge('finalize', END)
    .compile();
}

export async function buildInitialGraphStateV3(
  runId: string,
  options?: { clarificationResponse?: string | null },
) {
  const run = await getResearchRun(runId);
  const base = await buildInitialGraphState(runId, {
    topic: run.topic,
    objective: run.objective,
    status: run.status === 'queued' ? 'planning' : run.status,
    currentStage: normalizeStage(run.currentStage),
    planJson: run.planJson,
    finalReportMarkdown: run.finalReportMarkdown,
  });
  const persisted = (run.workflowStateJson ?? {}) as Partial<ResearchGraphStateV3> & {
    supportedVendors?: string[];
    unsupportedVendors?: string[];
  };

  return researchGraphStateV3Schema.parse({
    ...base,
    ...persisted,
    objective:
      typeof persisted.objective === 'string'
        ? persisted.objective
        : run.objective ?? null,
    userRequest:
      typeof persisted.userRequest === 'string'
        ? persisted.userRequest
        : buildUserRequest(run.topic, run.objective, options?.clarificationResponse ?? null),
    publicStage: normalizeStage(run.currentStage),
    internalStage:
      run.internalStage ??
      (typeof persisted.internalStage === 'string' ? persisted.internalStage : 'hydrate_run'),
    engineVersion: run.engineVersion ?? DEFAULT_ENGINE_VERSION,
    brief: persisted.brief ?? run.planJson?.brief ?? null,
    legacyPlan: persisted.legacyPlan ?? base.plan,
    coveragePlan: persisted.coveragePlan ?? run.planJson?.coveragePlan ?? buildDefaultCoveragePlan(),
    sectionStates: persisted.sectionStates ?? [],
    taskQueue: persisted.taskQueue ?? [],
    activeTasks: [],
    completedTasks: persisted.completedTasks ?? [],
    queryLedger: persisted.queryLedger ?? [],
    sourceFetchLedger: persisted.sourceFetchLedger ?? [],
    evidenceLedger: base.evidenceRecords.map((record) => record.id),
    draftFindings: persisted.draftFindings ?? base.findings.filter((finding) => finding.status === 'draft'),
    verifiedFindings:
      persisted.verifiedFindings ??
      base.findings.filter((finding) => finding.status === 'verified' || finding.status === 'needs-review'),
    contradictions:
      persisted.contradictions ?? dedupeStrings(base.findings.flatMap((finding) => finding.contradictions)),
    postVerificationRepairPasses: persisted.postVerificationRepairPasses ?? 0,
    loopControl: {
      supervisorIteration: run.loopIteration,
      maxSupervisorIterations: 1,
      maxConcurrentWorkers: MAX_WORKERS,
      maxTaskAttemptsPerSection: 1,
      maxStallIterations: 1,
    },
    pauseState:
      persisted.pauseState ??
      {
        status: run.awaitingClarification ? 'awaiting_user' : 'running',
        question: run.clarificationQuestion,
        resumeToken: runId,
      },
    resumeClarificationResponse: options?.clarificationResponse ?? null,
    status: run.status === 'queued' ? 'planning' : run.status,
    currentStage: normalizeStage(run.currentStage),
    plan: run.planJson,
    workerPlan: persisted.workerPlan ?? [],
    workerOutputs: persisted.workerOutputs ?? [],
    optionalRepairUsed: persisted.optionalRepairUsed ?? false,
    rejectedSearchCandidates: persisted.rejectedSearchCandidates ?? [],
    requestedResolvedVendors:
      persisted.requestedResolvedVendors ??
      persisted.supportedVendors ??
      [],
    selectedComparisonVendors:
      persisted.selectedComparisonVendors ??
      persisted.supportedVendors ??
      [],
    rejectedResolvedVendors:
      persisted.rejectedResolvedVendors ??
      [],
    unresolvedRequestedVendors:
      persisted.unresolvedRequestedVendors ??
      persisted.unsupportedVendors ??
      [],
    discoveredVendorPages: persisted.discoveredVendorPages ?? {},
  });
}

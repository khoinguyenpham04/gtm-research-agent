import OpenAI from 'openai';
import { Command, END, START, StateGraph } from '@langchain/langgraph';
import { z } from 'zod';
import { generateStructuredOutput } from '@/lib/research/ai';
import { getDefaultClaimType } from '@/lib/research/claim-specificity';
import {
  buildDeterministicCompetitorProfiles,
  countDistinctCompetitorVendors,
} from '@/lib/research/competitor-extraction';
import { buildInitialGraphState } from '@/lib/research/graph';
import { runDraftReportNodeForceRefresh } from '@/lib/research/nodes/draft-report';
import { runFinalizeNode } from '@/lib/research/nodes/finalize';
import { runPlanNode } from '@/lib/research/nodes/plan';
import { runVerificationNodeForceRefresh } from '@/lib/research/nodes/verification';
import {
  appendResearchEvent,
  getResearchRun,
  listResearchEvidence,
  listResearchSources,
  saveResearchEvidence,
  saveResearchRetrievalCandidates,
  saveResearchSources,
  saveRunPlan,
  updateRunExecutionState,
} from '@/lib/research/repository';
import { buildLexicalQuery, buildSectionQuery, reciprocalRankFuse } from '@/lib/research/retrieval';
import {
  claimTypeSchema,
  evidenceModeSchema,
  researchBriefSchema,
  researchGraphStateV2Schema,
  researchTaskSchema,
  sourceCategoryValues,
  type CoveragePlan,
  type PlannedSearchQuery,
  type ResearchBrief,
  type ResearchGraphState,
  type ResearchGraphStateV2,
  type ResearchPlan,
  type ResearchRunStatus,
  type ResearchStage,
  type ResearchTask,
  type ResearchTaskResult,
  type ScoredSource,
  type SearchIntent,
  type SectionState,
  type SourceFetchLedgerEntry,
  vendorPageTypeSchema,
} from '@/lib/research/schemas';
import { getGtmEvidenceSignals, selectEvidenceForSection, filterCandidatesForSection, assessSectionStatus } from '@/lib/research/section-policy';
import { coerceClaimType, coerceEvidenceMode, scoreWebSource } from '@/lib/research/source-scoring';
import { sanitizeOutboundQuery, type WebSearchService } from '@/lib/research/search';
import { hasTopicSignal } from '@/lib/research/topic-utils';
import { resolveCanonicalVendorPages } from '@/lib/research/vendor-registry';
import { createSupabaseServerClient } from '@/lib/supabase';

const openai = new OpenAI();

const nonDerivedSectionKeys = [
  'market-landscape',
  'icp-and-buyer',
  'competitor-landscape',
  'pricing-and-packaging',
  'gtm-motion',
  'risks-and-unknowns',
] as const;
type NonDerivedSectionKey = (typeof nonDerivedSectionKeys)[number];

const MAX_POST_VERIFICATION_REPAIR_PASSES = 1;
const MAX_POST_VERIFICATION_REPAIR_SECTIONS = 2;

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

type ProposedTask = Pick<
  ResearchTask,
  'type' | 'sectionKey' | 'goal' | 'gapType' | 'priority' | 'queryHints' | 'sourcePreference' | 'vendorTarget'
>;

const fetchedPageSchema = z.object({
  url: z.string().trim().url(),
  title: z.string().trim().min(1),
  text: z.string().trim().min(1),
  domain: z.string().trim().nullable(),
  publishedYear: z.number().int().nullable(),
  sourceCategory: z.enum(sourceCategoryValues),
  qualityScore: z.number().min(0).max(1),
  snippet: z.string().trim().min(1),
  vendorPageType: vendorPageTypeSchema.nullable(),
  vendorTarget: z.string().trim().nullable(),
  claimType: claimTypeSchema,
  evidenceMode: evidenceModeSchema,
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

const workerStateSchema = z.object({
  runId: z.string().uuid(),
  topic: z.string(),
  objective: z.string().nullable().default(null),
  brief: researchBriefSchema.nullable().default(null),
  plan: z.any().nullable().default(null),
  selectedDocumentIds: z.array(z.string()).default([]),
  linkedDocuments: z.array(z.object({
    id: z.string(),
    documentExternalId: z.string(),
    fileName: z.string().nullable(),
  })).default([]),
  task: researchTaskSchema,
  plannedQueries: z.array(z.any()).default([]),
  searchResults: z.array(z.any()).default([]),
  fetchedPages: z.array(fetchedPageSchema).default([]),
  summarizedPages: z.array(z.object({
    page: fetchedPageSchema,
    summary: pageSummarySchema,
    selected: z.boolean().default(false),
  })).default([]),
  denseMatches: z.array(z.any()).default([]),
  lexicalMatches: z.array(z.any()).default([]),
  selectedDocumentMatches: z.array(z.any()).default([]),
  queryLedger: z.array(z.any()).default([]),
  sourceFetchLedger: z.array(z.any()).default([]),
  taskResult: z.any().nullable().default(null),
});

type WorkerState = z.infer<typeof workerStateSchema>;
type FetchedPage = z.infer<typeof fetchedPageSchema>;

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

function projectPublicStage(internalStage: string, taskQueue: ResearchTask[] = []): ResearchStage {
  if (
    internalStage === 'hydrate_run' ||
    internalStage === 'clarify_scope' ||
    internalStage === 'build_research_brief' ||
    internalStage === 'build_compat_plan'
  ) {
    return 'plan';
  }

  if (internalStage === 'dispatch_workers') {
    if (taskQueue.some((task) => task.type === 'document_gap')) {
      return 'document_retrieval';
    }
    return 'web_search';
  }

  if (internalStage === 'draft_findings' || internalStage === 'compose_sections' || internalStage === 'build_recommendation') {
    return 'draft_report';
  }

  if (
    internalStage === 'assess_section_coverage' ||
    internalStage === 'generate_repair_tasks' ||
    internalStage === 'merge_worker_results' ||
    internalStage === 'decide_next_step' ||
    internalStage === 'verify_findings' ||
    internalStage === 'emit_repair_tasks'
  ) {
    return 'verification';
  }

  if (internalStage === 'finalize_run' || internalStage === 'persist_report_sections' || internalStage === 'project_public_stage') {
    return 'finalize';
  }

  return 'web_search';
}

function projectStatus(publicStage: ResearchStage, completed = false): ResearchRunStatus {
  if (completed) {
    return 'completed';
  }

  switch (publicStage) {
    case 'plan':
      return 'planning';
    case 'web_search':
      return 'searching';
    case 'document_retrieval':
      return 'retrieving';
    case 'draft_report':
      return 'drafting';
    case 'verification':
      return 'verifying';
    case 'finalize':
      return 'completed';
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
      repairPriority: 2,
    },
    'pricing-and-packaging': {
      requiredEvidenceBuckets: ['canonical-pricing-1', 'canonical-pricing-2'],
      minStrongEvidence: 0,
      preferredSourceTypes: ['commercial'],
      repairPriority: 2,
    },
    'gtm-motion': {
      requiredEvidenceBuckets: ['buying-process', 'channel-preference', 'partner-direct', 'purchase-friction'],
      minStrongEvidence: 1,
      preferredSourceTypes: ['primary', 'mixed'],
      repairPriority: 1,
    },
    'risks-and-unknowns': {
      requiredEvidenceBuckets: ['risk-or-barrier'],
      minStrongEvidence: 1,
      preferredSourceTypes: ['primary', 'mixed'],
      repairPriority: 1,
    },
    recommendation: {
      requiredEvidenceBuckets: ['derived-only'],
      minStrongEvidence: 0,
      preferredSourceTypes: ['mixed'],
      repairPriority: 5,
    },
  };
}

function buildQueryStrategy(plan: ResearchPlan | null): NonNullable<ResearchPlan['queryStrategy']> {
  const sourcePreferenceBySection = Object.fromEntries(
    (plan?.searchQueries ?? []).map((query) => [query.sectionKey, query.sourcePreference]),
  ) as NonNullable<ResearchPlan['queryStrategy']>['sourcePreferenceBySection'];

  return {
    seedQueries: plan?.searchQueries ?? [],
    sourcePreferenceBySection,
    notes: [
      'Prefer canonical vendor product, docs, and pricing pages for commercial claims.',
      'Fetch full page content for shortlisted web sources before persisting selected evidence.',
    ],
  };
}

function dedupeStrings(values: string[]) {
  return values.filter((value, index) => Boolean(value) && values.indexOf(value) === index);
}

function dedupeSectionHints(values: Array<NonDerivedSectionKey | null | undefined>) {
  return values.filter((value, index, allValues): value is NonDerivedSectionKey =>
    Boolean(value) && allValues.indexOf(value) === index);
}

function resolveBucketSectionHints(bucket: string): NonDerivedSectionKey[] {
  const normalized = bucket.trim().toLowerCase();

  if (
    normalized.includes('buying-process') ||
    normalized.includes('channel') ||
    normalized.includes('partner') ||
    normalized.includes('marketplace') ||
    normalized.includes('direct') ||
    normalized.includes('purchase-friction')
  ) {
    return ['gtm-motion'];
  }

  if (
    normalized.includes('risk') ||
    normalized.includes('barrier') ||
    normalized.includes('privacy') ||
    normalized.includes('security') ||
    normalized.includes('compliance')
  ) {
    return ['risks-and-unknowns'];
  }

  if (normalized.includes('pricing')) {
    return ['pricing-and-packaging'];
  }

  if (normalized.includes('competitor') || normalized.includes('feature')) {
    return ['competitor-landscape'];
  }

  if (normalized.includes('market')) {
    return ['market-landscape'];
  }

  if (normalized.includes('buyer') || normalized.includes('workflow') || normalized.includes('pain')) {
    return ['icp-and-buyer'];
  }

  return [];
}

function inferSectionHintsFromTaskContext(
  task: ResearchTask,
  query: PlannedSearchQuery | undefined,
  options?: {
    evidenceBuckets?: string[];
    claimType?: string | null;
    evidenceMode?: string | null;
    vendorPageType?: string | null;
  },
) {
  const derivedFromContent = dedupeSectionHints([
    ...(options?.evidenceBuckets ?? []).flatMap((bucket) => resolveBucketSectionHints(bucket)),
    options?.vendorPageType === 'pricing' ? 'pricing-and-packaging' : null,
    options?.evidenceMode === 'vendor-primary' && options?.vendorPageType !== 'pricing'
      ? 'competitor-landscape'
      : null,
    options?.claimType === 'pricing'
      ? 'pricing-and-packaging'
      : options?.claimType === 'competitor-feature'
        ? 'competitor-landscape'
        : options?.claimType === 'gtm-channel'
          ? 'gtm-motion'
          : options?.claimType === 'risk'
            ? 'risks-and-unknowns'
            : options?.claimType === 'market-sizing'
              ? 'market-landscape'
              : options?.claimType === 'buyer-pain' || options?.claimType === 'adoption-signal'
                ? 'icp-and-buyer'
                : null,
  ]);

  const derivedFromQuery = dedupeSectionHints([
    query?.intent === 'market-size'
      ? 'market-landscape'
      : query?.intent === 'pricing'
        ? 'pricing-and-packaging'
        : query?.intent === 'competitor-features'
          ? 'competitor-landscape'
          : query?.intent === 'gtm-channels'
            ? 'gtm-motion'
            : null,
    query?.subtopic?.includes('risk') || query?.subtopic?.includes('security') || query?.subtopic?.includes('compliance')
      ? 'risks-and-unknowns'
      : query?.subtopic?.includes('buying') ||
          query?.subtopic?.includes('channel') ||
          query?.subtopic?.includes('partner') ||
          query?.subtopic?.includes('friction')
        ? 'gtm-motion'
        : null,
    query?.intent === 'adoption' || query?.intent === 'buyer-pain'
      ? 'icp-and-buyer'
      : null,
  ]);

  return dedupeSectionHints([
    ...derivedFromContent,
    ...derivedFromQuery,
    nonDerivedSectionKeys.includes(task.sectionKey as NonDerivedSectionKey)
      ? (task.sectionKey as NonDerivedSectionKey)
      : null,
  ]);
}

function getAttemptCount(state: ResearchGraphStateV2, sectionKey: ResearchTask['sectionKey'], gapType: string) {
  return state.plan?.repairHistory.filter(
    (entry) => entry.sectionKey === sectionKey && entry.note === gapType,
  ).length ?? 0;
}

function getTopicOrCategory(state: ResearchGraphStateV2) {
  return state.brief?.productCategory ?? state.topic;
}

function getCoverageStatusRank(status: SectionState['coverageStatus']) {
  switch (status) {
    case 'satisfied':
      return 4;
    case 'needs_repair':
      return 3;
    case 'in_progress':
      return 2;
    case 'unstarted':
      return 1;
    case 'insufficient_evidence':
    default:
      return 0;
  }
}

function getRepairHintsForSection(sectionState: SectionState) {
  const hints: string[] = [];

  switch (sectionState.sectionKey) {
    case 'market-landscape':
      hints.push('market-evidence', 'product-category');
      break;
    case 'icp-and-buyer':
      hints.push('buyer-workflow', 'buyer-pain');
      break;
    case 'competitor-landscape':
      hints.push('canonical-vendor-gap');
      break;
    case 'pricing-and-packaging':
      hints.push('canonical-pricing-gap');
      break;
    case 'gtm-motion':
      if (sectionState.gaps.some((gap) => gap.includes('buying-process'))) {
        hints.push('buying-process');
      }
      if (sectionState.gaps.some((gap) => gap.includes('channel-preference'))) {
        hints.push('channel-preference');
      }
      if (sectionState.gaps.some((gap) => gap.includes('partner') || gap.includes('direct-preference'))) {
        hints.push('partner-direct');
      }
      if (sectionState.gaps.some((gap) => gap.includes('purchase-friction'))) {
        hints.push('purchase-friction');
      }
      if (hints.length === 0) {
        hints.push('buying-process', 'purchase-friction');
      }
      break;
    case 'risks-and-unknowns':
      hints.push('risk-barrier', 'security-compliance');
      break;
    case 'recommendation':
      break;
  }

  return dedupeStrings(hints);
}

function getCandidateVendors(state: ResearchGraphStateV2, sectionKey: SectionState['sectionKey']) {
  const fromBrief = state.brief?.knownVendors ?? [];
  const fromPlan = (state.plan?.searchQueries ?? [])
    .filter((query) => query.sectionKey === sectionKey)
    .map((query) => query.vendorTarget ?? '')
    .filter(Boolean);

  return dedupeStrings([...fromBrief, ...fromPlan]);
}

function getMissingVendorTarget(state: ResearchGraphStateV2, sectionKey: NonDerivedSectionKey) {
  const existingVendors = new Set(
    selectEvidenceForSection(sectionKey, state.evidenceRecords)
      .map((record) => (typeof record.metadataJson.vendorTarget === 'string' ? record.metadataJson.vendorTarget : ''))
      .filter(Boolean),
  );

  return getCandidateVendors(state, sectionKey).find((vendor) => !existingVendors.has(vendor)) ?? null;
}

function buildRepairGoal(sectionKey: SectionState['sectionKey'], hints: string[]) {
  switch (sectionKey) {
    case 'market-landscape':
      return 'Add category-specific market evidence grounded in current reports or statistics.';
    case 'icp-and-buyer':
      return 'Add direct buyer-workflow and buyer-pain evidence for the likely GTM ICP.';
    case 'competitor-landscape':
      return 'Add canonical competitor product evidence spanning at least two vendors.';
    case 'pricing-and-packaging':
      return 'Add canonical pricing evidence spanning at least two vendors.';
    case 'gtm-motion':
      return `Add GTM motion evidence for ${hints.join(', ') || 'buying process and purchase friction'}.`;
    case 'risks-and-unknowns':
      return 'Add direct deployment, privacy, compliance, or integration risk evidence.';
    case 'recommendation':
    default:
      return 'Repair evidence coverage.';
  }
}

function isEligibleSearchResultForTask(
  task: ResearchTask,
  source: Pick<ScoredSource, 'sourceCategory'>,
) {
  if (task.sourcePreference === 'commercial') {
    return source.sourceCategory === 'vendor' || source.sourceCategory === 'official' || source.sourceCategory === 'research';
  }

  if (task.sourcePreference === 'mixed') {
    return source.sourceCategory !== 'community';
  }

  return source.sourceCategory === 'official' || source.sourceCategory === 'research' || source.sourceCategory === 'media';
}

function buildDeterministicRepairTasks(
  state: ResearchGraphStateV2,
  sectionStates: SectionState[] = state.sectionStates,
) {
  const tasks: ProposedTask[] = [];

  for (const sectionState of sectionStates) {
    if (sectionState.sectionKey === 'recommendation' || sectionState.coverageStatus === 'satisfied') {
      continue;
    }

    const queryHints = getRepairHintsForSection(sectionState).slice(0, 3);
    const gapType = queryHints[0] ?? `${sectionState.sectionKey}-gap`;
    const attempts = getAttemptCount(state, sectionState.sectionKey, gapType);
    if (attempts >= state.loopControl.maxTaskAttemptsPerSection) {
      continue;
    }

    const isCommercialSection =
      sectionState.sectionKey === 'competitor-landscape' || sectionState.sectionKey === 'pricing-and-packaging';
    const missingVendor = isCommercialSection
      ? getMissingVendorTarget(state, sectionState.sectionKey)
      : null;

    tasks.push({
      type:
        isCommercialSection
          ? 'vendor_gap'
          : sectionState.contradictions.length > 0
            ? 'contradiction_check'
            : state.linkedDocuments.length > 0 && sectionState.selectedEvidenceIds.length === 0
              ? 'document_gap'
              : 'web_gap',
      sectionKey: sectionState.sectionKey,
      goal: buildRepairGoal(sectionState.sectionKey, queryHints),
      gapType,
      priority: state.coveragePlan?.[sectionState.sectionKey].repairPriority ?? 2,
      queryHints,
      sourcePreference: isCommercialSection ? 'commercial' : 'primary',
      vendorTarget: missingVendor,
    });
  }

  return tasks
    .sort((left, right) => left.priority - right.priority)
    .slice(0, state.loopControl.maxConcurrentWorkers);
}

function buildVerificationRepairTasks(
  state: ResearchGraphStateV2,
  sectionStates: SectionState[],
) {
  const contradictionSections = sectionStates.filter(
    (entry) =>
      entry.coverageStatus !== 'satisfied' &&
      entry.contradictions.length > 0 &&
      (entry.sectionKey === 'competitor-landscape' ||
        entry.sectionKey === 'pricing-and-packaging' ||
        entry.sectionKey === 'risks-and-unknowns'),
  );
  const canonicalCommercialSections = sectionStates.filter(
    (entry) =>
      entry.contradictions.length === 0 &&
      (entry.sectionKey === 'competitor-landscape' || entry.sectionKey === 'pricing-and-packaging') &&
      entry.coverageStatus !== 'satisfied',
  );

  const prioritizedSections = dedupeStrings(
    [...canonicalCommercialSections, ...contradictionSections].map((entry) => entry.sectionKey),
  )
    .map((sectionKey) => sectionStates.find((entry) => entry.sectionKey === sectionKey))
    .filter((entry): entry is SectionState => Boolean(entry))
    .sort(
      (left, right) =>
        (state.coveragePlan?.[left.sectionKey].repairPriority ?? 3) -
          (state.coveragePlan?.[right.sectionKey].repairPriority ?? 3) ||
        right.contradictions.length - left.contradictions.length,
    )
    .slice(0, MAX_POST_VERIFICATION_REPAIR_SECTIONS);

  const seenSections = new Set<string>();
  return buildDeterministicRepairTasks(state, prioritizedSections).filter((task) => {
    if (seenSections.has(task.sectionKey)) {
      return false;
    }
    seenSections.add(task.sectionKey);
    return true;
  }).slice(0, MAX_POST_VERIFICATION_REPAIR_SECTIONS);
}

async function hydrateLedgerState(
  state: Pick<ResearchGraphStateV2, 'runId' | 'topic' | 'objective' | 'status' | 'currentStage' | 'plan' | 'finalReportMarkdown'>,
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

function buildSectionStates(state: ResearchGraphStateV2): SectionState[] {
  const pricingProfiles = buildDeterministicCompetitorProfiles(state.evidenceRecords)
    .filter((profile) => profile.hasPricingEvidence);
  const pricingVendorCount = new Set(pricingProfiles.map((profile) => profile.vendor)).size;

  return [
    ...nonDerivedSectionKeys.map((sectionKey) => {
      const selectedEvidence = selectEvidenceForSection(sectionKey, state.evidenceRecords);
      const selectedCandidates = filterCandidatesForSection(sectionKey, state.retrievalCandidates)
        .filter((candidate) => candidate.selected);
      const assessment = assessSectionStatus(sectionKey, state.evidenceRecords, state.findings);
      const findingGaps = state.findings
        .filter((finding) => finding.sectionKey === sectionKey)
        .flatMap((finding) => finding.gaps);
      const contradictions = state.findings
        .filter((finding) => finding.sectionKey === sectionKey)
        .flatMap((finding) => finding.contradictions);
      const gaps = [...assessment.notes, ...findingGaps];
      let coverageStatus: SectionState['coverageStatus'] =
        assessment.status === 'ready'
          ? 'satisfied'
          : selectedEvidence.length === 0 && selectedCandidates.length === 0
            ? 'unstarted'
            : 'needs_repair';

      if (sectionKey === 'competitor-landscape') {
        const vendorCount = countDistinctCompetitorVendors(selectedEvidence);
        if (vendorCount < 2) {
          coverageStatus = selectedEvidence.length === 0 ? 'unstarted' : 'needs_repair';
          gaps.push('Competitor section needs canonical evidence from at least two distinct vendors.');
        }
      }

      if (sectionKey === 'pricing-and-packaging' && pricingVendorCount < 2) {
        coverageStatus = selectedEvidence.length === 0 ? 'unstarted' : 'needs_repair';
        gaps.push('Pricing section needs canonical pricing evidence from at least two distinct vendors.');
      }

      if (sectionKey === 'gtm-motion') {
        const signals = getGtmEvidenceSignals(selectedEvidence);
        if (signals.buyingProcessCount < 1) {
          gaps.push('Missing buying-process evidence.');
        }
        if (signals.channelCount < 1) {
          gaps.push('Missing channel-preference evidence.');
        }
        if (signals.partnerPreferenceCount < 1) {
          gaps.push('Missing partner or direct-preference evidence.');
        }
        if (signals.purchaseFrictionCount < 1) {
          gaps.push('Missing purchase-friction evidence.');
        }
        if (gaps.length > 0 && coverageStatus === 'satisfied') {
          coverageStatus = 'needs_repair';
        }
      }

      if (gaps.length > 0 && coverageStatus === 'satisfied') {
        coverageStatus = 'needs_repair';
      }

      const previous = state.sectionStates.find((entry) => entry.sectionKey === sectionKey);

      return {
        sectionKey,
        coverageStatus,
        selectedEvidenceIds: dedupeStrings(selectedEvidence.map((record) => record.id)),
        selectedCandidateIds: dedupeStrings(selectedCandidates.map((candidate) => candidate.id)),
        gaps: dedupeStrings(gaps),
        contradictions: dedupeStrings(contradictions),
        lastImprovedIteration:
          selectedEvidence.length > (previous?.selectedEvidenceIds.length ?? 0)
            ? state.loopControl.supervisorIteration
            : previous?.lastImprovedIteration ?? null,
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

function fingerprintQuery(query: string) {
  return sanitizeOutboundQuery(query).toLowerCase();
}

function shouldStopForStall(state: ResearchGraphStateV2) {
  const history = state.plan?.repairHistory ?? [];
  const recent = history.slice(-state.loopControl.maxStallIterations);
  if (recent.length < state.loopControl.maxStallIterations) {
    return false;
  }

  return recent.every((entry) => entry.selectedEvidenceDelta < 2 && !entry.improved);
}

function buildWebSearchQuery(
  token: string,
  task: ResearchTask,
  state: WorkerState,
) {
  const productCategory = state.brief?.productCategory ?? state.topic;
  const geo = state.brief?.geo ?? '';
  const targetBuyer = state.brief?.targetBuyer ?? '';
  const companyType = state.brief?.companyType ?? '';
  const objective = state.objective ?? '';
  const baseContext = dedupeStrings([geo, companyType, targetBuyer, productCategory, objective]).join(' ').trim();
  const attemptConstraint =
    task.attempt > 0
      ? task.sourcePreference === 'primary'
        ? geo.toLowerCase().includes('united kingdom') || geo.toLowerCase().includes('uk')
          ? 'site:gov.uk report survey pdf'
          : 'report survey pdf'
        : task.sourcePreference === 'commercial'
          ? 'official pricing docs'
          : 'case study benchmark'
      : '';

  switch (token) {
    case 'market-evidence':
      return `${baseContext} market size report survey statistics pdf ${attemptConstraint}`.trim();
    case 'product-category':
      return `${baseContext} adoption demand report buyers survey ${attemptConstraint}`.trim();
    case 'buyer-workflow':
      return `${baseContext} workflow pain note taking follow-up CRM admin burden survey ${attemptConstraint}`.trim();
    case 'buyer-pain':
      return `${baseContext} buyer pain meeting notes call summaries CRM update friction ${attemptConstraint}`.trim();
    case 'buying-process':
      return `${baseContext} software buying process procurement approval ${attemptConstraint}`.trim();
    case 'channel-preference':
      return `${baseContext} software purchase marketplace direct vendor survey ${attemptConstraint}`.trim();
    case 'partner-direct':
      return `${baseContext} reseller partner marketplace direct purchase preference ${attemptConstraint}`.trim();
    case 'purchase-friction':
      return `${baseContext} purchase friction security compliance pricing integration ${attemptConstraint}`.trim();
    case 'risk-barrier':
      return `${baseContext} privacy compliance data security adoption barriers ${attemptConstraint}`.trim();
    case 'security-compliance':
      return `${baseContext} GDPR compliance security questionnaire deployment risk ${attemptConstraint}`.trim();
    default:
      return `${baseContext} ${task.goal} ${attemptConstraint}`.trim();
  }
}

async function checkpointState(
  state: ResearchGraphStateV2,
  partial: Partial<ResearchGraphStateV2>,
  options?: { completed?: boolean },
) {
  const merged = researchGraphStateV2Schema.parse({
    ...state,
    ...partial,
  });
  const publicStage = projectPublicStage(merged.internalStage, merged.taskQueue);
  const status =
    partial.status ??
    (options?.completed ? 'completed' : projectStatus(publicStage));

  await updateRunExecutionState(merged.runId, {
    engineVersion: 'v2',
    status,
    currentStage: publicStage,
    internalStage: merged.internalStage,
    loopIteration: merged.loopControl.supervisorIteration,
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

async function appendSupervisorEvent(
  state: ResearchGraphStateV2,
  stage: ResearchStage,
  eventType: string,
  message: string,
  payload: Record<string, unknown> = {},
) {
  await appendResearchEvent(state.runId, stage, eventType, message, {
    internalStage: state.internalStage,
    iteration: state.loopControl.supervisorIteration,
    ...payload,
  });
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
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

async function summarizeFetchedPage(
  task: ResearchTask,
  page: z.infer<typeof fetchedPageSchema>,
) {
  return generateStructuredOutput<z.infer<typeof pageSummarySchema>>({
    schema: pageSummarySchema,
    system:
      'You are a GTM evidence summarizer. Summarize only what the provided page text directly supports for the requested GTM section.',
    prompt: [
      `Section: ${task.sectionKey}`,
      `Goal: ${task.goal}`,
      `Gap type: ${task.gapType}`,
      `Source preference: ${task.sourcePreference}`,
      `Page title: ${page.title}`,
      `Page URL: ${page.url}`,
      `Page type: ${page.vendorPageType ?? 'unknown'}`,
      `Page text:\n${page.text.slice(0, 6000)}`,
      'Return a concise summary, a direct excerpt, the evidence buckets covered, buyer or user cues, product features, integrations, pricing text if present, and any contradiction signals.',
    ].join('\n\n'),
  });
}

function buildQueryHintsForSection(task: ResearchTask, state: WorkerState) {
  const baseTopic = task.vendorTarget ?? (state.brief?.productCategory ?? state.topic);
  const category = task.sectionKey === 'competitor-landscape' || task.sectionKey === 'pricing-and-packaging'
    ? (state.brief?.productCategory ?? state.topic)
    : getDefaultClaimType(task.sectionKey);
  const repairHints = (task.queryHints.length > 0 ? task.queryHints : [task.gapType]).slice(0, 2);

  return repairHints.map((hint, index) => {
    const intent = (() => {
      switch (task.sectionKey) {
        case 'market-landscape':
          return 'market-size' as SearchIntent;
        case 'competitor-landscape':
          return 'competitor-features' as SearchIntent;
        case 'pricing-and-packaging':
          return 'pricing' as SearchIntent;
        case 'gtm-motion':
          return 'gtm-channels' as SearchIntent;
        case 'risks-and-unknowns':
          return 'buyer-pain' as SearchIntent;
        case 'icp-and-buyer':
        default:
          return index === 0 ? 'adoption' as SearchIntent : 'buyer-pain' as SearchIntent;
      }
    })();

    return {
      intent,
      sectionKey: task.sectionKey,
      subtopic: hint.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || task.sectionKey,
      query:
        task.vendorTarget && task.sourcePreference === 'commercial'
          ? hint === 'canonical-pricing-gap'
            ? `${task.vendorTarget} pricing plans official`
            : `${task.vendorTarget} product features official`
          : buildWebSearchQuery(hint, task, state) || `${baseTopic} ${category} ${hint}`,
      sourcePreference: task.sourcePreference,
      claimType: getDefaultClaimType(task.sectionKey),
      evidenceMode:
        task.type === 'vendor_gap'
          ? 'vendor-primary'
          : task.type === 'document_gap'
            ? 'document-internal'
            : task.sectionKey === 'market-landscape'
              ? 'product-specific'
              : task.sectionKey === 'competitor-landscape' || task.sectionKey === 'pricing-and-packaging'
                ? 'vendor-primary'
                : 'independent-validation',
      vendorTarget: task.vendorTarget,
    } satisfies PlannedSearchQuery;
  });
}

async function routeWorkerTask(state: WorkerState) {
  const goto =
    state.task.type === 'vendor_gap'
      ? 'resolve_canonical_vendor_pages'
      : state.task.type === 'document_gap'
        ? 'build_section_queries'
        : state.task.type === 'contradiction_check'
          ? 'select_claims_for_check'
          : 'plan_queries';

  return new Command({
    goto,
  });
}

async function planQueriesNode(state: WorkerState) {
  return {
    plannedQueries: buildQueryHintsForSection(state.task, state),
  };
}

async function runSearchNode(state: WorkerState, searchService: WebSearchService) {
  const priorFingerprints = new Set(state.queryLedger.map((entry) => entry.fingerprint));
  const seenFingerprints = new Set(priorFingerprints);
  const executableQueries: PlannedSearchQuery[] = [];
  const skippedQueries: PlannedSearchQuery[] = [];

  for (const query of state.plannedQueries) {
    const fingerprint = fingerprintQuery(query.query);
    if (seenFingerprints.has(fingerprint)) {
      skippedQueries.push(query);
      continue;
    }

    seenFingerprints.add(fingerprint);
    executableQueries.push(query);
  }

  const searchResults = executableQueries.length > 0
    ? await searchService.searchMany(executableQueries)
    : [];

  return {
    plannedQueries: executableQueries,
    searchResults,
    queryLedger: [...executableQueries, ...skippedQueries].map((query) => ({
      fingerprint: fingerprintQuery(query.query),
      sectionKey: query.sectionKey,
      query: query.query,
      sourcePreference: query.sourcePreference,
      attempt: state.task.attempt,
      yieldedEvidenceCount: 0,
    })),
  };
}

async function fetchFullPagesNode(state: WorkerState) {
  const existingSources = await listResearchSources(state.runId);
  const seenUrls = new Set(
    [
      ...existingSources.map((source) => source.url).filter((url): url is string => Boolean(url)),
      ...state.sourceFetchLedger.map((entry) => entry.url),
    ],
  );
  const shortlisted = state.searchResults
    .filter((source) => isEligibleSearchResultForTask(state.task, source))
    .filter((source) => !seenUrls.has(source.url ?? ''))
    .sort((left, right) => right.qualityScore - left.qualityScore)
    .slice(0, state.task.sourcePreference === 'commercial' ? 3 : 2);
  const pages = await Promise.all(shortlisted.map(fetchPageRecord));
  const fetchedPages = pages.filter(isPresent);
  const sourceFetchLedger: SourceFetchLedgerEntry[] = fetchedPages.map((page) => ({
    url: page.url,
    sectionKey: state.task.sectionKey,
    taskId: state.task.id,
    fetchedAt: new Date().toISOString(),
  }));

  return {
    fetchedPages,
    sourceFetchLedger,
  };
}

async function summarizePagesNode(state: WorkerState) {
  const summarizedPages = await Promise.all(
    state.fetchedPages.slice(0, state.task.sourcePreference === 'commercial' ? 3 : 2).map(async (page) => ({
      page,
      summary: await summarizeFetchedPage(state.task, page),
      selected: false,
    })),
  );

  return {
    summarizedPages,
  };
}

async function scoreAndSelectSourcesNode(state: WorkerState) {
  const selected = state.summarizedPages.map((entry) => {
    const evidenceFit = entry.summary.evidenceBuckets.length > 0 || entry.summary.coreFeatures.length > 0;
    const topicSeed = state.brief?.productCategory ?? state.brief?.topic ?? state.topic;
    const topicRelevant =
      state.task.sourcePreference === 'commercial'
        ? true
        : hasTopicSignal(
            [
              entry.page.title,
              entry.page.snippet,
              entry.summary.summary,
              entry.summary.excerpt,
              entry.page.url,
            ].join(' '),
            topicSeed,
            state.task.vendorTarget,
            state.task.sectionKey === 'market-landscape' ? 1 : 2,
          );
    const selectedPage =
      state.task.sourcePreference === 'primary'
        ? isEligibleSearchResultForTask(state.task, entry.page) &&
          evidenceFit &&
          topicRelevant &&
          entry.page.qualityScore >= 0.62
        : isEligibleSearchResultForTask(state.task, entry.page) &&
          (evidenceFit || entry.page.qualityScore >= 0.72);
    return {
      ...entry,
      selected: selectedPage,
    };
  });

  return {
    summarizedPages: selected,
    queryLedger: state.queryLedger.map((entry) => ({
      ...entry,
      yieldedEvidenceCount: selected.filter((page) => page.selected).length,
    })),
  };
}

async function persistWebEvidenceNode(state: WorkerState) {
  const existingSources = await listResearchSources(state.runId);
  const existingUrls = new Set(
    existingSources
      .map((source) => source.url)
      .filter((url): url is string => Boolean(url)),
  );
  const pagesToPersist = state.summarizedPages.filter((entry) => entry.selected && !existingUrls.has(entry.page.url));

  const persistedSources = await saveResearchSources(
    state.runId,
    pagesToPersist.map((entry) => {
      const primaryQuery = state.plannedQueries[0];
      const sectionHints = inferSectionHintsFromTaskContext(state.task, primaryQuery, {
        evidenceBuckets: entry.summary.evidenceBuckets,
        claimType: entry.page.claimType,
        evidenceMode: entry.page.evidenceMode,
        vendorPageType: entry.page.vendorPageType,
      });

      return {
        sourceType: 'web',
        title: entry.page.title,
        url: entry.page.url,
        snippet: entry.summary.excerpt,
        metadataJson: {
          query: primaryQuery?.query ?? state.task.goal,
          subtopic: primaryQuery?.subtopic ?? state.task.gapType,
          queryIntent: primaryQuery?.intent ?? 'buyer-pain',
          taskSectionKey: state.task.sectionKey,
          primarySectionHint: sectionHints[0] ?? state.task.sectionKey,
          sectionHints,
          evidenceBuckets: entry.summary.evidenceBuckets,
          claimType: entry.page.claimType,
          evidenceMode: entry.page.evidenceMode,
          vendorTarget: entry.page.vendorTarget,
          vendorPageType: entry.page.vendorPageType,
          domain: entry.page.domain,
          sourceCategory: entry.page.sourceCategory,
          qualityScore: entry.page.qualityScore,
          qualityLabel: entry.page.qualityScore >= 0.8 ? 'high' : entry.page.qualityScore >= 0.62 ? 'medium' : 'low',
          recency: entry.page.publishedYear ? (new Date().getUTCFullYear() - entry.page.publishedYear <= 1 ? 'current' : 'recent') : 'unknown',
          publishedYear: entry.page.publishedYear,
          rationale: entry.summary.summary,
          fullPageSummary: entry.summary.summary,
          contradictionSignals: entry.summary.contradictionSignals,
          targetUser: entry.summary.targetUser,
          coreFeatures: entry.summary.coreFeatures,
          crmIntegrations: entry.summary.crmIntegrations,
          planPricingText: entry.summary.pricingText,
          usedInSynthesis: true,
          fetchedFullPage: true,
          isPrimary: entry.page.sourceCategory === 'official' || entry.page.sourceCategory === 'research',
        },
      };
    }),
  );

  const evidence = await saveResearchEvidence(
    state.runId,
    persistedSources.map((source, index) => ({
      sourceType: 'web',
      sourceId: source.id,
      sectionKey: null,
      title: source.title,
      url: source.url,
      excerpt: pagesToPersist[index]?.summary.excerpt ?? source.snippet ?? source.title,
      metadataJson: source.metadataJson,
    })),
  );

  const candidates = await saveResearchRetrievalCandidates(
    state.runId,
    persistedSources.map((source, index) => ({
      sourceType: 'web',
      retrieverType: 'web_search',
      sectionKey: null,
      query: state.plannedQueries[0]?.query ?? state.task.goal,
      sourceId: source.id,
      title: source.title,
      url: source.url,
      claimType: coerceClaimType(source.metadataJson.claimType),
      evidenceMode: coerceEvidenceMode(source.metadataJson.evidenceMode),
      vendorTarget:
        typeof source.metadataJson.vendorTarget === 'string' ? source.metadataJson.vendorTarget : null,
      rawScore: typeof source.metadataJson.qualityScore === 'number' ? source.metadataJson.qualityScore : 0,
      fusedScore: typeof source.metadataJson.qualityScore === 'number' ? source.metadataJson.qualityScore : 0,
      selected: true,
      metadataJson: {
        ...source.metadataJson,
        summary: pagesToPersist[index]?.summary.summary ?? null,
        contradictionSignals: pagesToPersist[index]?.summary.contradictionSignals ?? [],
      },
    })),
  );

  return {
    taskResult: {
      taskId: state.task.id,
      status: persistedSources.length > 0 ? 'completed' : 'no_new_evidence',
      newSourceIds: persistedSources.map((source) => source.id),
      newEvidenceIds: evidence.map((record) => record.id),
      newCandidateIds: candidates.map((candidate) => candidate.id),
      remainingGaps: persistedSources.length > 0 ? [] : [state.task.gapType],
      recommendedFollowups:
        persistedSources.length > 0 ? [] : ['Tighten the query with stronger vendor or buyer workflow constraints.'],
    } satisfies ResearchTaskResult,
  };
}

async function resolveCanonicalVendorPagesNode(state: WorkerState) {
  const vendorTargets = dedupeStrings([
    state.task.vendorTarget ?? '',
    ...(state.plan?.searchQueries ?? [])
      .filter((query: PlannedSearchQuery) => query.sectionKey === state.task.sectionKey)
      .map((query: PlannedSearchQuery) => query.vendorTarget ?? ''),
  ]).slice(0, 2);

  const pages = vendorTargets.flatMap((vendorTarget) =>
    resolveCanonicalVendorPages(
      vendorTarget,
      state.task.sectionKey === 'pricing-and-packaging' ? 'pricing' : 'competitor-features',
    ),
  );

  return {
    fetchedPages: [],
    plannedQueries: buildQueryHintsForSection(state.task, state),
    searchResults: pages.map((page, index) =>
      scoreWebSource({
        id: `${state.task.id}-canonical-${index}`,
        sourceType: 'web',
        title: page.title,
        url: page.url,
        snippet: page.title,
        query: state.task.goal,
        subtopic: state.task.gapType,
        queryIntent:
          state.task.sectionKey === 'pricing-and-packaging' ? 'pricing' : 'competitor-features',
        sectionKey: state.task.sectionKey,
        claimType: getDefaultClaimType(state.task.sectionKey),
        evidenceMode: 'vendor-primary',
        vendorTarget: state.task.vendorTarget,
        domain: (() => {
          try {
            return new URL(page.url).hostname;
          } catch {
            return null;
          }
        })(),
        vendorPageType: page.vendorPageType,
        productName: page.title,
        targetUser: null,
        coreFeatures: [],
        crmIntegrations: [],
        planPricingText: null,
      }),
    ),
  };
}

async function fetchVendorPagesNode(state: WorkerState) {
  const existingSources = await listResearchSources(state.runId);
  const seenUrls = new Set(
    [
      ...existingSources.map((source) => source.url).filter((url): url is string => Boolean(url)),
      ...state.sourceFetchLedger.map((entry) => entry.url),
    ],
  );
  const pages = await Promise.all(
    state.searchResults
      .filter((source) => !seenUrls.has(source.url ?? ''))
      .slice(0, 2)
      .map(fetchPageRecord),
  );
  const fetchedPages = pages.filter(isPresent);
  return {
    fetchedPages,
    sourceFetchLedger: fetchedPages.map((page) => ({
      url: page.url,
      sectionKey: state.task.sectionKey,
      taskId: state.task.id,
      fetchedAt: new Date().toISOString(),
    })),
  };
}

async function extractVendorFactsNode(state: WorkerState) {
  const summarizedPages = await Promise.all(
    state.fetchedPages.slice(0, 2).map(async (page) => ({
      page,
      summary: await summarizeFetchedPage(state.task, page),
      selected: true,
    })),
  );

  return {
    summarizedPages,
  };
}

async function persistVendorEvidenceNode(state: WorkerState) {
  return persistWebEvidenceNode(state);
}

async function buildSectionQueriesNode(state: WorkerState) {
  const graphishState = {
    topic: state.topic,
    objective: state.objective ?? undefined,
    plan: state.plan as ResearchPlan | null,
  } as ResearchGraphState;

  return {
    plannedQueries: [
      {
        intent: 'buyer-pain',
        sectionKey: state.task.sectionKey,
        subtopic: state.task.gapType,
        query: buildSectionQuery(graphishState, state.task.sectionKey),
        sourcePreference: 'primary',
        claimType: getDefaultClaimType(state.task.sectionKey),
        evidenceMode: 'document-internal',
        vendorTarget: null,
      },
      {
        intent: 'buyer-pain',
        sectionKey: state.task.sectionKey,
        subtopic: `${state.task.gapType}-lexical`,
        query: buildLexicalQuery(graphishState, state.task.sectionKey),
        sourcePreference: 'primary',
        claimType: getDefaultClaimType(state.task.sectionKey),
        evidenceMode: 'document-internal',
        vendorTarget: null,
      },
    ],
  };
}

async function denseRetrieveNode(state: WorkerState) {
  if (state.selectedDocumentIds.length === 0) {
    return {
      denseMatches: [],
    };
  }

  const embedding = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: state.plannedQueries[0]?.query ?? `${state.topic} ${state.task.sectionKey}`,
  });
  const supabase = createSupabaseServerClient();
  const denseResponse = await supabase.rpc('match_run_documents', {
    query_embedding: JSON.stringify(embedding.data[0].embedding),
    match_count: 6,
    document_ids: state.selectedDocumentIds,
  });

  if (denseResponse.error) {
    throw new Error(denseResponse.error.message);
  }

  return {
    denseMatches: (denseResponse.data ?? []) as DocumentMatchRow[],
  };
}

async function lexicalRetrieveNode(state: WorkerState) {
  if (state.selectedDocumentIds.length === 0) {
    return {
      lexicalMatches: [],
    };
  }

  const supabase = createSupabaseServerClient();
  const lexicalResponse = await supabase.rpc('match_run_documents_lexical', {
    search_query: state.plannedQueries[1]?.query ?? state.plannedQueries[0]?.query ?? state.task.goal,
    match_count: 6,
    document_ids: state.selectedDocumentIds,
  });

  if (lexicalResponse.error) {
    throw new Error(lexicalResponse.error.message);
  }

  return {
    lexicalMatches: (lexicalResponse.data ?? []) as LexicalMatchRow[],
  };
}

async function rrfSelectNode(state: WorkerState) {
  const denseLane = state.denseMatches.map((match, index) => ({
    id: String(match.id),
    score: Number((match.similarity ?? 0).toFixed(6)),
    rank: index + 1,
    match,
  }));
  const lexicalLane = state.lexicalMatches.map((match, index) => ({
    id: String(match.id),
    score: Number((match.rank_score ?? 0).toFixed(6)),
    rank: index + 1,
    match,
  }));
  const fused = reciprocalRankFuse(
    [...denseLane, ...lexicalLane].length === 0 ? [] : [denseLane, lexicalLane],
  ).slice(0, 4);

  return {
    selectedDocumentMatches: fused.map(({ candidate, fusedScore }) => {
      const denseMatch = denseLane.find((entry) => entry.id === candidate.id)?.match;
      const lexicalMatch = lexicalLane.find((entry) => entry.id === candidate.id)?.match;
      const match = denseMatch ?? lexicalMatch;
      return {
        match,
        fusedScore,
        denseMatched: Boolean(denseMatch),
        lexicalMatched: Boolean(lexicalMatch),
      };
    }).filter((entry) => Boolean(entry.match)),
  };
}

async function persistDocumentEvidenceNode(state: WorkerState) {
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

  const candidateInputs = state.selectedDocumentMatches.flatMap((entry) => {
    const metadata = entry.match?.metadata ?? {};
    const dense = state.denseMatches.find((match) => match.id === entry.match?.id);
    const lexical = state.lexicalMatches.find((match) => match.id === entry.match?.id);
    const title = typeof metadata.file_name === 'string' ? metadata.file_name : `Document chunk ${entry.match?.id}`;
    const documentExternalId =
      typeof metadata.document_id === 'string' ? metadata.document_id : null;
    return [
      (() => {
        const primaryQuery = state.plannedQueries[0];
        const sectionHints = inferSectionHintsFromTaskContext(state.task, primaryQuery, {
          claimType: getDefaultClaimType(state.task.sectionKey),
          evidenceMode: 'document-internal',
        });

        return {
        sourceType: 'document' as const,
        retrieverType: 'fusion' as const,
        sectionKey: null,
        query: primaryQuery?.query ?? state.task.goal,
        documentExternalId,
        documentChunkId: entry.match?.id ?? null,
        title,
        url: typeof metadata.file_url === 'string' ? metadata.file_url : null,
        claimType: getDefaultClaimType(state.task.sectionKey),
        evidenceMode: 'document-internal' as const,
        vendorTarget: null,
        rawScore: dense?.similarity ?? lexical?.rank_score ?? 0,
        fusedScore: entry.fusedScore,
        selected: true,
        metadataJson: {
          lane: 'fusion',
          denseMatched: entry.denseMatched,
          lexicalMatched: entry.lexicalMatched,
          queryIntent: primaryQuery?.intent ?? 'buyer-pain',
          subtopic: primaryQuery?.subtopic ?? state.task.gapType,
          taskSectionKey: state.task.sectionKey,
          primarySectionHint: sectionHints[0] ?? state.task.sectionKey,
          sectionHints,
        },
      };
      })(),
    ];
  });

  const persistedCandidates = await saveResearchRetrievalCandidates(state.runId, candidateInputs);

  const evidenceInputs = state.selectedDocumentMatches
    .filter((entry) => {
      const chunkKey = `${typeof entry.match?.metadata?.document_id === 'string' ? entry.match.metadata.document_id : 'unknown'}:${entry.match?.id ?? 'none'}`;
      return !existingChunkKeys.has(chunkKey);
    })
    .map((entry) => {
      const metadata = entry.match?.metadata ?? {};
      const documentExternalId =
        typeof metadata.document_id === 'string' ? metadata.document_id : null;
      const title = typeof metadata.file_name === 'string' ? metadata.file_name : `Document chunk ${entry.match?.id}`;
      const primaryQuery = state.plannedQueries[0];
      const sectionHints = inferSectionHintsFromTaskContext(state.task, primaryQuery, {
        claimType: getDefaultClaimType(state.task.sectionKey),
        evidenceMode: 'document-internal',
      });

      return {
        sourceType: 'document' as const,
        sourceId: documentExternalId ? sourceIdByDocument.get(documentExternalId) ?? null : null,
        documentChunkId: entry.match?.id ?? null,
        documentExternalId,
        sectionKey: null,
        title,
        url: typeof metadata.file_url === 'string' ? metadata.file_url : null,
        excerpt: entry.match?.content ?? '',
        metadataJson: {
          fileName: typeof metadata.file_name === 'string' ? metadata.file_name : null,
          similarity:
            typeof (entry.match as DocumentMatchRow | undefined)?.similarity === 'number'
              ? Number(((entry.match as DocumentMatchRow).similarity ?? 0).toFixed(4))
              : null,
          lexicalRankScore:
            typeof (entry.match as LexicalMatchRow | undefined)?.rank_score === 'number'
              ? Number(((entry.match as LexicalMatchRow).rank_score ?? 0).toFixed(4))
              : null,
          qualityScore: 0.84,
          sourceCategory: 'research',
          claimType: getDefaultClaimType(state.task.sectionKey),
          evidenceMode: 'document-internal',
          queryIntent: primaryQuery?.intent ?? 'buyer-pain',
          subtopic: primaryQuery?.subtopic ?? state.task.gapType,
          taskSectionKey: state.task.sectionKey,
          primarySectionHint: sectionHints[0] ?? state.task.sectionKey,
          sectionHints,
          usedInSynthesis: true,
          fusedScore: entry.fusedScore,
        },
      };
    });
  const persistedEvidence = await saveResearchEvidence(state.runId, evidenceInputs);

  return {
    taskResult: {
      taskId: state.task.id,
      status: persistedEvidence.length > 0 ? 'completed' : 'no_new_evidence',
      newSourceIds: [],
      newEvidenceIds: persistedEvidence.map((record) => record.id),
      newCandidateIds: persistedCandidates.map((candidate) => candidate.id),
      remainingGaps: persistedEvidence.length > 0 ? [] : [state.task.gapType],
      recommendedFollowups:
        persistedEvidence.length > 0 ? [] : ['No linked document chunks matched strongly enough for this section.'],
    } satisfies ResearchTaskResult,
  };
}

async function selectClaimsForCheckNode(state: WorkerState) {
  return {
    plannedQueries: buildQueryHintsForSection(state.task, state).map((query) => ({
      ...query,
      query: `${query.query} counterevidence OR limitations OR alternatives`,
    })),
  };
}

async function seekCounterevidenceNode(state: WorkerState, searchService: WebSearchService) {
  const searchResults = await searchService.searchMany(state.plannedQueries);
  const fetched = await Promise.all(searchResults.slice(0, 3).map(fetchPageRecord));
  const fetchedPages = fetched.filter(isPresent);
  const summarizedPages = await Promise.all(
    fetchedPages.map(async (page) => ({
      page,
      summary: await summarizeFetchedPage(state.task, page),
      selected: true,
    })),
  );

  return {
    searchResults,
    fetchedPages,
    summarizedPages,
    queryLedger: state.plannedQueries.map((query) => ({
      fingerprint: fingerprintQuery(query.query),
      sectionKey: query.sectionKey,
      query: query.query,
      sourcePreference: query.sourcePreference,
      attempt: state.task.attempt,
      yieldedEvidenceCount: summarizedPages.length,
    })),
    sourceFetchLedger: fetchedPages.map((page) => ({
      url: page.url,
      sectionKey: state.task.sectionKey,
      taskId: state.task.id,
      fetchedAt: new Date().toISOString(),
    })),
  };
}

async function persistContradictionsNode(state: WorkerState) {
  const persisted = await persistWebEvidenceNode(state);
  return {
    ...persisted,
    taskResult: {
      ...(persisted.taskResult as ResearchTaskResult),
      recommendedFollowups: dedupeStrings([
        ...(persisted.taskResult as ResearchTaskResult).recommendedFollowups,
        ...state.summarizedPages.flatMap((entry) => entry.summary.contradictionSignals),
      ]),
    },
  };
}

function createWorkerGraph(searchService: WebSearchService) {
  return new StateGraph(workerStateSchema)
    .addNode('route_task', routeWorkerTask, {
      ends: [
        'plan_queries',
        'resolve_canonical_vendor_pages',
        'build_section_queries',
        'select_claims_for_check',
      ],
    })
    .addNode('plan_queries', planQueriesNode)
    .addNode('run_search', (state) => runSearchNode(state, searchService))
    .addNode('fetch_full_pages', fetchFullPagesNode)
    .addNode('summarize_pages', summarizePagesNode)
    .addNode('score_and_select_sources', scoreAndSelectSourcesNode)
    .addNode('persist_web_evidence', persistWebEvidenceNode)
    .addNode('resolve_canonical_vendor_pages', resolveCanonicalVendorPagesNode)
    .addNode('fetch_vendor_pages', fetchVendorPagesNode)
    .addNode('extract_vendor_facts', extractVendorFactsNode)
    .addNode('persist_vendor_evidence', persistVendorEvidenceNode)
    .addNode('build_section_queries', buildSectionQueriesNode)
    .addNode('dense_retrieve', denseRetrieveNode)
    .addNode('lexical_retrieve', lexicalRetrieveNode)
    .addNode('rrf_select', rrfSelectNode)
    .addNode('persist_document_evidence', persistDocumentEvidenceNode)
    .addNode('select_claims_for_check', selectClaimsForCheckNode)
    .addNode('seek_counterevidence', (state) => seekCounterevidenceNode(state, searchService))
    .addNode('persist_contradictions', persistContradictionsNode)
    .addEdge(START, 'route_task')
    .addEdge('plan_queries', 'run_search')
    .addEdge('run_search', 'fetch_full_pages')
    .addEdge('fetch_full_pages', 'summarize_pages')
    .addEdge('summarize_pages', 'score_and_select_sources')
    .addEdge('score_and_select_sources', 'persist_web_evidence')
    .addEdge('persist_web_evidence', END)
    .addEdge('resolve_canonical_vendor_pages', 'fetch_vendor_pages')
    .addEdge('fetch_vendor_pages', 'extract_vendor_facts')
    .addEdge('extract_vendor_facts', 'persist_vendor_evidence')
    .addEdge('persist_vendor_evidence', END)
    .addEdge('build_section_queries', 'dense_retrieve')
    .addEdge('dense_retrieve', 'lexical_retrieve')
    .addEdge('lexical_retrieve', 'rrf_select')
    .addEdge('rrf_select', 'persist_document_evidence')
    .addEdge('persist_document_evidence', END)
    .addEdge('select_claims_for_check', 'seek_counterevidence')
    .addEdge('seek_counterevidence', 'persist_contradictions')
    .addEdge('persist_contradictions', END)
    .compile();
}

async function hydrateRunNode(state: ResearchGraphStateV2) {
  const updated = await checkpointState(state, {
    engineVersion: 'v2',
    internalStage: 'hydrate_run',
    publicStage: 'plan',
    currentStage: 'plan',
    status: projectStatus('plan'),
    legacyPlan: state.legacyPlan ?? state.plan,
    evidenceLedger: state.evidenceRecords.map((record) => record.id),
    pauseState:
      state.pauseState.status === 'awaiting_user'
        ? state.pauseState
        : {
            status: 'running',
            question: null,
            resumeToken: state.runId,
          },
  });

  return {
    internalStage: updated.internalStage,
    publicStage: updated.publicStage,
    currentStage: updated.currentStage,
    status: updated.status,
    legacyPlan: updated.legacyPlan,
    evidenceLedger: updated.evidenceLedger,
    pauseState: updated.pauseState,
  };
}

async function clarifyScopeNode(state: ResearchGraphStateV2) {
  if (state.pauseState.status === 'awaiting_user' && !state.resumeClarificationResponse) {
    return new Command({
      goto: END,
    });
  }

  const userRequest = state.resumeClarificationResponse
    ? buildUserRequest(state.topic, state.objective, state.resumeClarificationResponse)
    : state.userRequest;

  const assessment = await generateStructuredOutput<z.infer<typeof scopeAssessmentSchema>>({
    schema: scopeAssessmentSchema,
    system:
      'You are a GTM scope analyst. Extract the product category, target buyer, company type, geography, time horizon, known vendors, and whether a clarification question is required before enterprise GTM research starts.',
    prompt: [
      userRequest,
      'Only require clarification when the product category, target buyer, or desired comparison scope is too vague to guide enterprise GTM research.',
      'If clarification is required, ask one concise question that will unblock research.',
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
          'What product category, target buyer, and comparison scope should this GTM research focus on?',
        resumeToken: state.runId,
      },
      resumeClarificationResponse: null,
    };
    const updated = await checkpointState(state, partial);
    await appendSupervisorEvent(updated, 'plan', 'clarification_requested', updated.pauseState.question ?? 'Clarification requested.');
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

  if (state.resumeClarificationResponse) {
    await appendSupervisorEvent(state, 'plan', 'clarification_received', 'Clarification response received.', {
      clarificationResponse: state.resumeClarificationResponse,
    });
  }

  return new Command({
    update: partial,
    goto: 'build_research_brief',
  });
}

async function buildResearchBriefNode(state: ResearchGraphStateV2) {
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
    internalStage: 'build_research_brief',
  };
  await checkpointState(state, partial);
  return partial;
}

async function buildCompatPlanNode(state: ResearchGraphStateV2) {
  const planned = await runPlanNode(state);
  const coveragePlan = state.coveragePlan ?? buildDefaultCoveragePlan();
  const mergedPlan: ResearchPlan = {
    ...(planned.plan ?? state.plan ?? state.legacyPlan ?? {
      researchQuestions: [],
      searchQueries: [],
      sections: [],
    }),
    brief: state.brief ?? undefined,
    coveragePlan,
    queryStrategy: buildQueryStrategy(planned.plan ?? state.plan ?? null),
    repairHistory: state.plan?.repairHistory ?? [],
  };

  await saveRunPlan(state.runId, mergedPlan);
  const partial = {
    plan: mergedPlan,
    legacyPlan: planned.plan ?? state.plan,
    coveragePlan,
    internalStage: 'build_compat_plan',
    publicStage: 'plan' as const,
    currentStage: 'plan' as const,
    status: projectStatus('plan'),
    sectionStates: buildSectionStates({
      ...state,
      plan: mergedPlan,
      coveragePlan,
    }),
  };
  await checkpointState(state, partial);

  return partial;
}

async function assessSectionCoverageNode(state: ResearchGraphStateV2) {
  const sectionStates = buildSectionStates(state);
  const partial = {
    sectionStates,
    internalStage: 'assess_section_coverage',
    publicStage: 'verification' as const,
    currentStage: 'verification' as const,
    status: projectStatus('verification'),
  };
  await checkpointState(state, partial);
  await appendSupervisorEvent(state, 'verification', 'coverage_assessed', 'Section coverage assessed.', {
    sectionsNeedingRepair: sectionStates.filter((entry) => entry.coverageStatus !== 'satisfied' && entry.sectionKey !== 'recommendation').length,
  });
  return partial;
}

async function generateRepairTasksNode(state: ResearchGraphStateV2) {
  const candidateSections = state.sectionStates.filter(
    (entry) => entry.sectionKey !== 'recommendation' && entry.coverageStatus !== 'satisfied',
  );
  if (candidateSections.length === 0) {
    return new Command({
      update: {
        taskQueue: [],
        activeTasks: [],
        internalStage: 'generate_repair_tasks',
      },
      goto: END,
    });
  }

  const generatedTasks = buildDeterministicRepairTasks(state, candidateSections);

  const taskQueue = generatedTasks
    .map((task, index) => ({
      id: `${state.runId}-${state.loopControl.supervisorIteration}-${task.sectionKey}-${task.type}-${index}`,
      ...task,
      attempt: getAttemptCount(state, task.sectionKey, task.gapType),
    }))
    .filter((task) => task.attempt < state.loopControl.maxTaskAttemptsPerSection)
    .sort((left, right) => left.priority - right.priority)
    .slice(0, state.loopControl.maxConcurrentWorkers);

  const partial = {
    taskQueue,
    activeTasks: [],
    internalStage: 'generate_repair_tasks',
  };
  await checkpointState(state, partial);
  await appendSupervisorEvent(state, 'verification', 'repair_tasks_generated', 'Repair tasks generated.', {
    taskCount: taskQueue.length,
    tasks: taskQueue.map((task) => ({
      taskId: task.id,
      taskType: task.type,
      sectionKey: task.sectionKey,
    })),
  });

  return new Command({
    update: partial,
    goto: taskQueue.length > 0 ? 'dispatch_workers' : END,
  });
}

async function dispatchWorkersNode(state: ResearchGraphStateV2, workerGraph: ReturnType<typeof createWorkerGraph>) {
  if (state.taskQueue.length === 0) {
    return {
      internalStage: 'dispatch_workers',
      activeTasks: [],
    };
  }

  const activeTasks = state.taskQueue.slice(0, state.loopControl.maxConcurrentWorkers);
  const workerResults = await Promise.all(
    activeTasks.map((task) =>
      workerGraph.invoke({
        runId: state.runId,
        topic: getTopicOrCategory(state),
        objective: state.objective ?? null,
        brief: state.brief,
        plan: state.plan,
        selectedDocumentIds: state.selectedDocumentIds,
        linkedDocuments: state.linkedDocuments,
        sourceFetchLedger: state.sourceFetchLedger,
        task,
      }),
    ),
  );

  const completedTasks = [
    ...state.completedTasks,
    ...workerResults
      .map((result) => result.taskResult)
      .filter((result): result is ResearchTaskResult => Boolean(result)),
  ];
  const queryLedger = [
    ...state.queryLedger,
    ...workerResults.flatMap((result) => result.queryLedger ?? []),
  ];
  const sourceFetchLedger = [
    ...state.sourceFetchLedger,
    ...workerResults.flatMap((result) => result.sourceFetchLedger ?? []),
  ];

  const partial = {
    activeTasks: [],
    completedTasks,
    queryLedger,
    sourceFetchLedger,
    internalStage: 'dispatch_workers',
    publicStage: projectPublicStage('dispatch_workers', activeTasks),
    currentStage: projectPublicStage('dispatch_workers', activeTasks),
    status: projectStatus(projectPublicStage('dispatch_workers', activeTasks)),
  };
  await checkpointState(state, partial);
  await appendSupervisorEvent(state, partial.currentStage, 'workers_dispatched', 'Supervisor workers completed.', {
    iteration: state.loopControl.supervisorIteration,
    taskCount: activeTasks.length,
    tasks: activeTasks.map((task) => ({
      workerId: task.id,
      taskType: task.type,
      sectionKey: task.sectionKey,
    })),
  });
  return partial;
}

async function mergeWorkerResultsNode(state: ResearchGraphStateV2) {
  const refreshed = await hydrateLedgerState(state);
  const mergedState = {
    ...state,
    ...refreshed,
    evidenceLedger: refreshed.evidenceRecords.map((record) => record.id),
    sectionStates: buildSectionStates({
      ...state,
      ...refreshed,
    } as ResearchGraphStateV2),
  } satisfies ResearchGraphStateV2;
  const priorSelectedEvidenceCount = state.sectionStates.reduce(
    (count, section) => count + section.selectedEvidenceIds.length,
    0,
  );
  const nextSelectedEvidenceCount = mergedState.sectionStates.reduce(
    (count, section) => count + section.selectedEvidenceIds.length,
    0,
  );
  const improved = mergedState.sectionStates.some((section) => {
    const previous = state.sectionStates.find((entry) => entry.sectionKey === section.sectionKey);
    return (
      section.selectedEvidenceIds.length > (previous?.selectedEvidenceIds.length ?? 0) ||
      getCoverageStatusRank(section.coverageStatus) > getCoverageStatusRank(previous?.coverageStatus ?? 'insufficient_evidence')
    );
  });
  const historyEntries = state.completedTasks.slice(-state.taskQueue.length).map((result) => ({
    iteration: state.loopControl.supervisorIteration,
    taskId: result.taskId,
    sectionKey:
      state.taskQueue.find((task) => task.id === result.taskId)?.sectionKey ?? 'market-landscape',
    taskType:
      state.taskQueue.find((task) => task.id === result.taskId)?.type ?? 'web_gap',
    result: result.status,
    selectedEvidenceDelta: Math.max(0, nextSelectedEvidenceCount - priorSelectedEvidenceCount),
    improved,
    note:
      state.taskQueue.find((task) => task.id === result.taskId)?.gapType ??
      null,
  }));
  const plan: ResearchPlan | null = state.plan
    ? {
        ...state.plan,
        repairHistory: [...(state.plan.repairHistory ?? []), ...historyEntries],
      }
    : null;

  if (plan) {
    await saveRunPlan(state.runId, plan);
  }

  const partial = {
    ...refreshed,
    plan,
    evidenceLedger: mergedState.evidenceLedger,
    sectionStates: mergedState.sectionStates,
    taskQueue: [],
    internalStage: 'merge_worker_results',
  };
  await checkpointState(state, partial);
  return partial;
}

async function decideNextStepNode(state: ResearchGraphStateV2) {
  const sectionsNeedingRepair = state.sectionStates.filter(
    (entry) => entry.sectionKey !== 'recommendation' && entry.coverageStatus !== 'satisfied',
  );
  const stopForBudget = state.loopControl.supervisorIteration >= state.loopControl.maxSupervisorIterations;
  const repeatedDryQuery = state.queryLedger.some((entry, index, allEntries) =>
    entry.yieldedEvidenceCount === 0 &&
    allEntries.findIndex((candidate) => candidate.fingerprint === entry.fingerprint) !== index,
  );
  const stopForStall = shouldStopForStall(state);
  const shouldLoop =
    sectionsNeedingRepair.length > 0 && !stopForBudget && !repeatedDryQuery && !stopForStall;

  const partial = {
    internalStage: 'decide_next_step',
    loopControl: {
      ...state.loopControl,
      supervisorIteration: shouldLoop
        ? state.loopControl.supervisorIteration + 1
        : state.loopControl.supervisorIteration,
    },
  };
  await checkpointState(state, partial);
  return new Command({
    update: partial,
    goto: shouldLoop ? 'generate_repair_tasks' : END,
  });
}

async function draftFindingsNode(state: ResearchGraphStateV2) {
  const refreshed = await hydrateLedgerState(state);
  const result = await runDraftReportNodeForceRefresh({
    ...state,
    ...refreshed,
  });
  const partial = {
    ...result,
    draftFindings: result.findings,
    internalStage: 'draft_findings',
    publicStage: 'draft_report' as const,
    currentStage: 'draft_report' as const,
    status: projectStatus('draft_report'),
  };
  await checkpointState(
    {
      ...state,
      ...refreshed,
    } as ResearchGraphStateV2,
    partial,
  );
  return partial;
}

async function verifyFindingsNode(state: ResearchGraphStateV2) {
  const refreshed = await hydrateLedgerState(state);
  const result = await runVerificationNodeForceRefresh({
    ...state,
    ...refreshed,
  });
  const verifiedFindings = result.findings.filter(
    (finding) => finding.status !== 'draft',
  ) as ResearchGraphStateV2['verifiedFindings'];
  const partial = {
    ...result,
    verifiedFindings,
    contradictions: dedupeStrings(result.findings.flatMap((finding) => finding.contradictions)),
    internalStage: 'verify_findings',
    publicStage: 'verification' as const,
    currentStage: 'verification' as const,
    status: projectStatus('verification'),
  };
  await checkpointState(
    {
      ...state,
      ...refreshed,
    } as ResearchGraphStateV2,
    partial,
  );
  return partial;
}

async function emitRepairTasksNode(state: ResearchGraphStateV2) {
  const sectionStates = buildSectionStates(state);
  if (state.postVerificationRepairPasses >= MAX_POST_VERIFICATION_REPAIR_PASSES) {
    const partial = {
      sectionStates,
      taskQueue: [],
      internalStage: 'emit_repair_tasks',
    };
    await checkpointState(state, partial);
    return partial;
  }

  const taskQueue = buildVerificationRepairTasks(state, sectionStates)
    .map((task, index) => ({
      id: `${state.runId}-verify-${state.loopControl.supervisorIteration}-${task.sectionKey}-${index}`,
      ...task,
      attempt: getAttemptCount(state, task.sectionKey, task.gapType),
    }))
    .filter((task) => task.attempt < state.loopControl.maxTaskAttemptsPerSection)
    .slice(0, state.loopControl.maxConcurrentWorkers);

  const partial = {
    sectionStates,
    taskQueue,
    internalStage: 'emit_repair_tasks',
  };
  await checkpointState(state, partial);
  return partial;
}

async function markPostVerificationRepairPassNode(state: ResearchGraphStateV2) {
  const partial = {
    postVerificationRepairPasses: state.postVerificationRepairPasses + 1,
    internalStage: 'mark_post_verification_repair',
    publicStage: 'verification' as const,
    currentStage: 'verification' as const,
    status: projectStatus('verification'),
  };
  await checkpointState(state, partial);
  return partial;
}

async function composeSectionsNode(state: ResearchGraphStateV2) {
  const partial = {
    internalStage: 'compose_sections',
    publicStage: 'draft_report' as const,
    currentStage: 'draft_report' as const,
    status: projectStatus('draft_report'),
  };
  await checkpointState(state, partial);
  return partial;
}

async function buildRecommendationNode(state: ResearchGraphStateV2) {
  const partial = {
    internalStage: 'build_recommendation',
    publicStage: 'draft_report' as const,
    currentStage: 'draft_report' as const,
    status: projectStatus('draft_report'),
  };
  await checkpointState(state, partial);
  return partial;
}

async function projectPublicStageNode(state: ResearchGraphStateV2) {
  const partial = {
    internalStage: 'project_public_stage',
    publicStage: 'finalize' as const,
    currentStage: 'finalize' as const,
  };
  await checkpointState(state, partial);
  return partial;
}

async function persistReportSectionsNode(state: ResearchGraphStateV2) {
  const refreshed = await hydrateLedgerState(state);
  const result = await runFinalizeNode({
    ...state,
    ...refreshed,
  });
  const partial = {
    ...result,
    internalStage: 'persist_report_sections',
    publicStage: 'finalize' as const,
    currentStage: 'finalize' as const,
  };
  await checkpointState(
    {
      ...state,
      ...refreshed,
    } as ResearchGraphStateV2,
    partial,
    { completed: result.status === 'completed' },
  );
  return partial;
}

async function finalizeRunNodeV2(state: ResearchGraphStateV2) {
  const partial = {
    internalStage: 'finalize_run',
    publicStage: 'finalize' as const,
    currentStage: 'finalize' as const,
    status: 'completed' as const,
  };
  await checkpointState(state, partial, { completed: true });
  return partial;
}

function createScopeSubgraph() {
  return new StateGraph(researchGraphStateV2Schema)
    .addNode('hydrate_run', hydrateRunNode)
    .addNode('clarify_scope', clarifyScopeNode, {
      ends: ['build_research_brief', END],
    })
    .addNode('build_research_brief', buildResearchBriefNode)
    .addNode('build_compat_plan', buildCompatPlanNode)
    .addEdge(START, 'hydrate_run')
    .addEdge('hydrate_run', 'clarify_scope')
    .addEdge('build_research_brief', 'build_compat_plan')
    .addEdge('build_compat_plan', END)
    .compile();
}

function createSupervisorSubgraph(searchService: WebSearchService) {
  const workerGraph = createWorkerGraph(searchService);

  return new StateGraph(researchGraphStateV2Schema)
    .addNode('assess_section_coverage', assessSectionCoverageNode)
    .addNode('generate_repair_tasks', generateRepairTasksNode, {
      ends: ['dispatch_workers', END],
    })
    .addNode('dispatch_workers', (state) => dispatchWorkersNode(state, workerGraph))
    .addNode('merge_worker_results', mergeWorkerResultsNode)
    .addNode('decide_next_step', decideNextStepNode, {
      ends: ['generate_repair_tasks', END],
    })
    .addEdge(START, 'assess_section_coverage')
    .addEdge('assess_section_coverage', 'generate_repair_tasks')
    .addEdge('dispatch_workers', 'merge_worker_results')
    .addEdge('merge_worker_results', 'decide_next_step')
    .compile();
}

function createSynthesisSubgraph() {
  return new StateGraph(researchGraphStateV2Schema)
    .addNode('draft_findings', draftFindingsNode)
    .addNode('verify_findings', verifyFindingsNode)
    .addNode('emit_repair_tasks', emitRepairTasksNode)
    .addEdge(START, 'draft_findings')
    .addEdge('draft_findings', 'verify_findings')
    .addEdge('verify_findings', 'emit_repair_tasks')
    .addEdge('emit_repair_tasks', END)
    .compile();
}

function createFinalizeSubgraph() {
  return new StateGraph(researchGraphStateV2Schema)
    .addNode('compose_sections', composeSectionsNode)
    .addNode('build_recommendation', buildRecommendationNode)
    .addNode('project_public_stage', projectPublicStageNode)
    .addNode('persist_report_sections', persistReportSectionsNode)
    .addNode('finalize_run', finalizeRunNodeV2)
    .addEdge(START, 'compose_sections')
    .addEdge('compose_sections', 'build_recommendation')
    .addEdge('build_recommendation', 'project_public_stage')
    .addEdge('project_public_stage', 'persist_report_sections')
    .addEdge('persist_report_sections', 'finalize_run')
    .addEdge('finalize_run', END)
    .compile();
}

function createVerificationRepairSubgraph(searchService: WebSearchService) {
  const workerGraph = createWorkerGraph(searchService);

  return new StateGraph(researchGraphStateV2Schema)
    .addNode('mark_post_verification_repair', markPostVerificationRepairPassNode)
    .addNode('dispatch_workers', (state) => dispatchWorkersNode(state, workerGraph))
    .addNode('merge_worker_results', mergeWorkerResultsNode)
    .addEdge(START, 'mark_post_verification_repair')
    .addEdge('mark_post_verification_repair', 'dispatch_workers')
    .addEdge('dispatch_workers', 'merge_worker_results')
    .addEdge('merge_worker_results', END)
    .compile();
}

export function createResearchGraphV2(searchService: WebSearchService) {
  const scope = createScopeSubgraph();
  const supervisor = createSupervisorSubgraph(searchService);
  const synthesis = createSynthesisSubgraph();
  const verificationRepair = createVerificationRepairSubgraph(searchService);
  const finalize = createFinalizeSubgraph();

  return new StateGraph(researchGraphStateV2Schema)
    .addNode('scope_subgraph', scope)
    .addNode('research_supervisor', supervisor)
    .addNode('synthesis_subgraph', synthesis)
    .addNode('verification_repair_subgraph', verificationRepair)
    .addNode('finalize_subgraph', finalize)
    .addEdge(START, 'scope_subgraph')
    .addConditionalEdges('scope_subgraph', (state) =>
      state.pauseState.status === 'awaiting_user' ? END : 'research_supervisor',
    )
    .addEdge('research_supervisor', 'synthesis_subgraph')
    .addConditionalEdges('synthesis_subgraph', (state) => {
      const hasRepairableTasks =
        state.taskQueue.length > 0 &&
        state.postVerificationRepairPasses < MAX_POST_VERIFICATION_REPAIR_PASSES;
      return hasRepairableTasks ? 'verification_repair_subgraph' : 'finalize_subgraph';
    })
    .addEdge('verification_repair_subgraph', 'synthesis_subgraph')
    .addEdge('finalize_subgraph', END)
    .compile();
}

export async function buildInitialGraphStateV2(
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
  const persisted = (run.workflowStateJson ?? {}) as Partial<ResearchGraphStateV2>;

  return researchGraphStateV2Schema.parse({
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
    engineVersion: run.engineVersion,
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
      maxSupervisorIterations: persisted.loopControl?.maxSupervisorIterations ?? 4,
      maxConcurrentWorkers: persisted.loopControl?.maxConcurrentWorkers ?? 4,
      maxTaskAttemptsPerSection: persisted.loopControl?.maxTaskAttemptsPerSection ?? 2,
      maxStallIterations: persisted.loopControl?.maxStallIterations ?? 2,
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
  });
}

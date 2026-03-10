import { generateStructuredOutput } from '@/lib/research/ai';
import {
  appendResearchEvent,
  hasStageCompleted,
  saveRunPlan,
  setRunStage,
} from '@/lib/research/repository';
import {
  researchPlanSchema,
  type PlannedSearchQuery,
  type ResearchGraphState,
  type ResearchPlan,
} from '@/lib/research/schemas';

const defaultVendorTargets = ['Otter.ai', 'Fireflies.ai', 'Fathom', 'Zoom AI Companion'];

function withUniqueQueries(queries: PlannedSearchQuery[]) {
  const seen = new Set<string>();
  return queries.filter((query) => {
    const key = `${query.sectionKey}:${query.query.toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildFallbackQueries(topic: string): PlannedSearchQuery[] {
  return [
    {
      intent: 'market-size',
      sectionKey: 'market-landscape',
      subtopic: 'uk-market-growth',
      query: `${topic} market size and growth UK site:gov.uk OR site:oecd.org OR filetype:pdf`,
      sourcePreference: 'primary',
      claimType: 'market-sizing',
      evidenceMode: 'market-adjacent',
      vendorTarget: null,
    },
    {
      intent: 'market-size',
      sectionKey: 'market-landscape',
      subtopic: 'product-category-demand',
      query: `${topic} meeting transcription conversation intelligence market report UK`,
      sourcePreference: 'mixed',
      claimType: 'market-sizing',
      evidenceMode: 'product-specific',
      vendorTarget: null,
    },
    {
      intent: 'adoption',
      sectionKey: 'icp-and-buyer',
      subtopic: 'sme-ai-adoption',
      query: `UK SMEs AI adoption sales workflow survey site:gov.uk OR site:ons.gov.uk OR site:oecd.org`,
      sourcePreference: 'primary',
      claimType: 'adoption-signal',
      evidenceMode: 'market-adjacent',
      vendorTarget: null,
    },
    {
      intent: 'buyer-pain',
      sectionKey: 'icp-and-buyer',
      subtopic: 'sales-admin-burden',
      query: `UK SMB sales teams meeting notes CRM admin burden research report`,
      sourcePreference: 'mixed',
      claimType: 'buyer-pain',
      evidenceMode: 'independent-validation',
      vendorTarget: null,
    },
    ...defaultVendorTargets.flatMap((vendor) => [
      {
        intent: 'competitor-features' as const,
        sectionKey: 'competitor-landscape' as const,
        subtopic: `${vendor.toLowerCase()}-features`,
        query: `${vendor} AI meeting assistant features CRM integrations sales teams`,
        sourcePreference: 'commercial' as const,
        claimType: 'competitor-feature' as const,
        evidenceMode: 'vendor-primary' as const,
        vendorTarget: vendor,
      },
      {
        intent: 'pricing' as const,
        sectionKey: 'pricing-and-packaging' as const,
        subtopic: `${vendor.toLowerCase()}-pricing`,
        query: `${vendor} pricing AI meeting assistant sales teams`,
        sourcePreference: 'commercial' as const,
        claimType: 'pricing' as const,
        evidenceMode: 'vendor-primary' as const,
        vendorTarget: vendor,
      },
    ]),
    {
      intent: 'gtm-channels',
      sectionKey: 'gtm-motion',
      subtopic: 'smb-software-buying',
      query: `UK SMB software buying journey collaboration software site:gov.uk OR site:oecd.org OR filetype:pdf`,
      sourcePreference: 'primary',
      claimType: 'gtm-channel',
      evidenceMode: 'independent-validation',
      vendorTarget: null,
    },
    {
      intent: 'buyer-pain',
      sectionKey: 'risks-and-unknowns',
      subtopic: 'adoption-barriers',
      query: `UK SME AI adoption barriers trust integration skills site:gov.uk OR site:oecd.org OR report`,
      sourcePreference: 'primary',
      claimType: 'risk',
      evidenceMode: 'independent-validation',
      vendorTarget: null,
    },
  ];
}

function normalizePlan(plan: ResearchPlan, topic: string): ResearchPlan {
  const mergedQueries = withUniqueQueries([...plan.searchQueries, ...buildFallbackQueries(topic)]).slice(0, 14);

  return {
    ...plan,
    searchQueries: mergedQueries,
  };
}

export async function runPlanNode(state: ResearchGraphState) {
  console.info(`[research:${state.runId}] stage_start`, { stage: 'plan' });

  if (await hasStageCompleted(state.runId, 'plan') && state.plan) {
    console.info(`[research:${state.runId}] stage_skip`, { stage: 'plan' });
    return {
      status: state.status,
      currentStage: state.currentStage,
      plan: state.plan,
    };
  }

  await setRunStage(state.runId, 'planning', 'plan');
  await appendResearchEvent(state.runId, 'plan', 'stage_started', 'Drafting research plan.');

  const linkedDocNames = state.linkedDocuments
    .map((document) => document.fileName ?? document.documentExternalId)
    .join(', ');

  const plan = await generateStructuredOutput<ResearchPlan>({
    schema: researchPlanSchema,
    system:
      'You are a GTM research planner. Return concise research questions, four report sections, and decomposed search queries with explicit section, claim type, evidence mode, and vendor targets when relevant.',
    prompt: [
      `Topic: ${state.topic}`,
      `Objective: ${state.objective ?? 'Not provided.'}`,
      `Linked documents: ${linkedDocNames || 'None.'}`,
      'Return exactly 4 report sections. Use section keys from the existing GTM workflow where possible.',
      'Return 8-12 decomposed search queries across these intents:',
      '- market-size',
      '- adoption',
      '- competitor-features',
      '- pricing',
      '- buyer-pain',
      '- gtm-channels',
      'Each query object must include:',
      '- sectionKey',
      '- subtopic',
      '- claimType',
      '- evidenceMode',
      '- vendorTarget (null unless competitor or pricing evidence is vendor-targeted)',
      'For sourcePreference, use:',
      '- primary for government, public-sector, academic, standards, or PDF/report sources',
      '- mixed for analyst or trade coverage',
      '- commercial for vendor pricing, competitor pages, or comparison pages',
      'Evidence mode rules:',
      '- market-adjacent for broad AI/SME market evidence',
      '- product-specific for independent evidence directly about meeting assistants, conversation intelligence, or meeting-note products',
      '- vendor-primary for vendor product or pricing pages',
      '- independent-validation for independent buyer, workflow, channel, or product validation evidence',
      'Query-writing rules:',
      '- market-landscape should have at least 2 queries: one broad market/adoption query and one product-category query',
      '- icp-and-buyer should have at least 2 queries: one adoption query and one workflow pain query',
      '- competitor-landscape should include vendor-targeted queries for likely competitors',
      '- pricing-and-packaging should include vendor-targeted pricing queries for likely competitors',
      '- gtm-motion should target software buying behavior and channel preference',
      '- risks-and-unknowns should target trust, integration, skills, or adoption barriers',
      '- market-size and adoption queries should explicitly target primary evidence with terms like site:gov.uk, site:ons.gov.uk, site:oecd.org, filetype:pdf, report, survey, or statistics',
      '- competitor-features and pricing queries should name likely vendors and prefer official vendor domains or pricing pages',
      '- buyer-pain and gtm-channels queries should target sales-team workflow pain, software buying behavior, and channel strategy',
      '- queries must be specific, evidence-oriented, and optimized for March 10, 2026 context',
    ].join('\n'),
  });
  const normalizedPlan = normalizePlan(plan, state.topic);

  await saveRunPlan(state.runId, normalizedPlan);
  await appendResearchEvent(state.runId, 'plan', 'stage_completed', 'Research plan saved.', {
    searchQueryCount: normalizedPlan.searchQueries.length,
    sectionCount: normalizedPlan.sections.length,
    intents: normalizedPlan.searchQueries.map((query) => query.intent),
  });
  console.info(`[research:${state.runId}] stage_complete`, { stage: 'plan' });

  return {
    status: 'planning' as const,
    currentStage: 'plan',
    plan: normalizedPlan,
  };
}

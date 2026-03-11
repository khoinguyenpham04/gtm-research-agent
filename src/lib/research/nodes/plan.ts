import { generateStructuredOutput } from '@/lib/research/ai';
import {
  appendResearchEvent,
  hasStageCompleted,
  saveRunPlan,
  setRunStage,
} from '@/lib/research/repository';
import {
  researchPlanOutputSchema,
  type PlannedSearchQuery,
  type ResearchGraphState,
  type ResearchPlan,
  type ResearchPlanOutput,
} from '@/lib/research/schemas';
import { resolvePlannedSearchQuery } from '@/lib/research/section-routing';
import { deriveTopicSearchPhrase } from '@/lib/research/topic-utils';

interface CoverageBucket {
  key: string;
  matches: (query: PlannedSearchQuery) => boolean;
}

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

function getQueryKey(query: PlannedSearchQuery) {
  return `${query.sectionKey}:${query.query.toLowerCase()}`;
}

function uniqueVendorTargets(queries: PlannedSearchQuery[]) {
  const seen = new Set<string>();
  const vendors: string[] = [];

  for (const query of queries) {
    if (!query.vendorTarget) {
      continue;
    }

    const key = query.vendorTarget.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    vendors.push(query.vendorTarget);
  }

  return vendors;
}

function withUkContext(topic: string) {
  return /\buk\b|united kingdom|britain|british/i.test(topic) ? topic : `${topic} UK`;
}

function joinTerms(...parts: Array<string | null | undefined>) {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function deriveAudienceTerms(topic: string) {
  const normalized = topic.toLowerCase();
  const terms: string[] = [];

  if (/(household|homeowner|owner-occupied|residential|domestic|consumer|home\b)/.test(normalized)) {
    terms.push('household', 'homeowner', 'consumer');
  }

  if (/\b(smb|sme|small business|small and medium)/.test(normalized)) {
    terms.push('SMB', 'SME', '"small business"');
  }

  if (/(sales|sales team|revenue team|sales ops|account executive)/.test(normalized)) {
    terms.push('"sales team"', '"revenue team"', 'buyer');
  }

  return [...new Set(terms)].join(' ') || 'buyer';
}

function deriveBuyerBarrierTerms(topic: string) {
  const normalized = topic.toLowerCase();
  const terms = ['barriers', 'friction', 'trust', 'cost'];

  if (/(battery|solar|energy|storage|utility|tariff|grid)/.test(normalized)) {
    terms.push('installation', 'financing', 'approval', 'payback');
  } else if (/(software|saas|platform|crm|ai|assistant|automation)/.test(normalized)) {
    terms.push('integration', 'security', 'workflow', 'approval');
  } else {
    terms.push('integration', 'approval', 'reliability', 'adoption');
  }

  return [...new Set(terms)].join(' ');
}

function buildFallbackQueries(topic: string, plannedQueries: PlannedSearchQuery[]): PlannedSearchQuery[] {
  const topicSearchPhrase = deriveTopicSearchPhrase(topic);
  const topicWithRegion = withUkContext(topicSearchPhrase);
  const vendorTargets = uniqueVendorTargets(plannedQueries).slice(0, 4);
  const audienceTerms = deriveAudienceTerms(topic);
  const buyerBarrierTerms = deriveBuyerBarrierTerms(topic);

  return [
    {
      intent: 'market-size',
      sectionKey: 'market-landscape',
      subtopic: 'uk-market-growth',
      query: `${topicWithRegion} market size and growth site:gov.uk OR site:oecd.org OR filetype:pdf OR report`,
      sourcePreference: 'primary',
      claimType: 'market-sizing',
      evidenceMode: 'market-adjacent',
      vendorTarget: null,
    },
    {
      intent: 'market-size',
      sectionKey: 'market-landscape',
      subtopic: 'product-category-demand',
      query: `${topicWithRegion} market report forecast demand filetype:pdf OR analyst OR industry report`,
      sourcePreference: 'mixed',
      claimType: 'market-sizing',
      evidenceMode: 'product-specific',
      vendorTarget: null,
    },
    {
      intent: 'adoption',
      sectionKey: 'icp-and-buyer',
      subtopic: 'target-adoption-readiness',
      query: `${joinTerms(topicWithRegion, audienceTerms, 'adoption demand readiness survey')} site:gov.uk OR site:ons.gov.uk OR site:oecd.org OR filetype:pdf`,
      sourcePreference: 'primary',
      claimType: 'adoption-signal',
      evidenceMode: 'market-adjacent',
      vendorTarget: null,
    },
    {
      intent: 'buyer-pain',
      sectionKey: 'icp-and-buyer',
      subtopic: 'buyer-barriers-and-pain',
      query: `${joinTerms(topicWithRegion, 'buyer pain', buyerBarrierTerms, 'survey report')}`,
      sourcePreference: 'mixed',
      claimType: 'buyer-pain',
      evidenceMode: 'independent-validation',
      vendorTarget: null,
    },
    ...vendorTargets.flatMap((vendor) => [
      {
        intent: 'competitor-features' as const,
        sectionKey: 'competitor-landscape' as const,
        subtopic: `${vendor.toLowerCase()}-features`,
        query: `${joinTerms(vendor, topicSearchPhrase, 'features specifications official')}`,
        sourcePreference: 'commercial' as const,
        claimType: 'competitor-feature' as const,
        evidenceMode: 'vendor-primary' as const,
        vendorTarget: vendor,
      },
      {
        intent: 'pricing' as const,
        sectionKey: 'pricing-and-packaging' as const,
        subtopic: `${vendor.toLowerCase()}-pricing`,
        query: `${joinTerms(vendor, topicSearchPhrase, 'pricing plans finance official UK')}`,
        sourcePreference: 'commercial' as const,
        claimType: 'pricing' as const,
        evidenceMode: 'vendor-primary' as const,
        vendorTarget: vendor,
      },
    ]),
    {
      intent: 'gtm-channels',
      sectionKey: 'gtm-motion',
      subtopic: 'buying-process',
      query: `${joinTerms(topicWithRegion, 'buyer journey shortlist evaluation purchase process survey report')}`,
      sourcePreference: 'primary',
      claimType: 'gtm-channel',
      evidenceMode: 'independent-validation',
      vendorTarget: null,
    },
    {
      intent: 'gtm-channels',
      sectionKey: 'gtm-motion',
      subtopic: 'channel-preference',
      query: `${joinTerms(topicWithRegion, 'buying channels direct marketplace installer dealer survey report')}`,
      sourcePreference: 'mixed',
      claimType: 'gtm-channel',
      evidenceMode: 'independent-validation',
      vendorTarget: null,
    },
    {
      intent: 'gtm-channels',
      sectionKey: 'gtm-motion',
      subtopic: 'partner-msp-direct',
      query: `${joinTerms(topicWithRegion, 'partner installer reseller dealer direct purchase survey report')}`,
      sourcePreference: 'mixed',
      claimType: 'gtm-channel',
      evidenceMode: 'independent-validation',
      vendorTarget: null,
    },
    {
      intent: 'gtm-channels',
      sectionKey: 'gtm-motion',
      subtopic: 'purchase-friction',
      query: `${joinTerms(topicWithRegion, 'purchase barriers', buyerBarrierTerms, 'survey report')}`,
      sourcePreference: 'primary',
      claimType: 'gtm-channel',
      evidenceMode: 'independent-validation',
      vendorTarget: null,
    },
    {
      intent: 'buyer-pain',
      sectionKey: 'risks-and-unknowns',
      subtopic: 'adoption-barriers',
      query: `${joinTerms(topicWithRegion, 'adoption barriers', buyerBarrierTerms, 'compliance privacy skills')} site:gov.uk OR site:oecd.org OR report`,
      sourcePreference: 'primary',
      claimType: 'risk',
      evidenceMode: 'independent-validation',
      vendorTarget: null,
    },
  ];
}

const requiredCoverageBuckets: CoverageBucket[] = [
  {
    key: 'market-adjacent',
    matches: (query) =>
      query.sectionKey === 'market-landscape' &&
      query.intent === 'market-size' &&
      query.evidenceMode === 'market-adjacent',
  },
  {
    key: 'market-product',
    matches: (query) =>
      query.sectionKey === 'market-landscape' &&
      query.intent === 'market-size' &&
      query.evidenceMode === 'product-specific',
  },
  {
    key: 'icp-adoption',
    matches: (query) =>
      query.sectionKey === 'icp-and-buyer' &&
      query.intent === 'adoption',
  },
  {
    key: 'icp-buyer-pain',
    matches: (query) =>
      query.sectionKey === 'icp-and-buyer' &&
      query.intent === 'buyer-pain',
  },
  {
    key: 'competitor-vendor-1',
    matches: (query) =>
      query.sectionKey === 'competitor-landscape' &&
      query.intent === 'competitor-features' &&
      Boolean(query.vendorTarget),
  },
  {
    key: 'competitor-vendor-2',
    matches: (query) =>
      query.sectionKey === 'competitor-landscape' &&
      query.intent === 'competitor-features' &&
      Boolean(query.vendorTarget),
  },
  {
    key: 'pricing-vendor-1',
    matches: (query) =>
      query.sectionKey === 'pricing-and-packaging' &&
      query.intent === 'pricing' &&
      Boolean(query.vendorTarget),
  },
  {
    key: 'pricing-vendor-2',
    matches: (query) =>
      query.sectionKey === 'pricing-and-packaging' &&
      query.intent === 'pricing' &&
      Boolean(query.vendorTarget),
  },
  {
    key: 'gtm-buying-process',
    matches: (query) =>
      query.sectionKey === 'gtm-motion' && query.subtopic === 'buying-process',
  },
  {
    key: 'gtm-channel-preference',
    matches: (query) =>
      query.sectionKey === 'gtm-motion' && query.subtopic === 'channel-preference',
  },
  {
    key: 'gtm-partner-msp-direct',
    matches: (query) =>
      query.sectionKey === 'gtm-motion' && query.subtopic === 'partner-msp-direct',
  },
  {
    key: 'gtm-purchase-friction',
    matches: (query) =>
      query.sectionKey === 'gtm-motion' && query.subtopic === 'purchase-friction',
  },
  {
    key: 'risk-barriers',
    matches: (query) =>
      query.sectionKey === 'risks-and-unknowns' &&
      query.claimType === 'risk',
  },
];

function takeNextMatchingQuery(
  target: PlannedSearchQuery[],
  selectedKeys: Set<string>,
  queries: PlannedSearchQuery[],
  bucket: CoverageBucket,
) {
  const match = queries.find((query) => {
    const key = getQueryKey(query);
    return !selectedKeys.has(key) && bucket.matches(query);
  });

  if (!match) {
    return;
  }

  selectedKeys.add(getQueryKey(match));
  target.push(match);
}

function normalizePlan(plan: ResearchPlan, topic: string): ResearchPlan {
  const plannedQueries = withUniqueQueries(plan.searchQueries.map(resolvePlannedSearchQuery));
  const fallbackQueries = withUniqueQueries(
    buildFallbackQueries(topic, plannedQueries).map(resolvePlannedSearchQuery),
  );
  const mergedQueries = withUniqueQueries([...plannedQueries, ...fallbackQueries]);
  const selectedQueries: PlannedSearchQuery[] = [];
  const selectedKeys = new Set<string>();

  for (const bucket of requiredCoverageBuckets) {
    takeNextMatchingQuery(selectedQueries, selectedKeys, plannedQueries, bucket);
    if (selectedQueries.length >= 18) {
      break;
    }
    takeNextMatchingQuery(selectedQueries, selectedKeys, fallbackQueries, bucket);
    if (selectedQueries.length >= 18) {
      break;
    }
  }

  for (const query of mergedQueries) {
    if (selectedQueries.length >= 18) {
      break;
    }

    const key = getQueryKey(query);
    if (selectedKeys.has(key)) {
      continue;
    }

    selectedKeys.add(key);
    selectedQueries.push(query);
  }

  return {
    ...plan,
    searchQueries: selectedQueries,
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

  const plan = await generateStructuredOutput<ResearchPlanOutput>({
    schema: researchPlanOutputSchema,
    system:
      'You are a GTM research planner. Return concise research questions, four report sections, and decomposed search queries with explicit section, claim type, evidence mode, and vendor targets when relevant.',
    prompt: [
      `Topic: ${state.topic}`,
      `Objective: ${state.objective ?? 'Not provided.'}`,
      `Linked documents: ${linkedDocNames || 'None.'}`,
      'Return exactly 4 report sections. Use section keys from the existing GTM workflow where possible.',
      'Return 10-16 decomposed search queries across these intents:',
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
      '- market-adjacent for broad category, buyer-segment, regulatory, or adoption evidence adjacent to the target offer',
      '- product-specific for independent evidence directly about the product category or solution class named in the topic',
      '- vendor-primary for vendor product or pricing pages',
      '- independent-validation for independent buyer, workflow, channel, or product validation evidence',
      'Query-writing rules:',
      '- market-landscape should have at least 2 queries: one broad market/adoption query and one product-category query',
      '- icp-and-buyer should have at least 2 queries: one adoption query and one workflow pain query',
      '- competitor-landscape should include vendor-targeted queries for likely competitors in the topic category',
      '- pricing-and-packaging should include vendor-targeted pricing queries for likely competitors in the topic category',
      '- gtm-motion should target buying process, channel preference (direct, partner, installer, retailer, marketplace, or other), and purchase friction',
      '- risks-and-unknowns should target trust, integration, skills, or adoption barriers',
      '- market-size and adoption queries should explicitly target primary evidence with terms like site:gov.uk, site:ons.gov.uk, site:oecd.org, filetype:pdf, report, survey, or statistics',
      '- competitor-features and pricing queries should name likely vendors and prefer official vendor domains or pricing pages',
      '- buyer-pain and gtm-channels queries should target topic-relevant workflow pain, purchase drivers, channel behavior, and deployment friction',
      '- gtm-motion should include at least one query each for buying process, channel evidence, partner or direct preference, and purchase-friction evidence',
      '- do not assume AI meeting assistants, CRM, sales teams, or software buyers unless they are explicitly part of the topic or objective',
      '- queries must be specific, evidence-oriented, and optimized for March 10, 2026 context',
    ].join('\n'),
  });
  const normalizedPlan = normalizePlan(plan as ResearchPlan, state.topic);

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

import { generateStructuredOutput } from '@/lib/research/ai';
import {
  appendResearchEvent,
  hasStageCompleted,
  saveRunPlan,
  setRunStage,
} from '@/lib/research/repository';
import { researchPlanSchema, type ResearchGraphState, type ResearchPlan } from '@/lib/research/schemas';

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
      'You are a GTM research planner. Return concise research questions, four report sections, and six intent-specific search queries that prioritize primary evidence.',
    prompt: [
      `Topic: ${state.topic}`,
      `Objective: ${state.objective ?? 'Not provided.'}`,
      `Linked documents: ${linkedDocNames || 'None.'}`,
      'Return exactly 4 report sections. Use section keys from the existing GTM workflow where possible.',
      'Return exactly 6 search queries, one per intent in this exact set:',
      '- market-size',
      '- adoption',
      '- competitor-features',
      '- pricing',
      '- buyer-pain',
      '- gtm-channels',
      'For sourcePreference, use:',
      '- primary for government, public-sector, academic, standards, or PDF/report sources',
      '- mixed for analyst or trade coverage',
      '- commercial for vendor pricing, competitor pages, or comparison pages',
      'Query-writing rules:',
      '- market-size and adoption queries should explicitly target primary evidence with terms like site:gov.uk, site:ons.gov.uk, site:oecd.org, filetype:pdf, report, survey, or statistics',
      '- competitor-features and pricing queries should name likely vendors or comparison intent',
      '- buyer-pain and gtm-channels queries should target sales-team workflow pain, software buying behavior, and channel strategy',
      '- queries must be specific, evidence-oriented, and optimized for March 10, 2026 context',
    ].join('\n'),
  });

  await saveRunPlan(state.runId, plan);
  await appendResearchEvent(state.runId, 'plan', 'stage_completed', 'Research plan saved.', {
    searchQueryCount: plan.searchQueries.length,
    sectionCount: plan.sections.length,
    intents: plan.searchQueries.map((query) => query.intent),
  });
  console.info(`[research:${state.runId}] stage_complete`, { stage: 'plan' });

  return {
    status: 'planning' as const,
    currentStage: 'plan',
    plan,
  };
}

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
      'You are a GTM research planner. Return concise, concrete research questions, section plans, and web-search queries.',
    prompt: [
      `Topic: ${state.topic}`,
      `Objective: ${state.objective ?? 'Not provided.'}`,
      `Linked documents: ${linkedDocNames || 'None.'}`,
      'Return exactly 4 report sections. Prefer section keys like market-landscape or buyer-profile.',
      'Search queries must be specific and evidence-oriented.',
    ].join('\n'),
  });

  await saveRunPlan(state.runId, plan);
  await appendResearchEvent(state.runId, 'plan', 'stage_completed', 'Research plan saved.', {
    searchQueryCount: plan.searchQueries.length,
    sectionCount: plan.sections.length,
  });
  console.info(`[research:${state.runId}] stage_complete`, { stage: 'plan' });

  return {
    status: 'planning' as const,
    currentStage: 'plan',
    plan,
  };
}

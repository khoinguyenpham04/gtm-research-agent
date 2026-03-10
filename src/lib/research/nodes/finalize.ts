import {
  appendResearchEvent,
  finalizeRun,
  hasStageCompleted,
} from '@/lib/research/repository';
import type { ResearchGraphState } from '@/lib/research/schemas';

export async function runFinalizeNode(state: ResearchGraphState) {
  console.info(`[research:${state.runId}] stage_start`, { stage: 'finalize' });

  if (await hasStageCompleted(state.runId, 'finalize')) {
    return {
      status: 'completed' as const,
      currentStage: 'finalize',
      finalReportMarkdown: state.finalReportMarkdown,
    };
  }

  if (!state.finalReportMarkdown) {
    throw new Error('Cannot finalize a run without a report draft.');
  }

  await finalizeRun(state.runId, state.finalReportMarkdown);
  await appendResearchEvent(state.runId, 'finalize', 'stage_completed', 'Research run completed.', {
    reportReady: true,
  });
  console.info(`[research:${state.runId}] stage_complete`, { stage: 'finalize' });

  return {
    status: 'completed' as const,
    currentStage: 'finalize',
    finalReportMarkdown: state.finalReportMarkdown,
  };
}

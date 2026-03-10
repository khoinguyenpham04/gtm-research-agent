import {
  appendResearchEvent,
  failRun,
  getResearchRun,
  getResearchRunSnapshot,
  setRunStage,
} from '@/lib/research/repository';
import { buildInitialGraphState, createResearchGraph } from '@/lib/research/graph';
import { TavilySearchService } from '@/lib/research/search';
import { researchStageValues, type ResearchStage } from '@/lib/research/schemas';

function isResearchStage(value: string): value is ResearchStage {
  return (researchStageValues as readonly string[]).includes(value);
}

function normalizeStage(value: string) {
  return value === 'mock_document_retrieval' ? 'document_retrieval' : value;
}

export async function executeResearchRun(runId: string) {
  try {
    const run = await getResearchRun(runId);

    if (run.status === 'completed') {
      return getResearchRunSnapshot(runId);
    }

    console.info(`[research:${runId}] execution_requested`, {
      status: run.status,
      currentStage: run.currentStage,
    });

    if (run.status === 'queued') {
      await setRunStage(runId, 'planning', 'plan');
      await appendResearchEvent(runId, 'plan', 'run_started', 'Research run started.', {
        status: 'planning',
      });
    }

    console.info(`[research:${runId}] building_initial_state`);
    const initialState = await buildInitialGraphState(runId, {
      topic: run.topic,
      objective: run.objective,
      status: run.status === 'queued' ? 'planning' : run.status,
      currentStage: normalizeStage(run.currentStage === 'plan' ? 'plan' : run.currentStage),
      planJson: run.planJson,
      finalReportMarkdown: run.finalReportMarkdown,
    });

    console.info(`[research:${runId}] compiling_graph`);
    const graph = createResearchGraph(new TavilySearchService());

    await graph.invoke(initialState);
    console.info(`[research:${runId}] execution_completed`);
    return getResearchRunSnapshot(runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown research run failure.';
    const latestRun = await getResearchRun(runId);
    const normalizedStage = normalizeStage(latestRun.currentStage);
    const failedStage = isResearchStage(normalizedStage) ? normalizedStage : 'finalize';
    console.error(`[research:${runId}] execution_failed`, {
      failedStage,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    await failRun(runId, normalizedStage, message);
    await appendResearchEvent(runId, failedStage, 'stage_failed', message, {
      failedStage,
    });
    throw error;
  }
}

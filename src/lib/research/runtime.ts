import {
  appendResearchEvent,
  failRun,
  getResearchRun,
  getResearchRunSnapshot,
  releaseResearchRunExecution,
  tryClaimResearchRunExecution,
  updateRunExecutionState,
} from '@/lib/research/repository';
import { createResearchGraphV2, buildInitialGraphStateV2 } from '@/lib/research/v2/graph';
import { createResearchGraphV3, buildInitialGraphStateV3 } from '@/lib/research/v3/graph';
import { createSearchService } from '@/lib/research/search';
import { researchStageValues, type ResearchStage } from '@/lib/research/schemas';

function isResearchStage(value: string): value is ResearchStage {
  return (researchStageValues as readonly string[]).includes(value);
}

function normalizeStage(value: string) {
  return value === 'mock_document_retrieval' ? 'document_retrieval' : value;
}

async function buildInitialState(
  engineVersion: 'v2' | 'v3',
  runId: string,
  options?: { clarificationResponse?: string | null },
) {
  if (engineVersion === 'v3') {
    return buildInitialGraphStateV3(runId, options);
  }

  return buildInitialGraphStateV2(runId, options);
}

function createGraph(engineVersion: 'v2' | 'v3') {
  const searchService = createSearchService();
  return engineVersion === 'v3'
    ? createResearchGraphV3(searchService)
    : createResearchGraphV2(searchService);
}

export async function executeResearchRun(runId: string, options?: { clarificationResponse?: string | null }) {
  const executionToken = crypto.randomUUID();

  try {
    const run = await getResearchRun(runId);

    if (run.status === 'completed') {
      return getResearchRunSnapshot(runId);
    }

    const claimed = await tryClaimResearchRunExecution(runId, executionToken);
    if (!claimed) {
      console.info(`[research:${runId}] execution_skipped_locked`);
      return getResearchRunSnapshot(runId);
    }

    console.info(`[research:${runId}] execution_requested`, {
      status: run.status,
      currentStage: run.currentStage,
    });

    if (run.status === 'queued') {
      const engineVersion = run.engineVersion === 'v2' ? 'v2' : 'v3';
      await updateRunExecutionState(runId, {
        status: 'planning',
        currentStage: 'plan',
        internalStage: 'hydrate_run',
        engineVersion,
      });
      await appendResearchEvent(runId, 'plan', 'run_started', 'Research run started.', {
        status: 'planning',
        internalStage: 'hydrate_run',
      });
    }

    console.info(`[research:${runId}] building_initial_state`);
    const engineVersion = run.engineVersion === 'v2' ? 'v2' : 'v3';
    const initialState = await buildInitialState(engineVersion, runId, {
      clarificationResponse: options?.clarificationResponse ?? null,
    });

    console.info(`[research:${runId}] compiling_graph`);
    const graph = createGraph(engineVersion);

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
  } finally {
    try {
      await releaseResearchRunExecution(runId, executionToken);
    } catch (releaseError) {
      console.warn(`[research:${runId}] execution_release_failed`, {
        message: releaseError instanceof Error ? releaseError.message : 'Unknown release error.',
      });
    }
  }
}

import { Command } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";

import { getDeepResearchCheckpointer } from "@/lib/deep-research/checkpointer";
import {
  getDeepResearchRuntimeConfig,
} from "@/lib/deep-research/config";
import { ensureDeepResearchDatabase } from "@/lib/deep-research/db";
import { createDeepResearchGraphs } from "@/lib/deep-research/graph";
import {
  OpenAIDeepResearchModelFactory,
} from "@/lib/deep-research/openai-model-factory";
import {
  appendDeepResearchRunEvent,
  createDeepResearchRunRecord,
  getDeepResearchRunEvidenceResponse,
  getDeepResearchRunRecord,
  getDeepResearchRunResponse,
  listDeepResearchRunSummaries,
  markDeepResearchRunStatus,
  persistDeepResearchRunArtifacts,
  updateDeepResearchRun,
} from "@/lib/deep-research/repository";
import type {
  CreateDeepResearchRunRequest,
  DeepResearchRunEvidenceResponse,
  DeepResearchRunResponse,
  DeepResearchRunSummary,
  EvidenceResolution,
  EvidenceRow,
  ReportPlan,
  SectionEvidenceLink,
  SectionValidation,
} from "@/lib/deep-research/types";

const runtimePromises = new Map<
  string,
  Promise<ReturnType<typeof createDeepResearchGraphs>>
>();

function buildInitialUserMessage(topic: string, objective?: string | null) {
  if (!objective) {
    return topic;
  }

  return `Topic: ${topic}\n\nObjective: ${objective}`;
}

async function getRuntime(runId: string, selectedDocumentIds: string[]) {
  const cacheKey = runId;
  const existing = runtimePromises.get(cacheKey);
  if (existing) {
    return existing;
  }

  const runtimePromise = (async () => {
      await ensureDeepResearchDatabase();
      const runtimeConfig = getDeepResearchRuntimeConfig(
        runId,
        selectedDocumentIds,
      );
      const checkpointer = await getDeepResearchCheckpointer();

      return createDeepResearchGraphs({
        parentCheckpointer: checkpointer,
        models: new OpenAIDeepResearchModelFactory(
          runtimeConfig.modelConfig,
          runtimeConfig.openAiApiKey,
          {
            onRateLimitRetry: async (context) => {
              await appendDeepResearchRunEvent(runId, {
                stage: "throttled",
                eventType: "rate_limit_retry_scheduled",
                message: "OpenAI rate limit hit. Retrying with backoff.",
                payload: {
                  role: context.role,
                  attempt: context.attempt,
                  maxAttempts: context.maxAttempts,
                  delayMs: context.delayMs,
                  errorMessage: context.errorMessage,
                },
              });
              await updateDeepResearchRun(runId, {
                last_progress_at: new Date().toISOString(),
              });
            },
          },
        ),
        openAiApiKey: runtimeConfig.openAiApiKey,
        tavilyApiKey: runtimeConfig.tavilyApiKey,
        logEvent: async (eventRunId, stage, eventType, message, payload) => {
          await appendDeepResearchRunEvent(eventRunId, {
            stage,
            eventType,
            message,
            payload,
          });
          await updateDeepResearchRun(eventRunId, {
            last_progress_at: new Date().toISOString(),
          });
        },
      });
    })().catch((error) => {
      runtimePromises.delete(cacheKey);
      throw error;
    });

  runtimePromises.set(cacheKey, runtimePromise);
  return runtimePromise;
}

async function hasCheckpoint(
  graph: Awaited<ReturnType<typeof getRuntime>>["deepResearchGraph"],
  threadId: string,
) {
  try {
    const snapshot = await graph.getState({
      configurable: { thread_id: threadId },
    });
    return (
      Object.keys((snapshot.values ?? {}) as Record<string, unknown>).length > 0 ||
      snapshot.next.length > 0 ||
      snapshot.tasks.length > 0
    );
  } catch {
    return false;
  }
}

async function finalizeRunFromGraphState(
  runId: string,
  graph: Awaited<ReturnType<typeof getRuntime>>["deepResearchGraph"],
) {
  const snapshot = await graph.getState({
    configurable: { thread_id: runId },
  });

  const interrupt = snapshot.tasks
    .flatMap((task) => task.interrupts)
    .map((item) => item.value as Record<string, unknown> | undefined)
    .find((value) => value && value.type === "clarification");

  const values = (snapshot.values ?? {}) as {
    finalReportMarkdown?: string;
    reportPlan?: ReportPlan;
    sectionSupport?: SectionValidation[];
    evidenceRows?: EvidenceRow[];
    evidenceResolutions?: EvidenceResolution[];
    sectionEvidenceLinks?: SectionEvidenceLink[];
  };

  await persistDeepResearchRunArtifacts(runId, {
    reportPlan: values.reportPlan,
    sectionSupport: values.sectionSupport ?? [],
    evidenceRows: values.evidenceRows ?? [],
    evidenceResolutions: values.evidenceResolutions ?? [],
    sectionEvidenceLinks: values.sectionEvidenceLinks ?? [],
  });

  if (interrupt && typeof interrupt.question === "string") {
    await markDeepResearchRunStatus(runId, "needs_clarification", {
      clarification_question: interrupt.question,
      error_message: null,
    });
    await appendDeepResearchRunEvent(runId, {
      stage: "clarify",
      eventType: "clarification_waiting",
      message: "Waiting for user clarification.",
      payload: { question: interrupt.question },
    });
    return;
  }

  if (typeof values.finalReportMarkdown === "string" && values.finalReportMarkdown) {
    await markDeepResearchRunStatus(runId, "completed", {
      clarification_question: null,
      final_report_markdown: values.finalReportMarkdown,
      error_message: null,
    });
    return;
  }

  await markDeepResearchRunStatus(runId, "failed", {
    error_message:
      "The deep research graph finished without a clarification request or final report.",
  });
}

export async function createDeepResearchRun(
  input: CreateDeepResearchRunRequest,
): Promise<DeepResearchRunResponse> {
  await ensureDeepResearchDatabase();
  const run = await createDeepResearchRunRecord(input);
  const response = await getDeepResearchRunResponse(run.id);
  if (!response) {
    throw new Error("Failed to load the deep research run after creation.");
  }

  return response;
}

export async function getDeepResearchRun(runId: string) {
  await ensureDeepResearchDatabase();
  return getDeepResearchRunResponse(runId);
}

export async function listDeepResearchRuns(options?: {
  workspaceId?: string;
  limit?: number;
}): Promise<DeepResearchRunSummary[]> {
  await ensureDeepResearchDatabase();
  return listDeepResearchRunSummaries(options);
}

export async function getDeepResearchRunEvidence(
  runId: string,
): Promise<DeepResearchRunEvidenceResponse | null> {
  await ensureDeepResearchDatabase();
  return getDeepResearchRunEvidenceResponse(runId);
}

export async function processDeepResearchRun(
  runId: string,
  options?: {
    clarificationResponse?: string;
    retry?: boolean;
  },
) {
  await ensureDeepResearchDatabase();
  const run = await getDeepResearchRunRecord(runId);
  if (!run) {
    throw new Error(`Deep research run ${runId} was not found.`);
  }

  const runResponse = await getDeepResearchRunResponse(runId);
  const selectedDocumentIds =
    runResponse?.selectedDocuments.map((document) => document.id) ?? [];
  const runtimeConfig = getDeepResearchRuntimeConfig(
    run.thread_id,
    selectedDocumentIds,
  );
  const runtime = await getRuntime(run.thread_id, selectedDocumentIds);

  await markDeepResearchRunStatus(runId, "running", {
    clarification_question: null,
    error_message: null,
  });
  await appendDeepResearchRunEvent(runId, {
    stage: "running",
    eventType: options?.clarificationResponse
      ? "run_resumed"
      : options?.retry
        ? "run_retried"
        : "run_started",
    message: options?.clarificationResponse
      ? "Deep research run resumed."
      : options?.retry
        ? "Deep research run retried."
        : "Deep research run started.",
  });

  try {
    const config = {
      configurable: {
        thread_id: runtimeConfig.threadId,
      },
      durability: "sync" as const,
    };

    if (options?.clarificationResponse) {
      await runtime.deepResearchGraph.invoke(
        new Command({ resume: options.clarificationResponse }),
        config,
      );
    } else if (options?.retry) {
      const checkpointExists = await hasCheckpoint(
        runtime.deepResearchGraph,
        runtimeConfig.threadId,
      );
      if (checkpointExists) {
        await runtime.deepResearchGraph.invoke(undefined as never, config);
      } else {
        await runtime.deepResearchGraph.invoke(
          {
            runId: run.id,
            topic: run.topic,
            objective: run.objective ?? undefined,
            selectedDocumentIds,
            modelConfig: runtimeConfig.modelConfig,
            budgets: runtimeConfig.budgets,
            messages: [
              new HumanMessage({
                content: buildInitialUserMessage(run.topic, run.objective),
              }),
            ],
          },
          config,
        );
      }
    } else {
      await runtime.deepResearchGraph.invoke(
        {
          runId: run.id,
          topic: run.topic,
          objective: run.objective ?? undefined,
          selectedDocumentIds,
          modelConfig: runtimeConfig.modelConfig,
          budgets: runtimeConfig.budgets,
          messages: [
            new HumanMessage({
              content: buildInitialUserMessage(run.topic, run.objective),
            }),
          ],
        },
        config,
      );
    }

    await finalizeRunFromGraphState(runId, runtime.deepResearchGraph);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown deep research failure.";
    const status = /timeout|max duration|aborted/i.test(message)
      ? "timed_out"
      : "failed";

    await markDeepResearchRunStatus(runId, status, {
      error_message: message,
    });
    await appendDeepResearchRunEvent(runId, {
      stage: status,
      eventType: "run_failed",
      message,
    });
    throw error;
  }
}

import type { DocumentSummary } from "@/lib/documents";
import { listDocumentsByIds } from "@/lib/documents";
import type {
  CreateDeepResearchRunRequest,
  DeepResearchRunEvent,
  DeepResearchRunRecord,
  DeepResearchRunResponse,
  DeepResearchRunStatus,
} from "@/lib/deep-research/types";
import { createSupabaseClients } from "@/lib/supabase";

type RunUpdate = Partial<
  Pick<
    DeepResearchRunRecord,
    | "status"
    | "clarification_question"
    | "final_report_markdown"
    | "error_message"
    | "last_progress_at"
  >
> & { updated_at?: string };

interface DeepResearchRunEventRow {
  id: string;
  run_id: string;
  stage: string;
  event_type: string;
  message: string;
  payload_json: Record<string, unknown>;
  created_at: string;
}

interface DeepResearchRunDocumentRow {
  document_external_id: string;
  file_name: string | null;
}

function mapEvent(row: DeepResearchRunEventRow): DeepResearchRunEvent {
  return {
    id: row.id,
    runId: row.run_id,
    stage: row.stage,
    eventType: row.event_type,
    message: row.message,
    payload: row.payload_json ?? {},
    createdAt: row.created_at,
  };
}

function mapRunResponse(
  run: DeepResearchRunRecord,
  selectedDocuments: DocumentSummary[],
  events: DeepResearchRunEvent[],
): DeepResearchRunResponse {
  return {
    id: run.id,
    status: run.status,
    topic: run.topic,
    objective: run.objective ?? undefined,
    clarificationQuestion: run.clarification_question ?? undefined,
    selectedDocuments,
    events,
    finalReportMarkdown: run.final_report_markdown ?? undefined,
    errorMessage: run.error_message ?? undefined,
    updatedAt: run.updated_at,
    createdAt: run.created_at,
  };
}

async function getRunDocuments(runId: string): Promise<DocumentSummary[]> {
  const { supabaseAdmin } = createSupabaseClients();
  const { data, error } = await supabaseAdmin
    .from("deep_research_run_documents")
    .select("document_external_id, file_name")
    .eq("run_id", runId);

  if (error) {
    throw new Error(error.message);
  }

  const documentRows = (data ?? []) as DeepResearchRunDocumentRow[];
  const ids = documentRows.map((row) => row.document_external_id);
  const documents = await listDocumentsByIds(ids);
  const byId = new Map(documents.map((document) => [document.id, document]));

  return documentRows.map((row) => {
    const matched = byId.get(row.document_external_id);
    return (
      matched ?? {
        id: row.document_external_id,
        file_name: row.file_name ?? row.document_external_id,
        file_type: "unknown",
        file_size: 0,
        upload_date: "",
        total_chunks: 0,
      }
    );
  });
}

async function getRunEvents(runId: string) {
  const { supabaseAdmin } = createSupabaseClients();
  const { data, error } = await supabaseAdmin
    .from("deep_research_run_events")
    .select("id, run_id, stage, event_type, message, payload_json, created_at")
    .eq("run_id", runId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as DeepResearchRunEventRow[]).map(mapEvent);
}

export async function createDeepResearchRunRecord(
  input: CreateDeepResearchRunRequest,
) {
  const { supabaseAdmin } = createSupabaseClients();
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("deep_research_runs")
    .insert({
      id,
      thread_id: id,
      topic: input.topic,
      objective: input.objective ?? null,
      status: "queued",
      updated_at: timestamp,
      last_progress_at: timestamp,
    })
    .select(
      "id, thread_id, topic, objective, status, clarification_question, final_report_markdown, error_message, created_at, updated_at, last_progress_at",
    )
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const documents = await listDocumentsByIds(input.selectedDocumentIds);
  if (documents.length !== input.selectedDocumentIds.length) {
    throw new Error(
      "One or more selected documents could not be found. Refresh the document list and try again.",
    );
  }

  if (documents.length > 0) {
    const { error: documentInsertError } = await supabaseAdmin
      .from("deep_research_run_documents")
      .insert(
        documents.map((document) => ({
          run_id: id,
          document_external_id: document.id,
          file_name: document.file_name,
        })),
      );

    if (documentInsertError) {
      throw new Error(documentInsertError.message);
    }
  }

  await appendDeepResearchRunEvent(id, {
    stage: "queued",
    eventType: "run_created",
    message: "Deep research run queued.",
    payload: {
      selectedDocumentIds: input.selectedDocumentIds,
      objective: input.objective ?? null,
    },
  });

  return data as DeepResearchRunRecord;
}

export async function appendDeepResearchRunEvent(
  runId: string,
  event: {
    stage: string;
    eventType: string;
    message: string;
    payload?: Record<string, unknown>;
  },
) {
  const { supabaseAdmin } = createSupabaseClients();
  const { error } = await supabaseAdmin.from("deep_research_run_events").insert({
    run_id: runId,
    stage: event.stage,
    event_type: event.eventType,
    message: event.message,
    payload_json: event.payload ?? {},
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateDeepResearchRun(
  runId: string,
  update: RunUpdate,
) {
  const { supabaseAdmin } = createSupabaseClients();
  const { data, error } = await supabaseAdmin
    .from("deep_research_runs")
    .update({
      ...update,
      updated_at: update.updated_at ?? new Date().toISOString(),
    })
    .eq("id", runId)
    .select(
      "id, thread_id, topic, objective, status, clarification_question, final_report_markdown, error_message, created_at, updated_at, last_progress_at",
    )
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as DeepResearchRunRecord;
}

export async function getDeepResearchRunRecord(runId: string) {
  const { supabaseAdmin } = createSupabaseClients();
  const { data, error } = await supabaseAdmin
    .from("deep_research_runs")
    .select(
      "id, thread_id, topic, objective, status, clarification_question, final_report_markdown, error_message, created_at, updated_at, last_progress_at",
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return data as DeepResearchRunRecord;
}

export async function getDeepResearchRunResponse(runId: string) {
  const run = await getDeepResearchRunRecord(runId);
  if (!run) {
    return null;
  }

  const [selectedDocuments, events] = await Promise.all([
    getRunDocuments(runId),
    getRunEvents(runId),
  ]);

  return mapRunResponse(run, selectedDocuments, events);
}

export async function markDeepResearchRunStatus(
  runId: string,
  status: DeepResearchRunStatus,
  extras: Omit<RunUpdate, "status"> = {},
) {
  return updateDeepResearchRun(runId, {
    status,
    last_progress_at: new Date().toISOString(),
    ...extras,
  });
}

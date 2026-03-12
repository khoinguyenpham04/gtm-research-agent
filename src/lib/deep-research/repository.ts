import type { DocumentSummary } from "@/lib/documents";
import { listDocumentsByIds } from "@/lib/documents";
import type {
  CreateDeepResearchRunRequest,
  DeepResearchRunEvidenceResponse,
  DeepResearchRunEvent,
  DeepResearchRunRecord,
  DeepResearchRunResponse,
  DeepResearchRunSummary,
  DeepResearchRunStatus,
  EvidenceResolution,
  EvidenceRow,
  ReportPlan,
  SectionEvidenceLink,
  SectionValidation,
} from "@/lib/deep-research/types";
import { createSupabaseClients } from "@/lib/supabase";
import {
  assertWorkspaceDocumentSelection,
  type WorkspaceSummary,
  listWorkspaces,
} from "@/lib/workspaces";

type RunUpdate = Partial<
  Pick<
    DeepResearchRunRecord,
    | "status"
    | "clarification_question"
    | "final_report_markdown"
    | "error_message"
    | "last_progress_at"
    | "planner_type"
    | "report_plan_version"
    | "report_plan_json"
  >
> & { updated_at?: string };

const deepResearchRunSelect = `
  id,
  thread_id,
  workspace_id,
  planner_type,
  report_plan_version,
  report_plan_json,
  topic,
  objective,
  status,
  clarification_question,
  final_report_markdown,
  error_message,
  created_at,
  updated_at,
  last_progress_at
`;

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

interface DeepResearchRunEvidenceRowRecord {
  id: string;
  run_id: string;
  claim: string;
  claim_type: EvidenceRow["claimType"];
  value: string;
  unit: string | null;
  entity: string | null;
  segment: string | null;
  geography: string | null;
  timeframe: string | null;
  source_type: EvidenceRow["sourceType"];
  source_tier: EvidenceRow["sourceTier"];
  source_title: string | null;
  source_url: string | null;
  document_id: string | null;
  chunk_index: number | null;
  confidence: EvidenceRow["confidence"];
  conflict_group: string | null;
  allowed_for_final: boolean | null;
  resolution_id: string | null;
  metadata_json: Record<string, unknown> | null;
}

interface DeepResearchRunEvidenceResolutionRecord {
  id: string;
  run_id: string;
  conflict_group: string;
  winning_evidence_row_ids: string[];
  discarded_evidence_row_ids: string[];
  resolution_note: string;
  resolved_by: string;
  created_at: string;
}

interface DeepResearchRunSectionValidationRecord {
  section_key: string;
  support: SectionValidation["support"];
  reason: string | null;
  evidence_count: number | null;
  top_source_tier: SectionValidation["topSourceTier"] | null;
}

interface DeepResearchRunSectionEvidenceLinkRecord {
  section_key: string;
  evidence_row_id: string;
  role: SectionEvidenceLink["role"];
}

type CreateDeepResearchRunRecordResult = {
  created: boolean;
  run: DeepResearchRunRecord;
};

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

function mapEvidenceRow(
  row: DeepResearchRunEvidenceRowRecord,
): EvidenceRow {
  return {
    id: row.id,
    claim: row.claim,
    claimType: row.claim_type,
    value: row.value,
    unit: row.unit ?? undefined,
    entity: row.entity ?? undefined,
    segment: row.segment ?? undefined,
    geography: row.geography ?? undefined,
    timeframe: row.timeframe ?? undefined,
    sourceType: row.source_type,
    sourceTier: row.source_tier,
    sourceTitle: row.source_title ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    documentId: row.document_id ?? undefined,
    chunkIndex:
      typeof row.chunk_index === "number" ? row.chunk_index : undefined,
    confidence: row.confidence,
    conflictGroup: row.conflict_group ?? undefined,
    allowedForFinal:
      typeof row.allowed_for_final === "boolean"
        ? row.allowed_for_final
        : undefined,
    resolutionId: row.resolution_id ?? undefined,
    metadata: row.metadata_json ?? {},
  };
}

function mapEvidenceResolution(
  row: DeepResearchRunEvidenceResolutionRecord,
): EvidenceResolution {
  return {
    id: row.id,
    runId: row.run_id,
    conflictGroup: row.conflict_group,
    winningEvidenceRowIds: row.winning_evidence_row_ids,
    discardedEvidenceRowIds: row.discarded_evidence_row_ids,
    resolutionNote: row.resolution_note,
    resolvedBy: row.resolved_by,
    createdAt: row.created_at,
  };
}

function mapSectionValidation(
  row: DeepResearchRunSectionValidationRecord,
): SectionValidation {
  return {
    key: row.section_key,
    support: row.support,
    reason: row.reason ?? undefined,
    evidenceCount:
      typeof row.evidence_count === "number" ? row.evidence_count : undefined,
    topSourceTier: row.top_source_tier ?? undefined,
  };
}

function mapSectionEvidenceLink(
  row: DeepResearchRunSectionEvidenceLinkRecord,
): SectionEvidenceLink {
  return {
    sectionKey: row.section_key,
    evidenceRowId: row.evidence_row_id,
    role: row.role,
  };
}

function mapRunResponse(
  run: DeepResearchRunRecord,
  workspace: WorkspaceSummary | undefined,
  selectedDocuments: DocumentSummary[],
  events: DeepResearchRunEvent[],
): DeepResearchRunResponse {
  return {
    id: run.id,
    status: run.status,
    workspaceId: run.workspace_id ?? undefined,
    workspace,
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

function mapRunSummary(
  run: DeepResearchRunRecord,
  workspace: WorkspaceSummary | undefined,
): DeepResearchRunSummary {
  return {
    id: run.id,
    status: run.status,
    workspaceId: run.workspace_id ?? undefined,
    workspace,
    topic: run.topic,
    objective: run.objective ?? undefined,
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
): Promise<CreateDeepResearchRunRecordResult> {
  const { supabaseAdmin } = createSupabaseClients();
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const threadId = input.launchKey ?? id;

  if (input.launchKey) {
    const existingRun = await getDeepResearchRunRecordByThreadId(input.launchKey);
    if (existingRun) {
      return {
        created: false,
        run: existingRun,
      };
    }
  }

  const workspace = await assertWorkspaceDocumentSelection(
    input.workspaceId,
    input.selectedDocumentIds,
  );

  const { data, error } = await supabaseAdmin
    .from("deep_research_runs")
    .insert({
      id,
      thread_id: threadId,
      workspace_id: workspace.id,
      topic: input.topic,
      objective: input.objective ?? null,
      status: "queued",
      updated_at: timestamp,
      last_progress_at: timestamp,
    })
    .select(deepResearchRunSelect)
    .single();

  if (error) {
    if (
      input.launchKey &&
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "23505"
    ) {
      const existingRun = await getDeepResearchRunRecordByThreadId(input.launchKey);
      if (existingRun) {
        return {
          created: false,
          run: existingRun,
        };
      }
    }

    throw new Error(error.message);
  }

  const documents = await listDocumentsByIds(input.selectedDocumentIds);

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
      workspaceId: workspace.id,
      selectedDocumentIds: input.selectedDocumentIds,
      objective: input.objective ?? null,
    },
  });

  return {
    created: true,
    run: data as DeepResearchRunRecord,
  };
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
    .select(deepResearchRunSelect)
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
    .select(deepResearchRunSelect)
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

export async function getDeepResearchRunRecordByThreadId(threadId: string) {
  const { supabaseAdmin } = createSupabaseClients();
  const { data, error } = await supabaseAdmin
    .from("deep_research_runs")
    .select(deepResearchRunSelect)
    .eq("thread_id", threadId)
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

  const [selectedDocuments, events, workspaces] = await Promise.all([
    getRunDocuments(runId),
    getRunEvents(runId),
    listWorkspaces(),
  ]);

  const workspace = workspaces.find((item) => item.id === run.workspace_id);

  return mapRunResponse(run, workspace, selectedDocuments, events);
}

export async function listDeepResearchRunSummaries(options?: {
  workspaceId?: string;
  limit?: number;
}) {
  const { supabaseAdmin } = createSupabaseClients();
  let query = supabaseAdmin
    .from("deep_research_runs")
    .select(deepResearchRunSelect)
    .order("updated_at", { ascending: false })
    .limit(options?.limit ?? 10);

  if (options?.workspaceId) {
    query = query.eq("workspace_id", options.workspaceId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const runs = (data ?? []) as DeepResearchRunRecord[];
  const workspaces = await listWorkspaces();
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));

  return runs.map((run) =>
    mapRunSummary(
      run,
      run.workspace_id ? workspaceById.get(run.workspace_id) : undefined,
    ),
  );
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

export async function persistDeepResearchRunArtifacts(
  runId: string,
  artifacts: {
    reportPlan?: ReportPlan;
    sectionSupport?: SectionValidation[];
    evidenceRows?: EvidenceRow[];
    evidenceResolutions?: EvidenceResolution[];
    sectionEvidenceLinks?: SectionEvidenceLink[];
  },
) {
  const { supabaseAdmin } = createSupabaseClients();

  await updateDeepResearchRun(runId, {
    planner_type: artifacts.reportPlan?.plannerType ?? null,
    report_plan_version: artifacts.reportPlan?.reportPlanVersion ?? null,
    report_plan_json: artifacts.reportPlan ?? null,
  });

  const deleteTables = [
    "deep_research_run_section_evidence_links",
    "deep_research_run_section_validations",
    "deep_research_run_evidence_rows",
    "deep_research_run_evidence_resolutions",
  ] as const;

  for (const table of deleteTables) {
    const { error } = await supabaseAdmin.from(table).delete().eq("run_id", runId);
    if (error) {
      throw new Error(error.message);
    }
  }

  if (artifacts.evidenceResolutions && artifacts.evidenceResolutions.length > 0) {
    const { error } = await supabaseAdmin
      .from("deep_research_run_evidence_resolutions")
      .insert(
        artifacts.evidenceResolutions.map((resolution) => ({
          id: resolution.id,
          run_id: resolution.runId,
          conflict_group: resolution.conflictGroup,
          winning_evidence_row_ids: resolution.winningEvidenceRowIds,
          discarded_evidence_row_ids: resolution.discardedEvidenceRowIds,
          resolution_note: resolution.resolutionNote,
          resolved_by: resolution.resolvedBy,
          created_at: resolution.createdAt,
        })),
      );

    if (error) {
      throw new Error(error.message);
    }
  }

  if (artifacts.evidenceRows && artifacts.evidenceRows.length > 0) {
    const { error } = await supabaseAdmin
      .from("deep_research_run_evidence_rows")
      .insert(
        artifacts.evidenceRows.map((row) => ({
          id: row.id,
          run_id: runId,
          claim: row.claim,
          claim_type: row.claimType,
          value: row.value,
          unit: row.unit ?? null,
          entity: row.entity ?? null,
          segment: row.segment ?? null,
          geography: row.geography ?? null,
          timeframe: row.timeframe ?? null,
          source_type: row.sourceType,
          source_tier: row.sourceTier,
          source_title: row.sourceTitle ?? null,
          source_url: row.sourceUrl ?? null,
          document_id: row.documentId ?? null,
          chunk_index: row.chunkIndex ?? null,
          confidence: row.confidence,
          conflict_group: row.conflictGroup ?? null,
          allowed_for_final:
            typeof row.allowedForFinal === "boolean"
              ? row.allowedForFinal
              : null,
          resolution_id: row.resolutionId ?? null,
          metadata_json: row.metadata ?? {},
        })),
      );

    if (error) {
      throw new Error(error.message);
    }
  }

  if (artifacts.sectionSupport && artifacts.sectionSupport.length > 0) {
    const { error } = await supabaseAdmin
      .from("deep_research_run_section_validations")
      .insert(
        artifacts.sectionSupport.map((section) => ({
          run_id: runId,
          section_key: section.key,
          support: section.support,
          reason: section.reason ?? null,
          evidence_count: section.evidenceCount ?? null,
          top_source_tier: section.topSourceTier ?? null,
        })),
      );

    if (error) {
      throw new Error(error.message);
    }
  }

  if (artifacts.sectionEvidenceLinks && artifacts.sectionEvidenceLinks.length > 0) {
    const { error } = await supabaseAdmin
      .from("deep_research_run_section_evidence_links")
      .insert(
        artifacts.sectionEvidenceLinks.map((link) => ({
          run_id: runId,
          section_key: link.sectionKey,
          evidence_row_id: link.evidenceRowId,
          role: link.role,
        })),
      );

    if (error) {
      throw new Error(error.message);
    }
  }
}

export async function getDeepResearchRunEvidenceResponse(
  runId: string,
): Promise<DeepResearchRunEvidenceResponse | null> {
  const run = await getDeepResearchRunRecord(runId);
  if (!run) {
    return null;
  }

  const { supabaseAdmin } = createSupabaseClients();
  const [sectionValidationResult, evidenceRowsResult, resolutionsResult, linksResult] =
    await Promise.all([
      supabaseAdmin
        .from("deep_research_run_section_validations")
        .select(
          "section_key, support, reason, evidence_count, top_source_tier",
        )
        .eq("run_id", runId),
      supabaseAdmin
        .from("deep_research_run_evidence_rows")
        .select(
          "id, run_id, claim, claim_type, value, unit, entity, segment, geography, timeframe, source_type, source_tier, source_title, source_url, document_id, chunk_index, confidence, conflict_group, allowed_for_final, resolution_id, metadata_json",
        )
        .eq("run_id", runId),
      supabaseAdmin
        .from("deep_research_run_evidence_resolutions")
        .select(
          "id, run_id, conflict_group, winning_evidence_row_ids, discarded_evidence_row_ids, resolution_note, resolved_by, created_at",
        )
        .eq("run_id", runId),
      supabaseAdmin
        .from("deep_research_run_section_evidence_links")
        .select("section_key, evidence_row_id, role")
        .eq("run_id", runId),
    ]);

  const possibleErrors = [
    sectionValidationResult.error,
    evidenceRowsResult.error,
    resolutionsResult.error,
    linksResult.error,
  ].filter(Boolean);
  if (possibleErrors.length > 0) {
    throw new Error(possibleErrors[0]?.message ?? "Failed to load run evidence.");
  }

  return {
    runId,
    reportPlan: run.report_plan_json ?? undefined,
    sectionSupport: (
      (sectionValidationResult.data ?? []) as DeepResearchRunSectionValidationRecord[]
    ).map(mapSectionValidation),
    evidenceRows: (
      (evidenceRowsResult.data ?? []) as DeepResearchRunEvidenceRowRecord[]
    ).map(mapEvidenceRow),
    evidenceResolutions: (
      (resolutionsResult.data ?? []) as DeepResearchRunEvidenceResolutionRecord[]
    ).map(mapEvidenceResolution),
    sectionEvidenceLinks: (
      (linksResult.data ?? []) as DeepResearchRunSectionEvidenceLinkRecord[]
    ).map(mapSectionEvidenceLink),
  };
}

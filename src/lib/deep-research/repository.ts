import type { DocumentSummary } from "@/lib/documents";
import { listDocumentsByIds } from "@/lib/documents";
import { withPgTransaction } from "@/lib/deep-research/db";
import type {
  CreateDeepResearchRunRequest,
  DeepResearchRunEvidenceResponse,
  DeepResearchRunEvent,
  DeepResearchRunRecord,
  DeepResearchRunResponse,
  DeepResearchRunStatus,
  DeepResearchRunSummary,
  EvidenceResolution,
  EvidenceRow,
  ReportPlan,
  SectionEvidenceLink,
  SectionValidation,
  SessionMessage,
  SessionMessageMetadata,
  SessionMessageRecord,
  SessionNavigationWorkspaceGroup,
  SessionRecord,
  SessionRole,
  SessionMessageType,
  SessionSummary,
  SessionThreadResponse,
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
  session_id,
  origin_message_id,
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

const sessionSelect = `
  id,
  workspace_id,
  title,
  created_at,
  updated_at,
  archived_at
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
  run_id: string;
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

interface SessionRow {
  id: string;
  workspace_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface SessionMessageRow {
  id: string;
  session_id: string;
  role: SessionMessageRecord["role"];
  message_type: SessionMessageRecord["message_type"];
  content_markdown: string;
  metadata_json: SessionMessageMetadata | null;
  created_at: string;
}

interface SessionCompletedReportRow {
  id: string;
  session_id: string | null;
  topic: string;
  final_report_markdown: string | null;
  updated_at: string;
  created_at: string;
}

export interface SessionCompletedReport {
  runId: string;
  sessionId: string;
  topic: string;
  finalReportMarkdown: string;
  updatedAt: string;
  createdAt: string;
}

type CreateDeepResearchRunRecordResult = {
  created: boolean;
  run: DeepResearchRunRecord;
};

function buildInitialSessionMessageContent(topic: string, objective?: string | null) {
  if (!objective) {
    return topic;
  }

  return `${topic}\n\nObjective: ${objective}`;
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

function mapEvidenceRow(row: DeepResearchRunEvidenceRowRecord): EvidenceRow {
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
    sessionId: run.session_id ?? undefined,
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
    sessionId: run.session_id ?? undefined,
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

function mapSessionSummary(
  session: SessionRecord,
  latestRun?: Pick<DeepResearchRunRecord, "id" | "status">,
): SessionSummary {
  return {
    id: session.id,
    workspaceId: session.workspace_id,
    title: session.title,
    latestRunId: latestRun?.id,
    latestRunStatus: latestRun?.status,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    archivedAt: session.archived_at ?? undefined,
  };
}

function mapSessionMessage(
  message: SessionMessageRecord,
  linkedRun?: DeepResearchRunResponse,
): SessionMessage {
  return {
    id: message.id,
    sessionId: message.session_id,
    role: message.role,
    messageType: message.message_type,
    contentMarkdown: message.content_markdown,
    metadata: message.metadata_json ?? {},
    createdAt: message.created_at,
    linkedRun,
  };
}

async function getRunDocumentsByRunIds(runIds: string[]) {
  if (runIds.length === 0) {
    return new Map<string, DocumentSummary[]>();
  }

  const { supabaseAdmin } = createSupabaseClients();
  const { data, error } = await supabaseAdmin
    .from("deep_research_run_documents")
    .select("run_id, document_external_id, file_name")
    .in("run_id", runIds);

  if (error) {
    throw new Error(error.message);
  }

  const documentRows = (data ?? []) as DeepResearchRunDocumentRow[];
  const documentIds = Array.from(
    new Set(documentRows.map((row) => row.document_external_id)),
  );
  const documents = await listDocumentsByIds(documentIds);
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const documentsByRunId = new Map<string, DocumentSummary[]>();

  for (const runId of runIds) {
    documentsByRunId.set(runId, []);
  }

  for (const row of documentRows) {
    const matched = documentsById.get(row.document_external_id);
    const nextDocument =
      matched ?? {
        id: row.document_external_id,
        file_name: row.file_name ?? row.document_external_id,
        file_type: "unknown",
        file_size: 0,
        upload_date: "",
        total_chunks: 0,
      };

    documentsByRunId.get(row.run_id)?.push(nextDocument);
  }

  return documentsByRunId;
}

async function getRunEventsByRunIds(runIds: string[]) {
  if (runIds.length === 0) {
    return new Map<string, DeepResearchRunEvent[]>();
  }

  const { supabaseAdmin } = createSupabaseClients();
  const { data, error } = await supabaseAdmin
    .from("deep_research_run_events")
    .select("id, run_id, stage, event_type, message, payload_json, created_at")
    .in("run_id", runIds)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const eventsByRunId = new Map<string, DeepResearchRunEvent[]>();
  for (const runId of runIds) {
    eventsByRunId.set(runId, []);
  }

  for (const row of (data ?? []) as DeepResearchRunEventRow[]) {
    eventsByRunId.get(row.run_id)?.push(mapEvent(row));
  }

  return eventsByRunId;
}

async function getSessionRecord(sessionId: string) {
  const { supabaseAdmin } = createSupabaseClients();
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select(sessionSelect)
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as SessionRow | null) ?? null;
}

async function getSessionMessageRows(sessionId: string) {
  const { supabaseAdmin } = createSupabaseClients();
  const { data, error } = await supabaseAdmin
    .from("session_messages")
    .select("id, session_id, role, message_type, content_markdown, metadata_json, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as SessionMessageRow[]).map(
    (row) =>
      ({
        ...row,
        metadata_json: row.metadata_json ?? {},
      }) as SessionMessageRecord,
  );
}

async function getLatestRunsBySessionId(sessionIds: string[]) {
  if (sessionIds.length === 0) {
    return new Map<string, DeepResearchRunRecord>();
  }

  const { supabaseAdmin } = createSupabaseClients();
  const { data, error } = await supabaseAdmin
    .from("deep_research_runs")
    .select(deepResearchRunSelect)
    .in("session_id", sessionIds)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const latestRunBySessionId = new Map<string, DeepResearchRunRecord>();

  for (const run of (data ?? []) as DeepResearchRunRecord[]) {
    if (!run.session_id || latestRunBySessionId.has(run.session_id)) {
      continue;
    }

    latestRunBySessionId.set(run.session_id, run);
  }

  return latestRunBySessionId;
}

async function touchSession(sessionId: string) {
  const { supabaseAdmin } = createSupabaseClients();
  const { error } = await supabaseAdmin
    .from("sessions")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", sessionId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function appendSessionMessage(input: {
  sessionId: string;
  role: SessionRole;
  messageType: SessionMessageType;
  contentMarkdown: string;
  metadata?: SessionMessageMetadata;
  createdAt?: string;
  id?: string;
}) {
  const timestamp = input.createdAt ?? new Date().toISOString();
  const messageId = input.id?.trim() || crypto.randomUUID();

  await withPgTransaction(async (client) => {
    const sessionResult = await client.query<SessionRow>(
      `
        select ${sessionSelect}
        from public.sessions
        where id = $1
        for update
      `,
      [input.sessionId],
    );

    const session = sessionResult.rows[0];
    if (!session) {
      throw new Error("Session not found.");
    }

    if (session.archived_at) {
      throw new Error("Archived sessions cannot accept new messages.");
    }

    await client.query(
      `
        insert into public.session_messages (
          id,
          session_id,
          role,
          message_type,
          content_markdown,
          metadata_json,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6::jsonb, $7)
        on conflict (id) do update
        set
          content_markdown = excluded.content_markdown,
          metadata_json = excluded.metadata_json
      `,
      [
        messageId,
        input.sessionId,
        input.role,
        input.messageType,
        input.contentMarkdown,
        JSON.stringify(input.metadata ?? {}),
        timestamp,
      ],
    );

    await client.query(
      `
        update public.sessions
        set updated_at = $2
        where id = $1
      `,
      [input.sessionId, timestamp],
    );
  });

  return messageId;
}

export async function listRecentSessionChatMessages(
  sessionId: string,
  limit = 12,
) {
  const { supabaseAdmin } = createSupabaseClients();
  const { data, error } = await supabaseAdmin
    .from("session_messages")
    .select("id, session_id, role, message_type, content_markdown, metadata_json, created_at")
    .eq("session_id", sessionId)
    .eq("message_type", "chat")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as SessionMessageRow[])
    .map(
      (row) =>
        ({
          ...row,
          metadata_json: row.metadata_json ?? {},
        }) as SessionMessageRecord,
    )
    .reverse();
}

export async function listCompletedSessionReports(
  sessionId: string,
): Promise<SessionCompletedReport[]> {
  const { supabaseAdmin } = createSupabaseClients();
  const { data, error } = await supabaseAdmin
    .from("deep_research_runs")
    .select("id, session_id, topic, final_report_markdown, updated_at, created_at")
    .eq("session_id", sessionId)
    .eq("status", "completed")
    .not("final_report_markdown", "is", null)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as SessionCompletedReportRow[])
    .filter(
      (row): row is SessionCompletedReportRow & { session_id: string; final_report_markdown: string } =>
        typeof row.session_id === "string" &&
        typeof row.final_report_markdown === "string" &&
        row.final_report_markdown.trim().length > 0,
    )
    .map((row) => ({
      runId: row.id,
      sessionId: row.session_id,
      topic: row.topic,
      finalReportMarkdown: row.final_report_markdown,
      updatedAt: row.updated_at,
      createdAt: row.created_at,
    }));
}

export async function createDeepResearchRunRecord(
  input: CreateDeepResearchRunRequest,
): Promise<CreateDeepResearchRunRecordResult> {
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
  const documents = await listDocumentsByIds(input.selectedDocumentIds);

  try {
    const result = await withPgTransaction(async (client) => {
      let sessionId = input.sessionId?.trim() || null;

      if (sessionId) {
        const sessionResult = await client.query<SessionRow>(
          `
            select ${sessionSelect}
            from public.sessions
            where id = $1
            for update
          `,
          [sessionId],
        );

        const session = sessionResult.rows[0];
        if (!session) {
          throw new Error("Session not found.");
        }

        if (session.workspace_id !== workspace.id) {
          throw new Error("Session workspace does not match the selected workspace.");
        }

        if (session.archived_at) {
          throw new Error("Archived sessions cannot accept new research runs.");
        }

        await client.query(
          `
            update public.sessions
            set updated_at = $2
            where id = $1
          `,
          [sessionId, timestamp],
        );
      } else {
        sessionId = crypto.randomUUID();
        await client.query(
          `
            insert into public.sessions (
              id,
              workspace_id,
              title,
              created_at,
              updated_at,
              archived_at
            )
            values ($1, $2, $3, $4, $4, null)
          `,
          [sessionId, workspace.id, input.topic, timestamp],
        );
      }

      const originMessageId = crypto.randomUUID();
      await client.query(
        `
          insert into public.session_messages (
            id,
            session_id,
            role,
            message_type,
            content_markdown,
            metadata_json,
            created_at
          )
          values ($1, $2, 'user', 'deep_research_request', $3, $4::jsonb, $5)
        `,
        [
          originMessageId,
          sessionId,
          buildInitialSessionMessageContent(input.topic, input.objective ?? null),
          JSON.stringify({
            objective: input.objective ?? null,
            selectedDocumentIds: input.selectedDocumentIds,
          }),
          timestamp,
        ],
      );

      const runResult = await client.query<DeepResearchRunRecord>(
        `
          insert into public.deep_research_runs (
            id,
            thread_id,
            session_id,
            origin_message_id,
            workspace_id,
            topic,
            objective,
            status,
            updated_at,
            last_progress_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, 'queued', $8, $8)
          returning ${deepResearchRunSelect}
        `,
        [
          id,
          threadId,
          sessionId,
          originMessageId,
          workspace.id,
          input.topic,
          input.objective ?? null,
          timestamp,
        ],
      );

      if (documents.length > 0) {
        for (const document of documents) {
          await client.query(
            `
              insert into public.deep_research_run_documents (
                run_id,
                document_external_id,
                file_name
              )
              values ($1, $2, $3)
            `,
            [id, document.id, document.file_name],
          );
        }
      }

      await client.query(
        `
          insert into public.deep_research_run_events (
            run_id,
            stage,
            event_type,
            message,
            payload_json,
            created_at
          )
          values ($1, $2, $3, $4, $5::jsonb, $6)
        `,
        [
          id,
          "queued",
          "run_created",
          "Deep research run queued.",
          JSON.stringify({
            workspaceId: workspace.id,
            selectedDocumentIds: input.selectedDocumentIds,
            objective: input.objective ?? null,
          }),
          timestamp,
        ],
      );

      return {
        created: true,
        run: runResult.rows[0],
      };
    });

    return result;
  } catch (error) {
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

    throw error instanceof Error ? error : new Error("Failed to create research run.");
  }
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

export async function updateDeepResearchRun(runId: string, update: RunUpdate) {
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

  const run = data as DeepResearchRunRecord;
  if (run.session_id) {
    await touchSession(run.session_id);
  }

  return run;
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

  return (data as DeepResearchRunRecord | null) ?? null;
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

  return (data as DeepResearchRunRecord | null) ?? null;
}

export async function getDeepResearchRunResponse(runId: string) {
  const run = await getDeepResearchRunRecord(runId);
  if (!run) {
    return null;
  }

  const [documentsByRunId, eventsByRunId, workspaces] = await Promise.all([
    getRunDocumentsByRunIds([runId]),
    getRunEventsByRunIds([runId]),
    listWorkspaces(),
  ]);

  const workspace = workspaces.find((item) => item.id === run.workspace_id);

  return mapRunResponse(
    run,
    workspace,
    documentsByRunId.get(runId) ?? [],
    eventsByRunId.get(runId) ?? [],
  );
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

export async function listSessionSummaries(options: {
  workspaceId: string;
  limit?: number;
}) {
  const { supabaseAdmin } = createSupabaseClients();
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select(sessionSelect)
    .eq("workspace_id", options.workspaceId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(options.limit ?? 24);

  if (error) {
    throw new Error(error.message);
  }

  const sessions = (data ?? []) as SessionRecord[];
  const latestRunBySessionId = await getLatestRunsBySessionId(
    sessions.map((session) => session.id),
  );

  return sessions.map((session) =>
    mapSessionSummary(session, latestRunBySessionId.get(session.id)),
  );
}

export async function listSessionNavigationGroups(options?: {
  limitPerWorkspace?: number;
  workspaceLimit?: number;
}): Promise<SessionNavigationWorkspaceGroup[]> {
  const { supabaseAdmin } = createSupabaseClients();
  const workspaces = await listWorkspaces();
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select(sessionSelect)
    .is("archived_at", null)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const sessions = (data ?? []) as SessionRecord[];
  const latestRunBySessionId = await getLatestRunsBySessionId(
    sessions.map((session) => session.id),
  );
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const groupedSessions = new Map<string, SessionSummary[]>();

  for (const session of sessions) {
    const currentItems = groupedSessions.get(session.workspace_id) ?? [];
    if (currentItems.length >= (options?.limitPerWorkspace ?? 6)) {
      continue;
    }

    currentItems.push(
      mapSessionSummary(session, latestRunBySessionId.get(session.id)),
    );
    groupedSessions.set(session.workspace_id, currentItems);
  }

  return Array.from(groupedSessions.entries())
    .map(([workspaceId, workspaceSessions]) => {
      const workspace = workspaceById.get(workspaceId);
      const workspaceUpdatedAt = workspaceSessions.reduce(
        (latest, session) =>
          session.updatedAt > latest ? session.updatedAt : latest,
        workspaceSessions[0]?.updatedAt ?? new Date(0).toISOString(),
      );

      return {
        workspaceId,
        workspaceName: workspace?.name ?? "Untitled workspace",
        workspaceUpdatedAt,
        sessions: workspaceSessions,
      } satisfies SessionNavigationWorkspaceGroup;
    })
    .sort((left, right) =>
      right.workspaceUpdatedAt.localeCompare(left.workspaceUpdatedAt),
    )
    .slice(0, options?.workspaceLimit ?? 8);
}

export async function getSessionSummary(sessionId: string) {
  const session = await getSessionRecord(sessionId);
  if (!session) {
    return null;
  }

  const latestRunBySessionId = await getLatestRunsBySessionId([sessionId]);
  return mapSessionSummary(session, latestRunBySessionId.get(sessionId));
}

export async function getSessionThreadResponse(
  sessionId: string,
): Promise<SessionThreadResponse | null> {
  const session = await getSessionRecord(sessionId);
  if (!session) {
    return null;
  }

  const { supabaseAdmin } = createSupabaseClients();
  const [messages, runsResult, workspaces] = await Promise.all([
    getSessionMessageRows(sessionId),
    supabaseAdmin
      .from("deep_research_runs")
      .select(deepResearchRunSelect)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true }),
    listWorkspaces(),
  ]);

  if (runsResult.error) {
    throw new Error(runsResult.error.message);
  }

  const runs = (runsResult.data ?? []) as DeepResearchRunRecord[];
  const runIds = runs.map((run) => run.id);
  const [documentsByRunId, eventsByRunId] = await Promise.all([
    getRunDocumentsByRunIds(runIds),
    getRunEventsByRunIds(runIds),
  ]);

  const workspace = workspaces.find((item) => item.id === session.workspace_id);
  const linkedRunByMessageId = new Map<string, DeepResearchRunResponse>();
  const latestRun = runs.reduce<DeepResearchRunRecord | undefined>((current, candidate) => {
    if (!current) {
      return candidate;
    }

    const currentTimestamp = new Date(
      current.updated_at || current.created_at,
    ).getTime();
    const candidateTimestamp = new Date(
      candidate.updated_at || candidate.created_at,
    ).getTime();

    return candidateTimestamp > currentTimestamp ? candidate : current;
  }, undefined);

  for (const run of runs) {
    if (!run.origin_message_id) {
      continue;
    }

    linkedRunByMessageId.set(
      run.origin_message_id,
      mapRunResponse(
        run,
        workspace,
        documentsByRunId.get(run.id) ?? [],
        eventsByRunId.get(run.id) ?? [],
      ),
    );
  }

  return {
    session: mapSessionSummary(
      session,
      latestRun,
    ),
    workspace,
    messages: messages.map((message) =>
      mapSessionMessage(message, linkedRunByMessageId.get(message.id)),
    ),
  };
}

export async function renameSession(sessionId: string, title: string) {
  const { supabaseAdmin } = createSupabaseClients();
  const { error } = await supabaseAdmin
    .from("sessions")
    .update({
      title,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (error) {
    throw new Error(error.message);
  }

  return getSessionSummary(sessionId);
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

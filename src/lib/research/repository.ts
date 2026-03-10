import { createSupabaseServerClient } from '@/lib/supabase';
import type {
  Citation,
  CreateResearchRunInput,
  ResearchFinding,
  ResearchEvidence,
  LinkedDocument,
  DraftReportSection,
  RetrievalCandidate,
  ResearchPlan,
  ResearchRunSnapshot,
  ResearchRunStatus,
  ResearchStage,
} from '@/lib/research/schemas';

type JsonRecord = Record<string, unknown>;

interface ResearchRunRow {
  id: string;
  topic: string;
  objective: string | null;
  status: ResearchRunStatus;
  current_stage: string;
  plan_json: ResearchPlan | null;
  final_report_markdown: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface ResearchRunDocumentRow {
  id: string;
  document_external_id: string;
  file_name: string | null;
}

interface ResearchEventRow {
  id: number;
  run_id: string;
  stage: string;
  event_type: string;
  message: string;
  payload_json: JsonRecord;
  created_at: string;
}

interface ResearchSourceRow {
  id: string;
  source_type: string;
  title: string;
  url: string | null;
  snippet: string | null;
  metadata_json: JsonRecord;
  created_at: string;
}

interface ResearchFindingRow {
  id: string;
  section_key: string;
  claim_type: ResearchFinding['claimType'];
  claim: string;
  evidence_json: Citation[];
  evidence_mode: ResearchFinding['evidenceMode'];
  inference_label: ResearchFinding['inferenceLabel'];
  confidence: ResearchFinding['confidence'];
  status: string;
  verification_notes: string | null;
  gaps_json: string[];
  contradictions_json: string[];
  created_at: string;
}

interface ResearchReportSectionRow {
  id: string;
  section_key: string;
  title: string;
  content_markdown: string;
  citations_json: string[];
  status: DraftReportSection['status'];
  status_notes_json: string[];
  created_at: string;
}

interface ResearchEvidenceRow {
  id: string;
  source_type: 'web' | 'document';
  source_id: string | null;
  document_chunk_id: number | null;
  document_external_id: string | null;
  section_key: string | null;
  title: string;
  url: string | null;
  excerpt: string;
  metadata_json: JsonRecord;
  created_at: string;
}

interface ResearchRetrievalCandidateRow {
  id: string;
  source_type: RetrievalCandidate['sourceType'];
  retriever_type: RetrievalCandidate['retrieverType'];
  section_key: string;
  query_text: string;
  source_id: string | null;
  document_external_id: string | null;
  document_chunk_id: number | null;
  title: string;
  url: string | null;
  raw_score: number;
  fused_score: number | null;
  rerank_score: number | null;
  selected: boolean;
  metadata_json: JsonRecord;
  created_at: string;
}

interface LegacyDocumentMetadata {
  document_id?: string;
  file_name?: string;
}

interface LegacyDocumentRow {
  metadata: LegacyDocumentMetadata | null;
}

interface InsertSourceInput {
  sourceType: 'web' | 'document';
  title: string;
  url: string | null;
  snippet: string | null;
  metadataJson: JsonRecord;
}

export interface ResearchEventRecord {
  id: number;
  runId: string;
  stage: string;
  eventType: string;
  message: string;
  payloadJson: JsonRecord;
  createdAt: string;
}

interface InsertEvidenceInput {
  sourceType: 'web' | 'document';
  sourceId: string | null;
  documentChunkId?: number | null;
  documentExternalId?: string | null;
  sectionKey?: string | null;
  title: string;
  url: string | null;
  excerpt: string;
  metadataJson: JsonRecord;
}

interface InsertRetrievalCandidateInput {
  sourceType: RetrievalCandidate['sourceType'];
  retrieverType: RetrievalCandidate['retrieverType'];
  sectionKey: RetrievalCandidate['sectionKey'];
  query: string;
  sourceId?: string | null;
  documentExternalId?: string | null;
  documentChunkId?: number | null;
  title: string;
  url: string | null;
  claimType: RetrievalCandidate['claimType'];
  evidenceMode: RetrievalCandidate['evidenceMode'];
  vendorTarget?: RetrievalCandidate['vendorTarget'];
  rawScore: number;
  fusedScore?: number | null;
  rerankScore?: number | null;
  selected?: boolean;
  metadataJson: JsonRecord;
}

function mapLinkedDocument(row: ResearchRunDocumentRow): LinkedDocument {
  return {
    id: row.id,
    documentExternalId: row.document_external_id,
    fileName: row.file_name,
  };
}

function mapRun(row: ResearchRunRow): ResearchRunSnapshot['run'] {
  return {
    id: row.id,
    topic: row.topic,
    objective: row.objective,
    status: row.status,
    currentStage: row.current_stage,
    planJson: row.plan_json,
    finalReportMarkdown: row.final_report_markdown,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapResearchEvent(row: ResearchEventRow): ResearchEventRecord {
  return {
    id: row.id,
    runId: row.run_id,
    stage: row.stage,
    eventType: row.event_type,
    message: row.message,
    payloadJson: row.payload_json ?? {},
    createdAt: row.created_at,
  };
}

function getNowIso() {
  return new Date().toISOString();
}

async function maybeGetLegacyDocumentName(documentId: string) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('documents')
    .select('metadata')
    .eq('metadata->>document_id', documentId)
    .limit(1)
    .maybeSingle<LegacyDocumentRow>();

  if (error) {
    return null;
  }

  return data?.metadata?.file_name ?? null;
}

export async function createResearchRun(input: CreateResearchRunInput) {
  const supabase = createSupabaseServerClient();
  const timestamp = getNowIso();

  const { data: run, error: runError } = await supabase
    .from('research_runs')
    .insert({
      topic: input.topic,
      objective: input.objective ?? null,
      status: 'queued',
      current_stage: 'plan',
      created_at: timestamp,
      updated_at: timestamp,
    })
    .select('*')
    .single<ResearchRunRow>();

  if (runError || !run) {
    throw new Error(runError?.message || 'Failed to create research run.');
  }

  for (const documentId of input.selectedDocumentIds ?? []) {
    const fileName = await maybeGetLegacyDocumentName(documentId);
    const { error } = await supabase.from('research_run_documents').insert({
      run_id: run.id,
      document_external_id: documentId,
      file_name: fileName,
      created_at: timestamp,
    });

    if (error && !error.message.includes('duplicate key')) {
      throw new Error(error.message);
    }
  }

  return mapRun(run);
}

export async function setRunStage(runId: string, status: ResearchRunStatus, currentStage: string) {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from('research_runs')
    .update({
      status,
      current_stage: currentStage,
      updated_at: getNowIso(),
    })
    .eq('id', runId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function saveRunPlan(runId: string, plan: ResearchPlan) {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from('research_runs')
    .update({
      plan_json: plan,
      updated_at: getNowIso(),
    })
    .eq('id', runId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function finalizeRun(runId: string, finalReportMarkdown: string) {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from('research_runs')
    .update({
      status: 'completed',
      current_stage: 'finalize',
      final_report_markdown: finalReportMarkdown,
      error_message: null,
      updated_at: getNowIso(),
    })
    .eq('id', runId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function failRun(runId: string, currentStage: string, errorMessage: string) {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from('research_runs')
    .update({
      status: 'failed',
      current_stage: currentStage,
      error_message: errorMessage,
      updated_at: getNowIso(),
    })
    .eq('id', runId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function appendResearchEvent(
  runId: string,
  stage: ResearchStage,
  eventType: string,
  message: string,
  payloadJson: JsonRecord = {},
) {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from('research_events').insert({
    run_id: runId,
    stage,
    event_type: eventType,
    message,
    payload_json: payloadJson,
    created_at: getNowIso(),
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function hasStageCompleted(runId: string, stage: ResearchStage) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('research_events')
    .select('id')
    .eq('run_id', runId)
    .eq('stage', stage)
    .eq('event_type', 'stage_completed')
    .limit(1)
    .maybeSingle<{ id: number }>();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data?.id);
}

export async function getResearchRun(runId: string) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('research_runs')
    .select('*')
    .eq('id', runId)
    .single<ResearchRunRow>();

  if (error || !data) {
    throw new Error(error?.message || 'Research run not found.');
  }

  return mapRun(data);
}

export async function listResearchRuns() {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('research_runs')
    .select('*')
    .order('updated_at', { ascending: false })
    .returns<ResearchRunRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(mapRun);
}

export async function listLinkedDocuments(runId: string) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('research_run_documents')
    .select('id, document_external_id, file_name')
    .eq('run_id', runId)
    .order('created_at', { ascending: true })
    .returns<ResearchRunDocumentRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(mapLinkedDocument);
}

export async function listResearchEvents(runId: string) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('research_events')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true })
    .returns<ResearchEventRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(mapResearchEvent);
}

export async function clearResearchSources(runId: string, sourceType: 'web' | 'document') {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from('research_sources')
    .delete()
    .eq('run_id', runId)
    .eq('source_type', sourceType);

  if (error) {
    throw new Error(error.message);
  }
}

export async function clearResearchEvidence(runId: string, sourceType?: 'web' | 'document') {
  const supabase = createSupabaseServerClient();
  let query = supabase.from('research_evidence').delete().eq('run_id', runId);

  if (sourceType) {
    query = query.eq('source_type', sourceType);
  }

  const { error } = await query;

  if (error) {
    throw new Error(error.message);
  }
}

export async function clearResearchRetrievalCandidates(
  runId: string,
  filters?: { sectionKey?: string; sourceType?: RetrievalCandidate['sourceType'] },
) {
  const supabase = createSupabaseServerClient();
  let query = supabase.from('research_retrieval_candidates').delete().eq('run_id', runId);

  if (filters?.sectionKey) {
    query = query.eq('section_key', filters.sectionKey);
  }

  if (filters?.sourceType) {
    query = query.eq('source_type', filters.sourceType);
  }

  const { error } = await query;
  if (error) {
    throw new Error(error.message);
  }
}

export async function saveResearchSources(runId: string, sources: InsertSourceInput[]) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('research_sources')
    .insert(
      sources.map((source) => ({
        run_id: runId,
        source_type: source.sourceType,
        title: source.title,
        url: source.url,
        snippet: source.snippet,
        metadata_json: source.metadataJson,
        created_at: getNowIso(),
      })),
    )
    .select('*')
    .returns<ResearchSourceRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    sourceType: row.source_type,
    title: row.title,
    url: row.url,
    snippet: row.snippet,
    metadataJson: row.metadata_json ?? {},
    createdAt: row.created_at,
  }));
}

export async function listResearchSources(runId: string) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('research_sources')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true })
    .returns<ResearchSourceRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    sourceType: row.source_type,
    title: row.title,
    url: row.url,
    snippet: row.snippet,
    metadataJson: row.metadata_json ?? {},
    createdAt: row.created_at,
  }));
}

export async function saveResearchEvidence(runId: string, evidence: InsertEvidenceInput[]) {
  const supabase = createSupabaseServerClient();

  if (evidence.length === 0) {
    return [] as ResearchEvidence[];
  }

  const { data, error } = await supabase
    .from('research_evidence')
    .insert(
      evidence.map((item) => ({
        run_id: runId,
        source_type: item.sourceType,
        source_id: item.sourceId,
        document_chunk_id: item.documentChunkId ?? null,
        document_external_id: item.documentExternalId ?? null,
        section_key: item.sectionKey ?? null,
        title: item.title,
        url: item.url,
        excerpt: item.excerpt,
        metadata_json: item.metadataJson,
        created_at: getNowIso(),
      })),
    )
    .select('*')
    .returns<ResearchEvidenceRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    title: row.title,
    url: row.url,
    excerpt: row.excerpt,
    sectionKey: row.section_key as ResearchEvidence['sectionKey'],
    documentExternalId: row.document_external_id,
    documentChunkId: row.document_chunk_id,
    metadataJson: row.metadata_json ?? {},
    createdAt: row.created_at,
  }));
}

export async function saveResearchRetrievalCandidates(runId: string, candidates: InsertRetrievalCandidateInput[]) {
  const supabase = createSupabaseServerClient();

  if (candidates.length === 0) {
    return [] as RetrievalCandidate[];
  }

  const { data, error } = await supabase
    .from('research_retrieval_candidates')
    .insert(
      candidates.map((candidate) => ({
        run_id: runId,
        source_type: candidate.sourceType,
        retriever_type: candidate.retrieverType,
        section_key: candidate.sectionKey,
        query_text: candidate.query,
        source_id: candidate.sourceId ?? null,
        document_external_id: candidate.documentExternalId ?? null,
        document_chunk_id: candidate.documentChunkId ?? null,
        title: candidate.title,
        url: candidate.url,
        raw_score: candidate.rawScore,
        fused_score: candidate.fusedScore ?? null,
        rerank_score: candidate.rerankScore ?? null,
        selected: candidate.selected ?? false,
        metadata_json: {
          ...candidate.metadataJson,
          claimType: candidate.claimType,
          evidenceMode: candidate.evidenceMode,
          vendorTarget: candidate.vendorTarget ?? null,
        },
        created_at: getNowIso(),
      })),
    )
    .select('*')
    .returns<ResearchRetrievalCandidateRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    sourceType: row.source_type,
    retrieverType: row.retriever_type,
    sectionKey: row.section_key as RetrievalCandidate['sectionKey'],
    query: row.query_text,
    sourceId: row.source_id,
    title: row.title,
    url: row.url,
    documentExternalId: row.document_external_id,
    documentChunkId: row.document_chunk_id,
    claimType:
      typeof row.metadata_json.claimType === 'string'
        ? (row.metadata_json.claimType as RetrievalCandidate['claimType'])
        : 'buyer-pain',
    evidenceMode:
      typeof row.metadata_json.evidenceMode === 'string'
        ? (row.metadata_json.evidenceMode as RetrievalCandidate['evidenceMode'])
        : 'market-adjacent',
    vendorTarget:
      typeof row.metadata_json.vendorTarget === 'string' ? row.metadata_json.vendorTarget : null,
    rawScore: row.raw_score,
    fusedScore: row.fused_score,
    rerankScore: row.rerank_score,
    selected: row.selected,
    metadataJson: row.metadata_json ?? {},
    createdAt: row.created_at,
  }));
}

export async function listResearchRetrievalCandidates(runId: string) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('research_retrieval_candidates')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true })
    .returns<ResearchRetrievalCandidateRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    sourceType: row.source_type,
    retrieverType: row.retriever_type,
    sectionKey: row.section_key as RetrievalCandidate['sectionKey'],
    query: row.query_text,
    sourceId: row.source_id,
    title: row.title,
    url: row.url,
    documentExternalId: row.document_external_id,
    documentChunkId: row.document_chunk_id,
    claimType:
      typeof row.metadata_json.claimType === 'string'
        ? (row.metadata_json.claimType as RetrievalCandidate['claimType'])
        : 'buyer-pain',
    evidenceMode:
      typeof row.metadata_json.evidenceMode === 'string'
        ? (row.metadata_json.evidenceMode as RetrievalCandidate['evidenceMode'])
        : 'market-adjacent',
    vendorTarget:
      typeof row.metadata_json.vendorTarget === 'string' ? row.metadata_json.vendorTarget : null,
    rawScore: row.raw_score,
    fusedScore: row.fused_score,
    rerankScore: row.rerank_score,
    selected: row.selected,
    metadataJson: row.metadata_json ?? {},
    createdAt: row.created_at,
  }));
}

export async function listResearchEvidence(runId: string) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('research_evidence')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true })
    .returns<ResearchEvidenceRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    title: row.title,
    url: row.url,
    excerpt: row.excerpt,
    sectionKey: row.section_key as ResearchEvidence['sectionKey'],
    documentExternalId: row.document_external_id,
    documentChunkId: row.document_chunk_id,
    metadataJson: row.metadata_json ?? {},
    createdAt: row.created_at,
  }));
}

export async function replaceResearchFindings(runId: string, findings: ResearchFinding[]) {
  const supabase = createSupabaseServerClient();
  const deleteResult = await supabase.from('research_findings').delete().eq('run_id', runId);

  if (deleteResult.error) {
    throw new Error(deleteResult.error.message);
  }

  if (findings.length === 0) {
    return;
  }

  const { error } = await supabase.from('research_findings').insert(
    findings.map((finding) => ({
      run_id: runId,
      section_key: finding.sectionKey,
      claim_type: finding.claimType,
      claim: finding.claim,
      evidence_json: finding.evidence,
      evidence_mode: finding.evidenceMode,
      inference_label: finding.inferenceLabel,
      confidence: finding.confidence,
      status: finding.status,
      verification_notes: finding.verificationNotes,
      gaps_json: finding.gaps,
      contradictions_json: finding.contradictions,
      created_at: getNowIso(),
    })),
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function listResearchFindings(runId: string) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('research_findings')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true })
    .returns<ResearchFindingRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    sectionKey: row.section_key,
    claimType: row.claim_type,
    claim: row.claim,
    evidenceJson: row.evidence_json ?? [],
    evidenceMode: row.evidence_mode,
    inferenceLabel: row.inference_label,
    confidence: row.confidence,
    status: row.status,
    verificationNotes: row.verification_notes ?? '',
    gapsJson: row.gaps_json ?? [],
    contradictionsJson: row.contradictions_json ?? [],
    createdAt: row.created_at,
  }));
}

export async function replaceResearchReportSections(runId: string, sections: DraftReportSection[]) {
  const supabase = createSupabaseServerClient();
  const deleteResult = await supabase.from('research_report_sections').delete().eq('run_id', runId);

  if (deleteResult.error) {
    throw new Error(deleteResult.error.message);
  }

  if (sections.length === 0) {
    return;
  }

  const { error } = await supabase.from('research_report_sections').insert(
    sections.map((section) => ({
      run_id: runId,
      section_key: section.sectionKey,
      title: section.title,
      content_markdown: section.contentMarkdown,
      citations_json: section.citations,
      status: section.status,
      status_notes_json: section.statusNotes,
      created_at: getNowIso(),
    })),
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function listResearchReportSections(runId: string) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('research_report_sections')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true })
    .returns<ResearchReportSectionRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    sectionKey: row.section_key,
    title: row.title,
    contentMarkdown: row.content_markdown,
    citationsJson: row.citations_json ?? [],
    status: row.status,
    statusNotesJson: row.status_notes_json ?? [],
    createdAt: row.created_at,
  }));
}

export async function getResearchRunSnapshot(runId: string): Promise<ResearchRunSnapshot> {
  const [run, linkedDocuments, sources, findings, evidence, retrievalCandidates, reportSections] = await Promise.all([
    getResearchRun(runId),
    listLinkedDocuments(runId),
    listResearchSources(runId),
    listResearchFindings(runId),
    listResearchEvidence(runId),
    listResearchRetrievalCandidates(runId),
    listResearchReportSections(runId),
  ]);

  return {
    run,
    linkedDocuments,
    sources,
    findings,
    evidence,
    retrievalCandidates,
    reportSections,
  };
}

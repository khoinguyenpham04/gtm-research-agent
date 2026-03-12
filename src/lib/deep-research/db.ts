import { Pool } from "pg";

import { getDatabaseConnectionString } from "@/lib/deep-research/config";

let pool: Pool | undefined;
let ensurePromise: Promise<void> | undefined;

const deepResearchSetupSql = `
create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workspace_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  parent_folder_id uuid references public.workspace_folders(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workspace_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_external_id text not null,
  folder_id uuid references public.workspace_folders(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, document_external_id)
);

create table if not exists public.document_sources (
  id uuid primary key default gen_random_uuid(),
  document_external_id text not null unique,
  source_type text not null check (source_type in ('upload', 'agent_download', 'url_ingest')),
  source_url text,
  status text not null default 'ready' check (status in ('ready', 'processing', 'failed')),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.deep_research_runs (
  id uuid primary key default gen_random_uuid(),
  thread_id text not null unique,
  workspace_id uuid references public.workspaces(id) on delete set null,
  planner_type text,
  report_plan_version integer,
  report_plan_json jsonb,
  topic text not null,
  objective text,
  status text not null default 'queued' check (status in ('queued', 'running', 'needs_clarification', 'completed', 'failed', 'timed_out')),
  clarification_question text,
  final_report_markdown text,
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_progress_at timestamptz
);

alter table public.deep_research_runs
  add column if not exists workspace_id uuid references public.workspaces(id) on delete set null;

alter table public.deep_research_runs
  add column if not exists planner_type text;

alter table public.deep_research_runs
  add column if not exists report_plan_version integer;

alter table public.deep_research_runs
  add column if not exists report_plan_json jsonb;

create table if not exists public.deep_research_run_documents (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.deep_research_runs(id) on delete cascade,
  document_external_id text not null,
  file_name text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.deep_research_run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.deep_research_runs(id) on delete cascade,
  stage text not null,
  event_type text not null,
  message text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.deep_research_run_evidence_resolutions (
  id uuid primary key,
  run_id uuid not null references public.deep_research_runs(id) on delete cascade,
  conflict_group text not null,
  winning_evidence_row_ids text[] not null default '{}',
  discarded_evidence_row_ids text[] not null default '{}',
  resolution_note text not null,
  resolved_by text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.deep_research_run_evidence_rows (
  id uuid primary key,
  run_id uuid not null references public.deep_research_runs(id) on delete cascade,
  claim text not null,
  claim_type text not null,
  value text not null,
  unit text,
  entity text,
  segment text,
  geography text,
  timeframe text,
  source_type text not null,
  source_tier text not null,
  source_title text,
  source_url text,
  document_id text,
  chunk_index integer,
  confidence text not null,
  conflict_group text,
  allowed_for_final boolean,
  resolution_id uuid references public.deep_research_run_evidence_resolutions(id) on delete set null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.deep_research_run_section_validations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.deep_research_runs(id) on delete cascade,
  section_key text not null,
  support text not null,
  reason text,
  evidence_count integer,
  top_source_tier text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.deep_research_run_section_evidence_links (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.deep_research_runs(id) on delete cascade,
  section_key text not null,
  evidence_row_id uuid not null references public.deep_research_run_evidence_rows(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists deep_research_run_documents_run_id_idx
  on public.deep_research_run_documents(run_id);

create index if not exists deep_research_run_events_run_id_created_at_idx
  on public.deep_research_run_events(run_id, created_at asc);

create index if not exists deep_research_run_evidence_rows_run_id_idx
  on public.deep_research_run_evidence_rows(run_id);

create index if not exists deep_research_run_evidence_resolutions_run_id_idx
  on public.deep_research_run_evidence_resolutions(run_id);

create index if not exists deep_research_run_section_validations_run_id_idx
  on public.deep_research_run_section_validations(run_id);

create index if not exists deep_research_run_section_evidence_links_run_id_idx
  on public.deep_research_run_section_evidence_links(run_id);

create index if not exists workspace_folders_workspace_id_idx
  on public.workspace_folders(workspace_id);

create index if not exists workspace_documents_workspace_id_idx
  on public.workspace_documents(workspace_id);

create index if not exists workspace_documents_folder_id_idx
  on public.workspace_documents(folder_id);

create index if not exists deep_research_runs_workspace_id_idx
  on public.deep_research_runs(workspace_id);

create index if not exists document_sources_document_external_id_idx
  on public.document_sources(document_external_id);

create index if not exists documents_document_id_idx
  on public.documents ((metadata->>'document_id'));

create index if not exists documents_chunk_index_idx
  on public.documents ((metadata->>'chunk_index'));

create or replace function public.match_documents(
  query_embedding jsonb,
  match_threshold double precision,
  match_count integer,
  selected_document_ids text[] default null
)
returns table (
  id bigint,
  content text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
as $$
  with query_vector as (
    select (
      '[' || array_to_string(array(select jsonb_array_elements_text(query_embedding)), ',') || ']'
    )::vector as embedding
  )
  select
    documents.id,
    documents.content,
    documents.metadata,
    1 - (documents.embedding <=> query_vector.embedding) as similarity
  from public.documents
  cross join query_vector
  where (
    selected_document_ids is null
    or cardinality(selected_document_ids) = 0
    or documents.metadata->>'document_id' = any(selected_document_ids)
  )
  and 1 - (documents.embedding <=> query_vector.embedding) >= match_threshold
  order by documents.embedding <=> query_vector.embedding
  limit match_count;
$$;
`;

export function getPgPool() {
  if (!pool) {
    const connectionString = getDatabaseConnectionString();
    if (!connectionString) {
      throw new Error(
        "Missing SUPABASE_DB_URL or DATABASE_URL for deep research checkpointing.",
      );
    }

    pool = new Pool({
      connectionString,
      max: 5,
      ssl:
        process.env.PGSSLMODE === "disable"
          ? undefined
          : { rejectUnauthorized: false },
    });
  }

  return pool;
}

export async function ensureDeepResearchDatabase() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const pgPool = getPgPool();
      await pgPool.query(deepResearchSetupSql);
    })().catch((error) => {
      ensurePromise = undefined;
      throw error;
    });
  }

  await ensurePromise;
}

import { Pool } from "pg";

import { getDatabaseConnectionString } from "@/lib/deep-research/config";

let pool: Pool | undefined;
let ensurePromise: Promise<void> | undefined;

const deepResearchSetupSql = `
create extension if not exists pgcrypto;

create table if not exists public.deep_research_runs (
  id uuid primary key default gen_random_uuid(),
  thread_id text not null unique,
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

create index if not exists deep_research_run_documents_run_id_idx
  on public.deep_research_run_documents(run_id);

create index if not exists deep_research_run_events_run_id_created_at_idx
  on public.deep_research_run_events(run_id, created_at asc);

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

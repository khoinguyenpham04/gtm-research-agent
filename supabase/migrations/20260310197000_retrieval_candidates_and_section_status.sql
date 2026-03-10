create table if not exists public.research_retrieval_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  source_type text not null check (source_type in ('web', 'document')),
  retriever_type text not null check (retriever_type in ('web_search', 'dense', 'lexical', 'fusion')),
  section_key text not null,
  query_text text not null,
  source_id uuid null references public.research_sources(id) on delete set null,
  document_external_id text null,
  document_chunk_id bigint null,
  title text not null,
  url text null,
  raw_score double precision not null default 0,
  fused_score double precision null,
  rerank_score double precision null,
  selected boolean not null default false,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists research_retrieval_candidates_run_id_created_at_idx
  on public.research_retrieval_candidates (run_id, created_at);

create index if not exists research_retrieval_candidates_run_id_section_key_idx
  on public.research_retrieval_candidates (run_id, section_key);

alter table public.research_report_sections
  add column if not exists status text not null default 'ready';

alter table public.research_report_sections
  add column if not exists status_notes_json jsonb not null default '[]'::jsonb;

create or replace function public.match_run_documents_lexical(
  search_query text,
  match_count int,
  document_ids text[]
)
returns table (
  id bigint,
  content text,
  metadata jsonb,
  rank_score float
)
language sql
as $$
  select
    d.id,
    d.content,
    d.metadata,
    ts_rank_cd(to_tsvector('english', d.content), websearch_to_tsquery('english', search_query)) as rank_score
  from public.documents d
  where d.metadata->>'document_id' = any(document_ids)
    and to_tsvector('english', d.content) @@ websearch_to_tsquery('english', search_query)
  order by rank_score desc
  limit match_count;
$$;

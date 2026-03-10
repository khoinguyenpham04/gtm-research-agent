create table if not exists public.research_evidence (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  source_type text not null check (source_type in ('web', 'document')),
  source_id uuid null references public.research_sources(id) on delete set null,
  document_chunk_id bigint null,
  document_external_id text null,
  section_key text null,
  title text not null,
  url text null,
  excerpt text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists research_evidence_run_id_created_at_idx
  on public.research_evidence (run_id, created_at);

create index if not exists research_evidence_run_id_section_key_idx
  on public.research_evidence (run_id, section_key);

alter table public.research_findings
  add column if not exists contradictions_json jsonb not null default '[]'::jsonb;

create or replace function public.match_run_documents(
  query_embedding vector(1536),
  match_count int,
  document_ids text[]
)
returns table (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
language sql
as $$
  select
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from public.documents d
  where d.metadata->>'document_id' = any(document_ids)
  order by d.embedding <=> query_embedding
  limit match_count;
$$;

create extension if not exists pgcrypto;

create table if not exists public.research_runs (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  objective text null,
  status text not null default 'queued' check (status in ('queued', 'planning', 'searching', 'retrieving', 'drafting', 'completed', 'failed')),
  current_stage text not null default 'plan',
  plan_json jsonb null,
  final_report_markdown text null,
  error_message text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.research_run_documents (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  document_external_id text not null,
  file_name text null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (run_id, document_external_id)
);

create table if not exists public.research_events (
  id bigserial primary key,
  run_id uuid not null references public.research_runs(id) on delete cascade,
  stage text not null,
  event_type text not null,
  message text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.research_sources (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  source_type text not null,
  title text not null,
  url text null,
  snippet text null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.research_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  section_key text not null,
  claim text not null,
  evidence_json jsonb not null,
  confidence text not null,
  status text not null default 'draft',
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.research_report_sections (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  section_key text not null,
  title text not null,
  content_markdown text not null,
  citations_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists research_runs_status_updated_at_idx
  on public.research_runs (status, updated_at desc);

create index if not exists research_events_run_id_created_at_idx
  on public.research_events (run_id, created_at);

create index if not exists research_sources_run_id_created_at_idx
  on public.research_sources (run_id, created_at);

create index if not exists research_findings_run_id_section_key_idx
  on public.research_findings (run_id, section_key);

create index if not exists research_report_sections_run_id_section_key_idx
  on public.research_report_sections (run_id, section_key);

create index if not exists research_run_documents_run_id_idx
  on public.research_run_documents (run_id);

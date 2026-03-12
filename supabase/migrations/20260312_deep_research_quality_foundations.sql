alter table public.deep_research_runs
  add column if not exists planner_type text;

alter table public.deep_research_runs
  add column if not exists report_plan_version integer;

alter table public.deep_research_runs
  add column if not exists report_plan_json jsonb;

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

create index if not exists deep_research_run_evidence_rows_run_id_idx
  on public.deep_research_run_evidence_rows(run_id);

create index if not exists deep_research_run_evidence_resolutions_run_id_idx
  on public.deep_research_run_evidence_resolutions(run_id);

create index if not exists deep_research_run_section_validations_run_id_idx
  on public.deep_research_run_section_validations(run_id);

create index if not exists deep_research_run_section_evidence_links_run_id_idx
  on public.deep_research_run_section_evidence_links(run_id);

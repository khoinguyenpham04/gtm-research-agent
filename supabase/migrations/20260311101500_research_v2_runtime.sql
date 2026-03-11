alter table public.research_runs
  add column if not exists engine_version text not null default 'v2'
    check (engine_version in ('v1', 'v2')),
  add column if not exists internal_stage text null,
  add column if not exists loop_iteration integer not null default 0,
  add column if not exists awaiting_clarification boolean not null default false,
  add column if not exists clarification_question text null,
  add column if not exists last_progress_at timestamptz null,
  add column if not exists workflow_state_json jsonb null;

update public.research_runs
set
  engine_version = coalesce(engine_version, 'v2'),
  internal_stage = coalesce(internal_stage, current_stage),
  loop_iteration = coalesce(loop_iteration, 0),
  awaiting_clarification = coalesce(awaiting_clarification, false),
  last_progress_at = coalesce(last_progress_at, updated_at);

create index if not exists research_runs_engine_status_updated_at_idx
  on public.research_runs (engine_version, status, updated_at desc);

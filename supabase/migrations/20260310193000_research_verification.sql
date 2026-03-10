alter table public.research_runs
  drop constraint if exists research_runs_status_check;

alter table public.research_runs
  add constraint research_runs_status_check
  check (status in ('queued', 'planning', 'searching', 'retrieving', 'drafting', 'verifying', 'completed', 'failed'));

alter table public.research_findings
  add column if not exists verification_notes text null,
  add column if not exists gaps_json jsonb not null default '[]'::jsonb;

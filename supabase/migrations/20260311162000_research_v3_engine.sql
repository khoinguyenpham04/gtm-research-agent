alter table public.research_runs
  alter column engine_version set default 'v3';

alter table public.research_runs
  drop constraint if exists research_runs_engine_version_check;

alter table public.research_runs
  add constraint research_runs_engine_version_check
  check (engine_version in ('v1', 'v2', 'v3'));

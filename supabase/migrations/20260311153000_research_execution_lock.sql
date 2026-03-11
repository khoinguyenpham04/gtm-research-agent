alter table public.research_runs
  add column if not exists execution_lock_token text;

alter table public.research_runs
  add column if not exists execution_lock_acquired_at timestamptz;

create or replace function public.claim_research_run_execution(
  p_run_id uuid,
  p_token text,
  p_stale_before timestamptz
)
returns boolean
language plpgsql
as $$
begin
  update public.research_runs
  set
    execution_lock_token = p_token,
    execution_lock_acquired_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where id = p_run_id
    and (
      execution_lock_token is null
      or execution_lock_acquired_at is null
      or execution_lock_acquired_at < p_stale_before
    );

  return found;
end;
$$;

create or replace function public.release_research_run_execution(
  p_run_id uuid,
  p_token text
)
returns void
language plpgsql
as $$
begin
  update public.research_runs
  set
    execution_lock_token = null,
    execution_lock_acquired_at = null,
    updated_at = timezone('utc', now())
  where id = p_run_id
    and execution_lock_token = p_token;
end;
$$;

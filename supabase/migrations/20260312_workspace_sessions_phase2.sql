create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

create table if not exists public.session_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  message_type text not null check (message_type in ('deep_research_request', 'chat', 'system_note')),
  content_markdown text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.deep_research_runs
  add column if not exists session_id uuid references public.sessions(id) on delete set null;

alter table public.deep_research_runs
  add column if not exists origin_message_id uuid references public.session_messages(id) on delete set null;

create index if not exists sessions_workspace_id_updated_at_active_idx
  on public.sessions(workspace_id, updated_at desc)
  where archived_at is null;

create index if not exists session_messages_session_id_created_at_idx
  on public.session_messages(session_id, created_at asc);

create index if not exists deep_research_runs_session_id_created_at_idx
  on public.deep_research_runs(session_id, created_at asc);

create unique index if not exists deep_research_runs_origin_message_id_uidx
  on public.deep_research_runs(origin_message_id)
  where origin_message_id is not null;

do $$
declare
  missing_workspace_count integer;
  missing_run_ids text;
  run_row record;
  next_session_id uuid;
  next_message_id uuid;
  message_content text;
begin
  with raw_event_inference as (
    select distinct on (event.run_id)
      event.run_id,
      event.payload_json->>'workspaceId' as workspace_id_text
    from public.deep_research_run_events as event
    where event.payload_json ? 'workspaceId'
      and (event.payload_json->>'workspaceId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    order by event.run_id, event.created_at asc
  ),
  event_inference as (
    select
      raw_event_inference.run_id,
      raw_event_inference.workspace_id_text::uuid as workspace_id
    from raw_event_inference
    join public.workspaces as workspace
      on workspace.id = raw_event_inference.workspace_id_text::uuid
  )
  update public.deep_research_runs as run
  set workspace_id = event_inference.workspace_id
  from event_inference
  where run.id = event_inference.run_id
    and run.workspace_id is null;

  with document_inference as (
    select
      run_document.run_id,
      min(workspace_document.workspace_id::text)::uuid as workspace_id,
      count(distinct workspace_document.workspace_id) as workspace_count
    from public.deep_research_run_documents as run_document
    join public.workspace_documents as workspace_document
      on workspace_document.document_external_id = run_document.document_external_id
    group by run_document.run_id
  )
  update public.deep_research_runs as run
  set workspace_id = document_inference.workspace_id
  from document_inference
  where run.id = document_inference.run_id
    and run.workspace_id is null
    and document_inference.workspace_count = 1;

  select count(*)
  into missing_workspace_count
  from public.deep_research_runs
  where session_id is null
    and workspace_id is null;

  select string_agg(id::text, ', ' order by created_at asc)
  into missing_run_ids
  from (
    select id, created_at
    from public.deep_research_runs
    where session_id is null
      and workspace_id is null
    order by created_at asc, id asc
    limit 10
  ) as missing_runs;

  if missing_workspace_count > 0 then
    raise exception
      'Cannot backfill sessions because % deep_research_runs rows are missing workspace_id. Sample run ids: %',
      missing_workspace_count,
      coalesce(missing_run_ids, 'none');
  end if;

  for run_row in
    select
      id,
      workspace_id,
      topic,
      objective,
      created_at,
      updated_at
    from public.deep_research_runs
    where session_id is null
    order by created_at asc, id asc
  loop
    next_session_id := gen_random_uuid();
    next_message_id := gen_random_uuid();
    message_content := case
      when run_row.objective is null or btrim(run_row.objective) = '' then run_row.topic
      else run_row.topic || E'\n\nObjective: ' || run_row.objective
    end;

    insert into public.sessions (
      id,
      workspace_id,
      title,
      created_at,
      updated_at,
      archived_at
    )
    values (
      next_session_id,
      run_row.workspace_id,
      run_row.topic,
      run_row.created_at,
      greatest(run_row.updated_at, run_row.created_at),
      null
    );

    insert into public.session_messages (
      id,
      session_id,
      role,
      message_type,
      content_markdown,
      metadata_json,
      created_at
    )
    values (
      next_message_id,
      next_session_id,
      'user',
      'deep_research_request',
      message_content,
      jsonb_build_object(
        'objective',
        run_row.objective,
        'backfilledFromRunId',
        run_row.id
      ),
      run_row.created_at
    );

    update public.deep_research_runs
    set session_id = next_session_id,
        origin_message_id = next_message_id
    where id = run_row.id;
  end loop;
end $$;

alter table public.sessions
  add column if not exists clerk_user_id text;

alter table public.deep_research_runs
  add column if not exists clerk_user_id text;

alter table public.document_sources
  add column if not exists clerk_user_id text;

alter table public.documents
  add column if not exists document_external_id text;

alter table public.documents
  add column if not exists clerk_user_id text;

update public.documents
set document_external_id = metadata->>'document_id'
where document_external_id is null
  and metadata ? 'document_id';

update public.sessions as session
set clerk_user_id = workspace.clerk_user_id
from public.workspaces as workspace
where session.workspace_id = workspace.id
  and session.clerk_user_id is null;

update public.deep_research_runs as run
set clerk_user_id = workspace.clerk_user_id
from public.workspaces as workspace
where workspace.id = run.workspace_id
  and run.clerk_user_id is null;

update public.deep_research_runs as run
set clerk_user_id = session.clerk_user_id
from public.sessions as session
where run.session_id = session.id
  and run.clerk_user_id is null;

with generated_report_owners as (
  select
    source.document_external_id,
    run.clerk_user_id
  from public.document_sources as source
  join public.deep_research_runs as run
    on run.id = source.generated_from_run_id
  where source.clerk_user_id is null
    and run.clerk_user_id is not null
),
workspace_document_owners as (
  select
    workspace_document.document_external_id,
    min(workspace.clerk_user_id) as clerk_user_id,
    count(distinct workspace.clerk_user_id) as owner_count
  from public.workspace_documents as workspace_document
  join public.workspaces as workspace
    on workspace.id = workspace_document.workspace_id
  where workspace.clerk_user_id is not null
    and workspace.clerk_user_id <> 'system'
  group by workspace_document.document_external_id
)
update public.document_sources as source
set clerk_user_id = coalesce(
  generated_report_owners.clerk_user_id,
  workspace_document_owners.clerk_user_id
)
from generated_report_owners
full outer join workspace_document_owners
  on workspace_document_owners.document_external_id = generated_report_owners.document_external_id
where source.document_external_id = coalesce(
    generated_report_owners.document_external_id,
    workspace_document_owners.document_external_id
  )
  and source.clerk_user_id is null
  and (
    generated_report_owners.clerk_user_id is not null
    or workspace_document_owners.owner_count = 1
  );

update public.documents as document
set clerk_user_id = source.clerk_user_id
from public.document_sources as source
where document.document_external_id = source.document_external_id
  and document.clerk_user_id is null
  and source.clerk_user_id is not null;

with workspace_document_owners as (
  select
    workspace_document.document_external_id,
    min(workspace.clerk_user_id) as clerk_user_id,
    count(distinct workspace.clerk_user_id) as owner_count
  from public.workspace_documents as workspace_document
  join public.workspaces as workspace
    on workspace.id = workspace_document.workspace_id
  where workspace.clerk_user_id is not null
    and workspace.clerk_user_id <> 'system'
  group by workspace_document.document_external_id
)
update public.documents as document
set clerk_user_id = workspace_document_owners.clerk_user_id
from workspace_document_owners
where document.document_external_id = workspace_document_owners.document_external_id
  and document.clerk_user_id is null
  and workspace_document_owners.owner_count = 1;

delete from public.workspace_documents
where workspace_id in (
  select id
  from public.workspaces
  where clerk_user_id is null
     or clerk_user_id = ''
     or clerk_user_id = 'system'
);

delete from public.deep_research_run_documents
where run_id in (
  select id
  from public.deep_research_runs
  where clerk_user_id is null
     or clerk_user_id = ''
     or clerk_user_id = 'system'
);

delete from public.document_sources
where clerk_user_id is null
   or clerk_user_id = ''
   or clerk_user_id = 'system';

delete from public.documents
where document_external_id is null
   or clerk_user_id is null
   or clerk_user_id = ''
   or clerk_user_id = 'system';

delete from public.deep_research_run_section_evidence_links
where run_id in (
  select id
  from public.deep_research_runs
  where clerk_user_id is null
     or clerk_user_id = ''
     or clerk_user_id = 'system'
);

delete from public.deep_research_run_section_validations
where run_id in (
  select id
  from public.deep_research_runs
  where clerk_user_id is null
     or clerk_user_id = ''
     or clerk_user_id = 'system'
);

delete from public.deep_research_run_evidence_rows
where run_id in (
  select id
  from public.deep_research_runs
  where clerk_user_id is null
     or clerk_user_id = ''
     or clerk_user_id = 'system'
);

delete from public.deep_research_run_evidence_resolutions
where run_id in (
  select id
  from public.deep_research_runs
  where clerk_user_id is null
     or clerk_user_id = ''
     or clerk_user_id = 'system'
);

delete from public.deep_research_run_events
where run_id in (
  select id
  from public.deep_research_runs
  where clerk_user_id is null
     or clerk_user_id = ''
     or clerk_user_id = 'system'
);

delete from public.deep_research_runs
where clerk_user_id is null
   or clerk_user_id = ''
   or clerk_user_id = 'system';

delete from public.sessions
where clerk_user_id is null
   or clerk_user_id = ''
   or clerk_user_id = 'system';

delete from public.workspaces
where clerk_user_id is null
   or clerk_user_id = ''
   or clerk_user_id = 'system';

alter table public.sessions
  alter column clerk_user_id set not null;

alter table public.deep_research_runs
  alter column clerk_user_id set not null;

alter table public.document_sources
  alter column clerk_user_id set not null;

alter table public.documents
  alter column document_external_id set not null;

alter table public.documents
  alter column clerk_user_id set not null;

create index if not exists workspaces_clerk_user_updated_at_idx
  on public.workspaces(clerk_user_id, updated_at desc);

create index if not exists sessions_clerk_user_workspace_updated_at_idx
  on public.sessions(clerk_user_id, workspace_id, updated_at desc);

create index if not exists deep_research_runs_clerk_user_workspace_updated_at_idx
  on public.deep_research_runs(clerk_user_id, workspace_id, updated_at desc);

create index if not exists document_sources_clerk_user_document_id_idx
  on public.document_sources(clerk_user_id, document_external_id);

create index if not exists documents_clerk_user_document_id_idx
  on public.documents(clerk_user_id, document_external_id);

alter table public.workspaces enable row level security;
alter table public.sessions enable row level security;
alter table public.session_messages enable row level security;
alter table public.deep_research_runs enable row level security;
alter table public.deep_research_run_documents enable row level security;
alter table public.deep_research_run_events enable row level security;
alter table public.deep_research_run_evidence_rows enable row level security;
alter table public.deep_research_run_evidence_resolutions enable row level security;
alter table public.deep_research_run_section_evidence_links enable row level security;
alter table public.deep_research_run_section_validations enable row level security;
alter table public.workspace_documents enable row level security;
alter table public.workspace_folders enable row level security;
alter table public.document_sources enable row level security;
alter table public.documents enable row level security;

drop policy if exists "Users manage own workspaces" on public.workspaces;
drop policy if exists "Users manage own sessions" on public.sessions;
drop policy if exists "Users manage own session messages" on public.session_messages;
drop policy if exists "Users manage own deep research runs" on public.deep_research_runs;
drop policy if exists "Users manage own workspace documents" on public.workspace_documents;
drop policy if exists "Users manage own workspace folders" on public.workspace_folders;

drop policy if exists "workspaces_select_own" on public.workspaces;
drop policy if exists "workspaces_insert_own" on public.workspaces;
drop policy if exists "workspaces_update_own" on public.workspaces;
drop policy if exists "workspaces_delete_own" on public.workspaces;
create policy "workspaces_select_own" on public.workspaces
  for select using (clerk_user_id = (auth.jwt()->>'sub'));
create policy "workspaces_insert_own" on public.workspaces
  for insert with check (clerk_user_id = (auth.jwt()->>'sub'));
create policy "workspaces_update_own" on public.workspaces
  for update using (clerk_user_id = (auth.jwt()->>'sub'))
  with check (clerk_user_id = (auth.jwt()->>'sub'));
create policy "workspaces_delete_own" on public.workspaces
  for delete using (clerk_user_id = (auth.jwt()->>'sub'));

drop policy if exists "sessions_select_own" on public.sessions;
drop policy if exists "sessions_insert_own" on public.sessions;
drop policy if exists "sessions_update_own" on public.sessions;
drop policy if exists "sessions_delete_own" on public.sessions;
create policy "sessions_select_own" on public.sessions
  for select using (clerk_user_id = (auth.jwt()->>'sub'));
create policy "sessions_insert_own" on public.sessions
  for insert with check (clerk_user_id = (auth.jwt()->>'sub'));
create policy "sessions_update_own" on public.sessions
  for update using (clerk_user_id = (auth.jwt()->>'sub'))
  with check (clerk_user_id = (auth.jwt()->>'sub'));
create policy "sessions_delete_own" on public.sessions
  for delete using (clerk_user_id = (auth.jwt()->>'sub'));

drop policy if exists "session_messages_select_own" on public.session_messages;
drop policy if exists "session_messages_insert_own" on public.session_messages;
drop policy if exists "session_messages_update_own" on public.session_messages;
drop policy if exists "session_messages_delete_own" on public.session_messages;
create policy "session_messages_select_own" on public.session_messages
  for select using (
    exists (
      select 1
      from public.sessions
      where sessions.id = session_messages.session_id
        and sessions.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "session_messages_insert_own" on public.session_messages
  for insert with check (
    exists (
      select 1
      from public.sessions
      where sessions.id = session_messages.session_id
        and sessions.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "session_messages_update_own" on public.session_messages
  for update using (
    exists (
      select 1
      from public.sessions
      where sessions.id = session_messages.session_id
        and sessions.clerk_user_id = (auth.jwt()->>'sub')
    )
  )
  with check (
    exists (
      select 1
      from public.sessions
      where sessions.id = session_messages.session_id
        and sessions.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "session_messages_delete_own" on public.session_messages
  for delete using (
    exists (
      select 1
      from public.sessions
      where sessions.id = session_messages.session_id
        and sessions.clerk_user_id = (auth.jwt()->>'sub')
    )
  );

drop policy if exists "runs_select_own" on public.deep_research_runs;
drop policy if exists "runs_insert_own" on public.deep_research_runs;
drop policy if exists "runs_update_own" on public.deep_research_runs;
drop policy if exists "runs_delete_own" on public.deep_research_runs;
create policy "runs_select_own" on public.deep_research_runs
  for select using (clerk_user_id = (auth.jwt()->>'sub'));
create policy "runs_insert_own" on public.deep_research_runs
  for insert with check (clerk_user_id = (auth.jwt()->>'sub'));
create policy "runs_update_own" on public.deep_research_runs
  for update using (clerk_user_id = (auth.jwt()->>'sub'))
  with check (clerk_user_id = (auth.jwt()->>'sub'));
create policy "runs_delete_own" on public.deep_research_runs
  for delete using (clerk_user_id = (auth.jwt()->>'sub'));

drop policy if exists "run_documents_select_own" on public.deep_research_run_documents;
drop policy if exists "run_documents_insert_own" on public.deep_research_run_documents;
drop policy if exists "run_documents_update_own" on public.deep_research_run_documents;
drop policy if exists "run_documents_delete_own" on public.deep_research_run_documents;
create policy "run_documents_select_own" on public.deep_research_run_documents
  for select using (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_documents.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "run_documents_insert_own" on public.deep_research_run_documents
  for insert with check (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_documents.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "run_documents_update_own" on public.deep_research_run_documents
  for update using (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_documents.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  )
  with check (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_documents.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "run_documents_delete_own" on public.deep_research_run_documents
  for delete using (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_documents.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );

drop policy if exists "run_events_select_own" on public.deep_research_run_events;
drop policy if exists "run_events_insert_own" on public.deep_research_run_events;
drop policy if exists "run_events_update_own" on public.deep_research_run_events;
drop policy if exists "run_events_delete_own" on public.deep_research_run_events;
create policy "run_events_select_own" on public.deep_research_run_events
  for select using (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_events.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "run_events_insert_own" on public.deep_research_run_events
  for insert with check (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_events.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "run_events_update_own" on public.deep_research_run_events
  for update using (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_events.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  )
  with check (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_events.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "run_events_delete_own" on public.deep_research_run_events
  for delete using (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_events.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );

drop policy if exists "evidence_rows_select_own" on public.deep_research_run_evidence_rows;
drop policy if exists "evidence_rows_insert_own" on public.deep_research_run_evidence_rows;
drop policy if exists "evidence_rows_update_own" on public.deep_research_run_evidence_rows;
drop policy if exists "evidence_rows_delete_own" on public.deep_research_run_evidence_rows;
create policy "evidence_rows_select_own" on public.deep_research_run_evidence_rows
  for select using (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_evidence_rows.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "evidence_rows_insert_own" on public.deep_research_run_evidence_rows
  for insert with check (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_evidence_rows.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "evidence_rows_update_own" on public.deep_research_run_evidence_rows
  for update using (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_evidence_rows.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  )
  with check (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_evidence_rows.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "evidence_rows_delete_own" on public.deep_research_run_evidence_rows
  for delete using (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_evidence_rows.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );

drop policy if exists "evidence_resolutions_select_own" on public.deep_research_run_evidence_resolutions;
drop policy if exists "evidence_resolutions_insert_own" on public.deep_research_run_evidence_resolutions;
drop policy if exists "evidence_resolutions_update_own" on public.deep_research_run_evidence_resolutions;
drop policy if exists "evidence_resolutions_delete_own" on public.deep_research_run_evidence_resolutions;
create policy "evidence_resolutions_select_own" on public.deep_research_run_evidence_resolutions
  for select using (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_evidence_resolutions.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "evidence_resolutions_insert_own" on public.deep_research_run_evidence_resolutions
  for insert with check (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_evidence_resolutions.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "evidence_resolutions_update_own" on public.deep_research_run_evidence_resolutions
  for update using (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_evidence_resolutions.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  )
  with check (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_evidence_resolutions.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "evidence_resolutions_delete_own" on public.deep_research_run_evidence_resolutions
  for delete using (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_evidence_resolutions.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );

drop policy if exists "section_links_select_own" on public.deep_research_run_section_evidence_links;
drop policy if exists "section_links_insert_own" on public.deep_research_run_section_evidence_links;
drop policy if exists "section_links_update_own" on public.deep_research_run_section_evidence_links;
drop policy if exists "section_links_delete_own" on public.deep_research_run_section_evidence_links;
create policy "section_links_select_own" on public.deep_research_run_section_evidence_links
  for select using (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_section_evidence_links.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "section_links_insert_own" on public.deep_research_run_section_evidence_links
  for insert with check (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_section_evidence_links.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "section_links_update_own" on public.deep_research_run_section_evidence_links
  for update using (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_section_evidence_links.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  )
  with check (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_section_evidence_links.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "section_links_delete_own" on public.deep_research_run_section_evidence_links
  for delete using (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_section_evidence_links.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );

drop policy if exists "section_validations_select_own" on public.deep_research_run_section_validations;
drop policy if exists "section_validations_insert_own" on public.deep_research_run_section_validations;
drop policy if exists "section_validations_update_own" on public.deep_research_run_section_validations;
drop policy if exists "section_validations_delete_own" on public.deep_research_run_section_validations;
create policy "section_validations_select_own" on public.deep_research_run_section_validations
  for select using (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_section_validations.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "section_validations_insert_own" on public.deep_research_run_section_validations
  for insert with check (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_section_validations.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "section_validations_update_own" on public.deep_research_run_section_validations
  for update using (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_section_validations.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  )
  with check (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_section_validations.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "section_validations_delete_own" on public.deep_research_run_section_validations
  for delete using (
    exists (
      select 1
      from public.deep_research_runs
      where deep_research_runs.id = deep_research_run_section_validations.run_id
        and deep_research_runs.clerk_user_id = (auth.jwt()->>'sub')
    )
  );

drop policy if exists "workspace_documents_select_own" on public.workspace_documents;
drop policy if exists "workspace_documents_insert_own" on public.workspace_documents;
drop policy if exists "workspace_documents_update_own" on public.workspace_documents;
drop policy if exists "workspace_documents_delete_own" on public.workspace_documents;
create policy "workspace_documents_select_own" on public.workspace_documents
  for select using (
    exists (
      select 1
      from public.workspaces
      where workspaces.id = workspace_documents.workspace_id
        and workspaces.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "workspace_documents_insert_own" on public.workspace_documents
  for insert with check (
    exists (
      select 1
      from public.workspaces
      where workspaces.id = workspace_documents.workspace_id
        and workspaces.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "workspace_documents_update_own" on public.workspace_documents
  for update using (
    exists (
      select 1
      from public.workspaces
      where workspaces.id = workspace_documents.workspace_id
        and workspaces.clerk_user_id = (auth.jwt()->>'sub')
    )
  )
  with check (
    exists (
      select 1
      from public.workspaces
      where workspaces.id = workspace_documents.workspace_id
        and workspaces.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "workspace_documents_delete_own" on public.workspace_documents
  for delete using (
    exists (
      select 1
      from public.workspaces
      where workspaces.id = workspace_documents.workspace_id
        and workspaces.clerk_user_id = (auth.jwt()->>'sub')
    )
  );

drop policy if exists "workspace_folders_select_own" on public.workspace_folders;
drop policy if exists "workspace_folders_insert_own" on public.workspace_folders;
drop policy if exists "workspace_folders_update_own" on public.workspace_folders;
drop policy if exists "workspace_folders_delete_own" on public.workspace_folders;
create policy "workspace_folders_select_own" on public.workspace_folders
  for select using (
    exists (
      select 1
      from public.workspaces
      where workspaces.id = workspace_folders.workspace_id
        and workspaces.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "workspace_folders_insert_own" on public.workspace_folders
  for insert with check (
    exists (
      select 1
      from public.workspaces
      where workspaces.id = workspace_folders.workspace_id
        and workspaces.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "workspace_folders_update_own" on public.workspace_folders
  for update using (
    exists (
      select 1
      from public.workspaces
      where workspaces.id = workspace_folders.workspace_id
        and workspaces.clerk_user_id = (auth.jwt()->>'sub')
    )
  )
  with check (
    exists (
      select 1
      from public.workspaces
      where workspaces.id = workspace_folders.workspace_id
        and workspaces.clerk_user_id = (auth.jwt()->>'sub')
    )
  );
create policy "workspace_folders_delete_own" on public.workspace_folders
  for delete using (
    exists (
      select 1
      from public.workspaces
      where workspaces.id = workspace_folders.workspace_id
        and workspaces.clerk_user_id = (auth.jwt()->>'sub')
    )
  );

drop policy if exists "document_sources_select_own" on public.document_sources;
drop policy if exists "document_sources_insert_own" on public.document_sources;
drop policy if exists "document_sources_update_own" on public.document_sources;
drop policy if exists "document_sources_delete_own" on public.document_sources;
create policy "document_sources_select_own" on public.document_sources
  for select using (clerk_user_id = (auth.jwt()->>'sub'));
create policy "document_sources_insert_own" on public.document_sources
  for insert with check (clerk_user_id = (auth.jwt()->>'sub'));
create policy "document_sources_update_own" on public.document_sources
  for update using (clerk_user_id = (auth.jwt()->>'sub'))
  with check (clerk_user_id = (auth.jwt()->>'sub'));
create policy "document_sources_delete_own" on public.document_sources
  for delete using (clerk_user_id = (auth.jwt()->>'sub'));

drop policy if exists "documents_select_own" on public.documents;
drop policy if exists "documents_insert_own" on public.documents;
drop policy if exists "documents_update_own" on public.documents;
drop policy if exists "documents_delete_own" on public.documents;
create policy "documents_select_own" on public.documents
  for select using (clerk_user_id = (auth.jwt()->>'sub'));
create policy "documents_insert_own" on public.documents
  for insert with check (clerk_user_id = (auth.jwt()->>'sub'));
create policy "documents_update_own" on public.documents
  for update using (clerk_user_id = (auth.jwt()->>'sub'))
  with check (clerk_user_id = (auth.jwt()->>'sub'));
create policy "documents_delete_own" on public.documents
  for delete using (clerk_user_id = (auth.jwt()->>'sub'));

update storage.buckets
set public = false
where id = 'documents';

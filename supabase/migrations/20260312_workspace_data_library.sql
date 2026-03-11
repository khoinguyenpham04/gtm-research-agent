create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workspace_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  parent_folder_id uuid references public.workspace_folders(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workspace_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_external_id text not null,
  folder_id uuid references public.workspace_folders(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, document_external_id)
);

create table if not exists public.document_sources (
  id uuid primary key default gen_random_uuid(),
  document_external_id text not null unique,
  source_type text not null check (source_type in ('upload', 'agent_download', 'url_ingest')),
  source_url text,
  status text not null default 'ready' check (status in ('ready', 'processing', 'failed')),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.deep_research_runs
  add column if not exists workspace_id uuid references public.workspaces(id) on delete set null;

create index if not exists workspace_folders_workspace_id_idx
  on public.workspace_folders(workspace_id);

create index if not exists workspace_documents_workspace_id_idx
  on public.workspace_documents(workspace_id);

create index if not exists workspace_documents_folder_id_idx
  on public.workspace_documents(folder_id);

create index if not exists deep_research_runs_workspace_id_idx
  on public.deep_research_runs(workspace_id);

create index if not exists document_sources_document_external_id_idx
  on public.document_sources(document_external_id);

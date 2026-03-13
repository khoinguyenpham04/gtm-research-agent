alter table public.document_sources
  add column if not exists generated_from_run_id uuid references public.deep_research_runs(id) on delete set null;

alter table public.document_sources
  drop constraint if exists document_sources_source_type_check;

alter table public.document_sources
  add constraint document_sources_source_type_check
  check (
    source_type in ('upload', 'agent_download', 'url_ingest', 'generated_report')
  );

create unique index if not exists document_sources_generated_from_run_id_idx
  on public.document_sources(generated_from_run_id)
  where generated_from_run_id is not null;

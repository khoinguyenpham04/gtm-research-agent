alter table public.research_findings
  add column if not exists claim_type text not null default 'adoption-signal',
  add column if not exists evidence_mode text not null default 'market-adjacent',
  add column if not exists inference_label text not null default 'speculative';

alter table public.research_findings
  drop constraint if exists research_findings_claim_type_check,
  add constraint research_findings_claim_type_check check (
    claim_type in (
      'market-sizing',
      'adoption-signal',
      'buyer-pain',
      'competitor-feature',
      'pricing',
      'gtm-channel',
      'risk',
      'recommendation-input'
    )
  );

alter table public.research_findings
  drop constraint if exists research_findings_evidence_mode_check,
  add constraint research_findings_evidence_mode_check check (
    evidence_mode in (
      'market-adjacent',
      'product-specific',
      'vendor-primary',
      'independent-validation',
      'document-internal'
    )
  );

alter table public.research_findings
  drop constraint if exists research_findings_inference_label_check,
  add constraint research_findings_inference_label_check check (
    inference_label in ('direct', 'inferred', 'speculative')
  );

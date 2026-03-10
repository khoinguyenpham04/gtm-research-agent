import { END, START, StateGraph } from '@langchain/langgraph';
import {
  listResearchEvidence,
  listLinkedDocuments,
  listResearchFindings,
  listResearchReportSections,
  listResearchRetrievalCandidates,
  listResearchSources,
} from '@/lib/research/repository';
import { runDraftReportNode } from '@/lib/research/nodes/draft-report';
import { runDocumentRetrievalNode } from '@/lib/research/nodes/document-retrieval';
import { runFinalizeNode } from '@/lib/research/nodes/finalize';
import { runPlanNode } from '@/lib/research/nodes/plan';
import { runVerificationNode } from '@/lib/research/nodes/verification';
import { createWebSearchNode } from '@/lib/research/nodes/web-search';
import {
  researchGraphStateSchema,
  type ResearchGraphState,
} from '@/lib/research/schemas';
import { resolveEvidenceSectionKey, resolveSectionKey } from '@/lib/research/section-routing';
import {
  coerceSearchIntent,
  coerceClaimType,
  coerceEvidenceMode,
  coerceSourceCategory,
  coerceSourceQualityLabel,
  coerceSourceRecency,
  coerceVendorPageType,
} from '@/lib/research/source-scoring';
import type { WebSearchService } from '@/lib/research/search';

function toWebSource(
  source: Awaited<ReturnType<typeof listResearchSources>>[number],
) {
  const queryIntent =
    typeof source.metadataJson.queryIntent === 'string'
      ? coerceSearchIntent(source.metadataJson.queryIntent)
      : null;
  const claimType =
    typeof source.metadataJson.claimType === 'string'
      ? coerceClaimType(source.metadataJson.claimType)
      : null;

  return {
    id: source.id,
    sourceType: 'web' as const,
    title: source.title,
    url: source.url,
    snippet: source.snippet ?? '',
    query: typeof source.metadataJson.query === 'string' ? source.metadataJson.query : 'unknown',
    subtopic: typeof source.metadataJson.subtopic === 'string' ? source.metadataJson.subtopic : 'unknown',
    queryIntent: queryIntent ?? 'buyer-pain',
    sectionKey: resolveSectionKey({
      intent: queryIntent,
      subtopic: typeof source.metadataJson.subtopic === 'string' ? source.metadataJson.subtopic : null,
      sectionKey: typeof source.metadataJson.sectionKey === 'string' ? source.metadataJson.sectionKey : null,
      claimType,
    }),
    claimType: claimType ?? 'buyer-pain',
    evidenceMode: coerceEvidenceMode(source.metadataJson.evidenceMode),
    vendorTarget: typeof source.metadataJson.vendorTarget === 'string' ? source.metadataJson.vendorTarget : null,
    vendorPageType: coerceVendorPageType(source.metadataJson.vendorPageType),
    productName:
      typeof source.metadataJson.productName === 'string' ? source.metadataJson.productName : null,
    targetUser:
      typeof source.metadataJson.targetUser === 'string' ? source.metadataJson.targetUser : null,
    coreFeatures: Array.isArray(source.metadataJson.coreFeatures)
      ? source.metadataJson.coreFeatures.filter((value): value is string => typeof value === 'string')
      : [],
    crmIntegrations: Array.isArray(source.metadataJson.crmIntegrations)
      ? source.metadataJson.crmIntegrations.filter((value): value is string => typeof value === 'string')
      : [],
    planPricingText:
      typeof source.metadataJson.planPricingText === 'string'
        ? source.metadataJson.planPricingText
        : null,
    domain: typeof source.metadataJson.domain === 'string' ? source.metadataJson.domain : null,
    sourceCategory: coerceSourceCategory(source.metadataJson.sourceCategory),
    qualityScore:
      typeof source.metadataJson.qualityScore === 'number' ? source.metadataJson.qualityScore : 0,
    qualityLabel: coerceSourceQualityLabel(source.metadataJson.qualityLabel),
    recency: coerceSourceRecency(source.metadataJson.recency),
    publishedYear:
      typeof source.metadataJson.publishedYear === 'number' ? source.metadataJson.publishedYear : null,
    rationale: typeof source.metadataJson.rationale === 'string' ? source.metadataJson.rationale : 'Unscored source.',
    isPrimary: Boolean(source.metadataJson.isPrimary),
  };
}

export function createResearchGraph(searchService: WebSearchService) {
  return new StateGraph(researchGraphStateSchema)
    .addNode('plan_stage', runPlanNode)
    .addNode('web_search_stage', createWebSearchNode(searchService))
    .addNode('document_retrieval_stage', runDocumentRetrievalNode)
    .addNode('draft_report_stage', runDraftReportNode)
    .addNode('verification_stage', runVerificationNode)
    .addNode('finalize_stage', runFinalizeNode)
    .addEdge(START, 'plan_stage')
    .addEdge('plan_stage', 'web_search_stage')
    .addEdge('web_search_stage', 'document_retrieval_stage')
    .addEdge('document_retrieval_stage', 'draft_report_stage')
    .addEdge('draft_report_stage', 'verification_stage')
    .addEdge('verification_stage', 'finalize_stage')
    .addEdge('finalize_stage', END)
    .compile();
}

export async function buildInitialGraphState(runId: string, base: {
  topic: string;
  objective: string | null;
  status: ResearchGraphState['status'];
  currentStage: string;
  planJson: ResearchGraphState['plan'];
  finalReportMarkdown: string | null;
}) {
  const [linkedDocuments, sources, findings, evidence, retrievalCandidates, sections] = await Promise.all([
    listLinkedDocuments(runId),
    listResearchSources(runId),
    listResearchFindings(runId),
    listResearchEvidence(runId),
    listResearchRetrievalCandidates(runId),
    listResearchReportSections(runId),
  ]);

  return {
    runId,
    topic: base.topic,
    objective: base.objective ?? undefined,
    selectedDocumentIds: linkedDocuments.map((document) => document.documentExternalId),
    linkedDocuments,
    plan: base.planJson,
    webSources: sources.filter((source) => source.sourceType === 'web').map(toWebSource),
    retrievalCandidates,
    evidenceRecords: evidence,
    documentContext: evidence
      .filter((record) => record.sourceType === 'document')
      .map((record) => ({
        evidenceId: record.id,
        documentExternalId: record.documentExternalId ?? 'unknown-document',
        fileName:
          typeof record.metadataJson.fileName === 'string' ? record.metadataJson.fileName : record.title,
        summary: record.excerpt,
        sectionKey: resolveEvidenceSectionKey(record),
        documentChunkId: record.documentChunkId ?? undefined,
        similarity:
          typeof record.metadataJson.similarity === 'number' ? record.metadataJson.similarity : null,
      })),
    findings: findings.map((finding) => ({
      sectionKey: resolveSectionKey({
        sectionKey: finding.sectionKey,
        claimType: finding.claimType,
      }),
      claimType: finding.claimType,
      claim: finding.claim,
      evidence: finding.evidenceJson,
      evidenceMode: finding.evidenceMode,
      inferenceLabel: finding.inferenceLabel,
      confidence: finding.confidence,
      status: finding.status as ResearchGraphState['findings'][number]['status'],
      verificationNotes: finding.verificationNotes,
      gaps: finding.gapsJson,
      contradictions: finding.contradictionsJson,
    })),
    reportSections: sections.map((section) => ({
      sectionKey: section.sectionKey,
      title: section.title,
      contentMarkdown: section.contentMarkdown,
      citations: section.citationsJson,
      status: section.status,
      statusNotes: section.statusNotesJson,
    })),
    keyTakeaways: [],
    competitorMatrix: [],
    finalReportMarkdown: base.finalReportMarkdown,
    status: base.status,
    currentStage: base.currentStage,
  } satisfies ResearchGraphState;
}

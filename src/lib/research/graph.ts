import { END, START, StateGraph } from '@langchain/langgraph';
import {
  listLinkedDocuments,
  listResearchFindings,
  listResearchReportSections,
  listResearchSources,
} from '@/lib/research/repository';
import { runDraftReportNode } from '@/lib/research/nodes/draft-report';
import { runFinalizeNode } from '@/lib/research/nodes/finalize';
import { runMockDocumentRetrievalNode } from '@/lib/research/nodes/mock-document-retrieval';
import { runPlanNode } from '@/lib/research/nodes/plan';
import { runVerificationNode } from '@/lib/research/nodes/verification';
import { createWebSearchNode } from '@/lib/research/nodes/web-search';
import {
  researchGraphStateSchema,
  type ResearchGraphState,
} from '@/lib/research/schemas';
import {
  coerceSourceCategory,
  coerceSourceQualityLabel,
  coerceSourceRecency,
} from '@/lib/research/source-scoring';
import type { WebSearchService } from '@/lib/research/search';

function toWebSource(
  source: Awaited<ReturnType<typeof listResearchSources>>[number],
) {
  return {
    id: source.id,
    sourceType: 'web' as const,
    title: source.title,
    url: source.url,
    snippet: source.snippet ?? '',
    query: typeof source.metadataJson.query === 'string' ? source.metadataJson.query : 'unknown',
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
    .addNode('mock_document_retrieval_stage', runMockDocumentRetrievalNode)
    .addNode('draft_report_stage', runDraftReportNode)
    .addNode('verification_stage', runVerificationNode)
    .addNode('finalize_stage', runFinalizeNode)
    .addEdge(START, 'plan_stage')
    .addEdge('plan_stage', 'web_search_stage')
    .addEdge('web_search_stage', 'mock_document_retrieval_stage')
    .addEdge('mock_document_retrieval_stage', 'draft_report_stage')
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
  const [linkedDocuments, sources, findings, sections] = await Promise.all([
    listLinkedDocuments(runId),
    listResearchSources(runId),
    listResearchFindings(runId),
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
    documentContext: sources
      .filter((source) => source.sourceType === 'document_mock')
      .map((source) => ({
        documentExternalId:
          typeof source.metadataJson.documentExternalId === 'string'
            ? source.metadataJson.documentExternalId
            : source.id,
        fileName: typeof source.metadataJson.fileName === 'string' ? source.metadataJson.fileName : null,
        summary: source.snippet ?? 'Document linked for future retrieval.',
      })),
    findings: findings.map((finding) => ({
      sectionKey: finding.sectionKey,
      claim: finding.claim,
      evidence: finding.evidenceJson,
      confidence: finding.confidence,
      status: finding.status as ResearchGraphState['findings'][number]['status'],
      verificationNotes: finding.verificationNotes,
      gaps: finding.gapsJson,
    })),
    reportSections: sections.map((section) => ({
      sectionKey: section.sectionKey,
      title: section.title,
      contentMarkdown: section.contentMarkdown,
      citations: section.citationsJson,
    })),
    finalReportMarkdown: base.finalReportMarkdown,
    status: base.status,
    currentStage: base.currentStage,
  } satisfies ResearchGraphState;
}

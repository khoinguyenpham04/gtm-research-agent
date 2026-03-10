import {
  appendResearchEvent,
  clearResearchSources,
  hasStageCompleted,
  listResearchSources,
  saveResearchSources,
  setRunStage,
} from '@/lib/research/repository';
import type { DocumentContext, ResearchGraphState } from '@/lib/research/schemas';

export async function runMockDocumentRetrievalNode(state: ResearchGraphState) {
  console.info(`[research:${state.runId}] stage_start`, { stage: 'mock_document_retrieval' });

  if (await hasStageCompleted(state.runId, 'mock_document_retrieval')) {
    const persistedSources = await listResearchSources(state.runId);
    const mockSources = persistedSources.filter((source) => source.sourceType === 'document_mock');

    return {
      status: state.status,
      currentStage: state.currentStage,
      documentContext: mockSources.map((source) => ({
        documentExternalId:
          typeof source.metadataJson.documentExternalId === 'string'
            ? source.metadataJson.documentExternalId
            : source.id,
        fileName: typeof source.metadataJson.fileName === 'string' ? source.metadataJson.fileName : null,
        summary: source.snippet ?? 'Document linked for future retrieval.',
      })),
    };
  }

  await setRunStage(state.runId, 'retrieving', 'mock_document_retrieval');
  await appendResearchEvent(
    state.runId,
    'mock_document_retrieval',
    'stage_started',
    'Loading linked documents. Retrieval is mocked in this slice.',
  );

  const context: DocumentContext[] = state.linkedDocuments.map((document) => ({
    documentExternalId: document.documentExternalId,
    fileName: document.fileName,
    summary: document.fileName
      ? `Mocked retrieval placeholder for ${document.fileName}.`
      : `Mocked retrieval placeholder for document ${document.documentExternalId}.`,
  }));

  await clearResearchSources(state.runId, 'document_mock');

  if (context.length > 0) {
    await saveResearchSources(
      state.runId,
      context.map((document) => ({
        sourceType: 'document_mock',
        title: document.fileName ?? `Document ${document.documentExternalId}`,
        url: null,
        snippet: document.summary,
        metadataJson: {
          documentExternalId: document.documentExternalId,
          fileName: document.fileName,
        },
      })),
    );
  }

  await appendResearchEvent(
    state.runId,
    'mock_document_retrieval',
    'stage_completed',
    context.length > 0
      ? `Linked ${context.length} document${context.length === 1 ? '' : 's'} for mocked retrieval.`
      : 'No linked documents were provided. Mock retrieval skipped.',
    {
      documentCount: context.length,
      mocked: true,
    },
  );
  console.info(`[research:${state.runId}] stage_complete`, {
    stage: 'mock_document_retrieval',
    documentCount: context.length,
  });

  return {
    status: 'retrieving' as const,
    currentStage: 'mock_document_retrieval',
    documentContext: context,
  };
}

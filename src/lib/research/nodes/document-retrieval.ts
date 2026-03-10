import OpenAI from 'openai';
import { createSupabaseServerClient } from '@/lib/supabase';
import {
  appendResearchEvent,
  clearResearchEvidence,
  clearResearchSources,
  hasStageCompleted,
  listResearchEvidence,
  saveResearchEvidence,
  saveResearchSources,
  setRunStage,
} from '@/lib/research/repository';
import type { DocumentContext, ResearchGraphState } from '@/lib/research/schemas';

const openai = new OpenAI();

const retrievalSections = [
  {
    key: 'market-landscape',
    title: 'Market Landscape',
    description: 'Market structure, demand signals, adoption context, and broader industry dynamics.',
  },
  {
    key: 'icp-and-buyer',
    title: 'ICP and Buyer',
    description: 'Buyer pains, team workflows, operational bottlenecks, and purchase drivers.',
  },
  {
    key: 'competitor-landscape',
    title: 'Competitor Landscape',
    description: 'Competitor products, differentiators, features, and target users.',
  },
  {
    key: 'pricing-and-packaging',
    title: 'Pricing and Packaging',
    description: 'Pricing models, plan structure, packaging assumptions, and commercial constraints.',
  },
  {
    key: 'gtm-motion',
    title: 'GTM Motion',
    description: 'Channel strategy, buyer journey, adoption triggers, and market-entry motion.',
  },
  {
    key: 'risks-and-unknowns',
    title: 'Risks and Unknowns',
    description: 'Risks, open questions, evidence gaps, and factors that could invalidate conclusions.',
  },
  {
    key: 'recommendation',
    title: 'Recommendation',
    description: 'Winning wedge, differentiation path, and most likely market-entry posture.',
  },
] as const;

interface DocumentMatchRow {
  id: number;
  content: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
}

function buildRetrievalPrompt(state: ResearchGraphState, section: (typeof retrievalSections)[number]) {
  return [
    `Topic: ${state.topic}`,
    `Objective: ${state.objective ?? 'Not provided.'}`,
    `Section: ${section.title}`,
    `Section focus: ${section.description}`,
    `Linked documents: ${state.linkedDocuments.map((document) => document.fileName ?? document.documentExternalId).join(', ')}`,
  ].join('\n');
}

function toDocumentContext(evidenceRecords: Awaited<ReturnType<typeof listResearchEvidence>>) {
  return evidenceRecords
    .filter((record) => record.sourceType === 'document')
    .map((record) => ({
      evidenceId: record.id,
      documentExternalId: record.documentExternalId ?? 'unknown-document',
      fileName:
        typeof record.metadataJson.fileName === 'string' ? record.metadataJson.fileName : record.title,
      summary: record.excerpt,
      sectionKey: record.sectionKey ?? undefined,
      documentChunkId: record.documentChunkId,
      similarity:
        typeof record.metadataJson.similarity === 'number' ? record.metadataJson.similarity : null,
    }))
    .slice(0, 18) satisfies DocumentContext[];
}

export async function runDocumentRetrievalNode(state: ResearchGraphState) {
  console.info(`[research:${state.runId}] stage_start`, { stage: 'document_retrieval' });

  if (await hasStageCompleted(state.runId, 'document_retrieval')) {
    const evidence = await listResearchEvidence(state.runId);

    return {
      status: state.status,
      currentStage: state.currentStage,
      evidenceRecords: evidence,
      documentContext: toDocumentContext(evidence),
    };
  }

  await setRunStage(state.runId, 'retrieving', 'document_retrieval');
  await appendResearchEvent(
    state.runId,
    'document_retrieval',
    'stage_started',
    'Retrieving evidence from linked documents.',
  );

  await clearResearchSources(state.runId, 'document');
  await clearResearchEvidence(state.runId, 'document');

  if (state.linkedDocuments.length === 0) {
    await appendResearchEvent(
      state.runId,
      'document_retrieval',
      'stage_completed',
      'No linked documents were provided. Document retrieval skipped.',
      {
        documentCount: 0,
        evidenceCount: 0,
      },
    );

    return {
      status: 'retrieving' as const,
      currentStage: 'document_retrieval',
      documentContext: [],
      evidenceRecords: state.evidenceRecords.filter((record) => record.sourceType !== 'document'),
    };
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error('Missing OPENAI_API_KEY.');
  }

  const persistedDocumentSources = await saveResearchSources(
    state.runId,
    state.linkedDocuments.map((document) => ({
      sourceType: 'document',
      title: document.fileName ?? `Document ${document.documentExternalId}`,
      url: null,
      snippet: null,
      metadataJson: {
        documentExternalId: document.documentExternalId,
        fileName: document.fileName,
      },
    })),
  );

  const sourceIdByDocument = new Map(
    state.linkedDocuments.map((document, index) => [document.documentExternalId, persistedDocumentSources[index]?.id ?? null]),
  );

  const supabase = createSupabaseServerClient();
  const evidenceInputs: Parameters<typeof saveResearchEvidence>[1] = [];

  for (const section of retrievalSections) {
    const embedding = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: buildRetrievalPrompt(state, section),
    });

    const { data, error } = await supabase.rpc('match_run_documents', {
      query_embedding: JSON.stringify(embedding.data[0].embedding),
      match_count: 3,
      document_ids: state.selectedDocumentIds,
    });

    if (error) {
      throw new Error(error.message);
    }

    const matches = (data ?? []) as DocumentMatchRow[];

    for (const match of matches) {
      const metadata = match.metadata ?? {};
      const documentExternalId =
        typeof metadata.document_id === 'string' ? metadata.document_id : null;
      const fileName = typeof metadata.file_name === 'string' ? metadata.file_name : null;

      evidenceInputs.push({
        sourceType: 'document',
        sourceId: documentExternalId ? sourceIdByDocument.get(documentExternalId) ?? null : null,
        documentChunkId: match.id,
        documentExternalId,
        sectionKey: section.key,
        title: fileName ?? `Document chunk ${match.id}`,
        url: typeof metadata.file_url === 'string' ? metadata.file_url : null,
        excerpt: match.content,
        metadataJson: {
          fileName,
          chunkIndex: typeof metadata.chunk_index === 'number' ? metadata.chunk_index : null,
          similarity: Number(match.similarity.toFixed(4)),
          qualityScore: 0.84,
          sourceCategory: 'research',
          usedInSynthesis: true,
        },
      });
    }
  }

  const persistedEvidence = await saveResearchEvidence(state.runId, evidenceInputs);
  const allEvidence = await listResearchEvidence(state.runId);
  const documentContext = toDocumentContext(allEvidence);

  await appendResearchEvent(
    state.runId,
    'document_retrieval',
    'stage_completed',
    `Retrieved ${persistedEvidence.length} document evidence chunk${persistedEvidence.length === 1 ? '' : 's'} across ${state.linkedDocuments.length} linked document${state.linkedDocuments.length === 1 ? '' : 's'}.`,
    {
      documentCount: state.linkedDocuments.length,
      evidenceCount: persistedEvidence.length,
    },
  );
  console.info(`[research:${state.runId}] stage_complete`, {
    stage: 'document_retrieval',
    documentCount: state.linkedDocuments.length,
    evidenceCount: persistedEvidence.length,
  });

  return {
    status: 'retrieving' as const,
    currentStage: 'document_retrieval',
    evidenceRecords: allEvidence,
    documentContext,
  };
}

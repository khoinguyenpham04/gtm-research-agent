import {
  coerceSearchIntent,
  coerceSourceCategory,
  coerceSourceQualityLabel,
  coerceSourceRecency,
  shouldUseSourceInSynthesis,
} from '@/lib/research/source-scoring';
import {
  appendResearchEvent,
  clearResearchEvidence,
  clearResearchRetrievalCandidates,
  clearResearchSources,
  hasStageCompleted,
  listResearchEvidence,
  listResearchRetrievalCandidates,
  listResearchSources,
  saveResearchEvidence,
  saveResearchRetrievalCandidates,
  saveResearchSources,
  setRunStage,
} from '@/lib/research/repository';
import { searchIntentToSectionKey } from '@/lib/research/section-policy';
import type { ResearchGraphState } from '@/lib/research/schemas';
import type { WebSearchService } from '@/lib/research/search';

export function createWebSearchNode(searchService: WebSearchService) {
  return async function runWebSearchNode(state: ResearchGraphState) {
    console.info(`[research:${state.runId}] stage_start`, { stage: 'web_search' });

    if (!state.plan) {
      throw new Error('Cannot search the web before planning.');
    }

    if (await hasStageCompleted(state.runId, 'web_search')) {
      const [persistedSources, evidence] = await Promise.all([
        listResearchSources(state.runId),
        listResearchEvidence(state.runId),
      ]);
      const candidates = await listResearchRetrievalCandidates(state.runId);
      const webSources = persistedSources
        .filter((source) => source.sourceType === 'web')
        .map((source) => ({
          id: source.id,
          sourceType: 'web' as const,
          title: source.title,
          url: source.url,
          snippet: source.snippet ?? '',
          query: typeof source.metadataJson.query === 'string' ? source.metadataJson.query : 'unknown',
          queryIntent: coerceSearchIntent(source.metadataJson.queryIntent),
          domain: typeof source.metadataJson.domain === 'string' ? source.metadataJson.domain : null,
          sourceCategory: coerceSourceCategory(source.metadataJson.sourceCategory),
          qualityScore:
            typeof source.metadataJson.qualityScore === 'number' ? source.metadataJson.qualityScore : 0,
          qualityLabel: coerceSourceQualityLabel(source.metadataJson.qualityLabel),
          recency: coerceSourceRecency(source.metadataJson.recency),
          publishedYear:
            typeof source.metadataJson.publishedYear === 'number' ? source.metadataJson.publishedYear : null,
          rationale:
            typeof source.metadataJson.rationale === 'string'
              ? source.metadataJson.rationale
              : 'Unscored source.',
          isPrimary: Boolean(source.metadataJson.isPrimary),
        }));

      return {
        status: state.status,
        currentStage: state.currentStage,
        webSources,
        evidenceRecords: evidence,
        retrievalCandidates: candidates,
      };
    }

    await setRunStage(state.runId, 'searching', 'web_search');
    await appendResearchEvent(state.runId, 'web_search', 'stage_started', 'Searching the web.');

    for (const query of state.plan.searchQueries) {
      await appendResearchEvent(
        state.runId,
        'web_search',
        'query_started',
        `Searching for "${query.query}".`,
        {
          query: query.query,
          intent: query.intent,
          sourcePreference: query.sourcePreference,
        },
      );
    }

    await clearResearchSources(state.runId, 'web');
    await clearResearchEvidence(state.runId, 'web');
    await clearResearchRetrievalCandidates(state.runId, { sourceType: 'web' });
    const searchResults = await searchService.searchMany(state.plan.searchQueries);
    const persistedSources = await saveResearchSources(
      state.runId,
      searchResults.map((source) => ({
        sourceType: 'web',
        title: source.title,
        url: source.url,
        snippet: source.snippet,
        metadataJson: {
          query: source.query,
          queryIntent: source.queryIntent,
          domain: source.domain,
          sourceCategory: source.sourceCategory,
          qualityScore: source.qualityScore,
          qualityLabel: source.qualityLabel,
          recency: source.recency,
          publishedYear: source.publishedYear,
          rationale: source.rationale,
          isPrimary: source.isPrimary,
          usedInSynthesis: shouldUseSourceInSynthesis(source),
        },
      })),
    );
    const persistedEvidence = await saveResearchEvidence(
      state.runId,
      persistedSources.map((source) => ({
        sourceType: 'web',
        sourceId: source.id,
        sectionKey: searchIntentToSectionKey[source.metadataJson.queryIntent as keyof typeof searchIntentToSectionKey] ?? null,
        title: source.title,
        url: source.url,
        excerpt: source.snippet ?? '',
        metadataJson: source.metadataJson,
      })),
    );
    const persistedCandidates = await saveResearchRetrievalCandidates(
      state.runId,
      persistedSources.map((source) => ({
        sourceType: 'web',
        retrieverType: 'web_search',
        sectionKey:
          searchIntentToSectionKey[
            (typeof source.metadataJson.queryIntent === 'string'
              ? source.metadataJson.queryIntent
              : 'buyer-pain') as keyof typeof searchIntentToSectionKey
          ],
        query: typeof source.metadataJson.query === 'string' ? source.metadataJson.query : 'unknown',
        sourceId: source.id,
        title: source.title,
        url: source.url,
        rawScore:
          typeof source.metadataJson.qualityScore === 'number' ? source.metadataJson.qualityScore : 0,
        fusedScore:
          typeof source.metadataJson.qualityScore === 'number' ? source.metadataJson.qualityScore : 0,
        selected: Boolean(source.metadataJson.usedInSynthesis),
        metadataJson: source.metadataJson,
      })),
    );

    const highQualityCount = searchResults.filter((source) => source.qualityLabel === 'high').length;
    const gatedCount = searchResults.filter((source) => shouldUseSourceInSynthesis(source)).length;

    await appendResearchEvent(state.runId, 'web_search', 'stage_completed', 'Web search completed.', {
      sourceCount: persistedSources.length,
      highQualityCount,
      gatedCount,
    });
    console.info(`[research:${state.runId}] stage_complete`, {
      stage: 'web_search',
      sourceCount: persistedSources.length,
      highQualityCount,
      gatedCount,
    });

    return {
      status: 'searching' as const,
      currentStage: 'web_search',
      evidenceRecords: [
        ...state.evidenceRecords.filter((record) => record.sourceType !== 'web'),
        ...persistedEvidence,
      ],
      retrievalCandidates: [
        ...state.retrievalCandidates.filter((candidate) => candidate.sourceType !== 'web'),
        ...persistedCandidates,
      ],
      webSources: persistedSources.map((source) => ({
        id: source.id,
        sourceType: 'web' as const,
        title: source.title,
        url: source.url,
        snippet: source.snippet ?? '',
        query: typeof source.metadataJson.query === 'string' ? source.metadataJson.query : 'unknown',
        queryIntent: coerceSearchIntent(source.metadataJson.queryIntent),
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
      })),
    };
  };
}

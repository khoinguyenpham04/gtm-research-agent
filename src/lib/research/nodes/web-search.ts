import {
  coerceSourceCategory,
  coerceSourceQualityLabel,
  coerceSourceRecency,
} from '@/lib/research/source-scoring';
import {
  appendResearchEvent,
  clearResearchSources,
  hasStageCompleted,
  listResearchSources,
  saveResearchSources,
  setRunStage,
} from '@/lib/research/repository';
import type { ResearchGraphState } from '@/lib/research/schemas';
import type { WebSearchService } from '@/lib/research/search';

export function createWebSearchNode(searchService: WebSearchService) {
  return async function runWebSearchNode(state: ResearchGraphState) {
    console.info(`[research:${state.runId}] stage_start`, { stage: 'web_search' });

    if (!state.plan) {
      throw new Error('Cannot search the web before planning.');
    }

    if (await hasStageCompleted(state.runId, 'web_search')) {
      const persistedSources = await listResearchSources(state.runId);
      const webSources = persistedSources
        .filter((source) => source.sourceType === 'web')
        .map((source) => ({
          id: source.id,
          sourceType: 'web' as const,
          title: source.title,
          url: source.url,
          snippet: source.snippet ?? '',
          query: typeof source.metadataJson.query === 'string' ? source.metadataJson.query : 'unknown',
          domain: typeof source.metadataJson.domain === 'string' ? source.metadataJson.domain : null,
        }));

      return {
        status: state.status,
        currentStage: state.currentStage,
        webSources,
      };
    }

    await setRunStage(state.runId, 'searching', 'web_search');
    await appendResearchEvent(state.runId, 'web_search', 'stage_started', 'Searching the web.');

    for (const query of state.plan.searchQueries) {
      await appendResearchEvent(state.runId, 'web_search', 'query_started', `Searching for "${query}".`, {
        query,
      });
    }

    await clearResearchSources(state.runId, 'web');
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
          domain: source.domain,
          sourceCategory: source.sourceCategory,
          qualityScore: source.qualityScore,
          qualityLabel: source.qualityLabel,
          recency: source.recency,
          publishedYear: source.publishedYear,
          rationale: source.rationale,
          isPrimary: source.isPrimary,
        },
      })),
    );

    const highQualityCount = searchResults.filter((source) => source.qualityLabel === 'high').length;

    await appendResearchEvent(state.runId, 'web_search', 'stage_completed', 'Web search completed.', {
      sourceCount: persistedSources.length,
      highQualityCount,
    });
    console.info(`[research:${state.runId}] stage_complete`, {
      stage: 'web_search',
      sourceCount: persistedSources.length,
      highQualityCount,
    });

    return {
      status: 'searching' as const,
      currentStage: 'web_search',
      webSources: persistedSources.map((source) => ({
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
      })),
    };
  };
}

import {
  coerceClaimType,
  coerceEvidenceMode,
  coerceSearchIntent,
  coerceSourceCategory,
  coerceSourceQualityLabel,
  coerceSourceRecency,
  coerceVendorPageType,
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
import { resolveSectionKey } from '@/lib/research/section-routing';
import type { ResearchGraphState } from '@/lib/research/schemas';
import type { WebSearchService } from '@/lib/research/search';

function getCanonicalSectionKey(metadata: Record<string, unknown>) {
  const intent =
    typeof metadata.queryIntent === 'string'
      ? coerceSearchIntent(metadata.queryIntent)
      : null;
  return resolveSectionKey({
    intent,
    subtopic: typeof metadata.subtopic === 'string' ? metadata.subtopic : null,
    sectionKey: typeof metadata.sectionKey === 'string' ? metadata.sectionKey : null,
    claimType: typeof metadata.claimType === 'string' ? coerceClaimType(metadata.claimType) : null,
  });
}

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
          subtopic:
            typeof source.metadataJson.subtopic === 'string' ? source.metadataJson.subtopic : 'unknown',
          queryIntent: coerceSearchIntent(source.metadataJson.queryIntent),
          sectionKey: getCanonicalSectionKey(source.metadataJson),
          claimType: coerceClaimType(source.metadataJson.claimType),
          evidenceMode: coerceEvidenceMode(source.metadataJson.evidenceMode),
          vendorTarget:
            typeof source.metadataJson.vendorTarget === 'string' ? source.metadataJson.vendorTarget : null,
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
          subtopic: source.subtopic,
          queryIntent: source.queryIntent,
          sectionKey: resolveSectionKey({
            intent: source.queryIntent,
            subtopic: source.subtopic,
            sectionKey: source.sectionKey,
            claimType: source.claimType,
          }),
          claimType: source.claimType,
          evidenceMode: source.evidenceMode,
          vendorTarget: source.vendorTarget,
          vendorPageType: source.vendorPageType,
          productName: source.productName,
          targetUser: source.targetUser,
          coreFeatures: source.coreFeatures,
          crmIntegrations: source.crmIntegrations,
          planPricingText: source.planPricingText,
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
        sectionKey: getCanonicalSectionKey(source.metadataJson),
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
        sectionKey: getCanonicalSectionKey(source.metadataJson),
        query: typeof source.metadataJson.query === 'string' ? source.metadataJson.query : 'unknown',
        sourceId: source.id,
        title: source.title,
        url: source.url,
        claimType: coerceClaimType(source.metadataJson.claimType),
        evidenceMode: coerceEvidenceMode(source.metadataJson.evidenceMode),
        vendorTarget:
          typeof source.metadataJson.vendorTarget === 'string' ? source.metadataJson.vendorTarget : null,
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
        subtopic:
          typeof source.metadataJson.subtopic === 'string' ? source.metadataJson.subtopic : 'unknown',
        queryIntent: coerceSearchIntent(source.metadataJson.queryIntent),
        sectionKey: getCanonicalSectionKey(source.metadataJson),
        claimType: coerceClaimType(source.metadataJson.claimType),
        evidenceMode: coerceEvidenceMode(source.metadataJson.evidenceMode),
        vendorTarget:
          typeof source.metadataJson.vendorTarget === 'string' ? source.metadataJson.vendorTarget : null,
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
      })),
    };
  };
}

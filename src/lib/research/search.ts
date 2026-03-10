import type { PlannedSearchQuery, ScoredSource } from '@/lib/research/schemas';
import { scoreWebSource } from '@/lib/research/source-scoring';

export interface WebSearchService {
  searchMany(queries: PlannedSearchQuery[]): Promise<ScoredSource[]>;
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

const vendorDomainHints: Record<string, string> = {
  'otter.ai': 'otter.ai',
  otter: 'otter.ai',
  'fireflies.ai': 'fireflies.ai',
  fireflies: 'fireflies.ai',
  fathom: 'fathom.video',
  'fathom.video': 'fathom.video',
  jamie: 'meetjamie.ai',
  'meetjamie.ai': 'meetjamie.ai',
  zoom: 'zoom.com',
  'zoom ai companion': 'zoom.com',
  gong: 'gong.io',
  avoma: 'avoma.com',
  'read.ai': 'read.ai',
};

const MAX_QUERY_CONCURRENCY = 3;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 700;

function parseDomain(url: string | undefined) {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export class TavilySearchService implements WebSearchService {
  constructor(private readonly apiKey = process.env.TAVILY_API_KEY?.trim()) {}

  async searchMany(queries: PlannedSearchQuery[]) {
    if (!this.apiKey) {
      throw new Error('Missing TAVILY_API_KEY.');
    }

    const failures: string[] = [];
    const results = await this.mapWithConcurrency(queries, MAX_QUERY_CONCURRENCY, async (query) => {
      try {
        return await this.searchOne(query);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown search error.';
        failures.push(`${query.intent}:${query.query} -> ${message}`);
        console.warn('[research-search] query_failed', {
          intent: query.intent,
          query: query.query,
          message,
        });
        return [] as ScoredSource[];
      }
    });
    const deduped = new Map<string, ScoredSource>();

    for (const group of results) {
      for (const source of group) {
        const key = source.url ?? `${source.query}:${source.title}`;
        if (!deduped.has(key)) {
          deduped.set(key, source);
        }
      }
    }

    const dedupedResults = Array.from(deduped.values());
    if (dedupedResults.length === 0 && failures.length > 0) {
      throw new Error(`All web searches failed. ${failures[0]}`);
    }

    return dedupedResults;
  }

  private async searchOne(queryPlan: PlannedSearchQuery) {
    const variants = this.buildQueryVariants(queryPlan);
    const failures: string[] = [];
    const results: ScoredSource[][] = [];

    for (const [variantIndex, queryVariant] of variants.entries()) {
      try {
        const payload = await this.fetchVariant(queryVariant);
        results.push(
          (payload.results ?? [])
            .filter((result) => result.url && result.title && result.content)
            .map((result, index) => {
              const scored = scoreWebSource({
                id: `${queryPlan.intent}-${variantIndex}-${index}-${result.url!.trim()}`,
                sourceType: 'web',
                title: result.title!.trim(),
                url: result.url!.trim(),
                snippet: result.content!.trim().slice(0, 500),
                query: queryPlan.query,
                queryIntent: queryPlan.intent,
                sectionKey: queryPlan.sectionKey,
                claimType: queryPlan.claimType,
                evidenceMode: queryPlan.evidenceMode,
                vendorTarget: queryPlan.vendorTarget,
                domain: parseDomain(result.url),
              });

              return {
                ...scored,
                claimType: queryPlan.claimType,
                evidenceMode: queryPlan.evidenceMode,
              };
            }),
        );
      } catch (error) {
        failures.push(error instanceof Error ? error.message : 'Unknown search error.');
      }
    }

    if (results.length === 0 && failures.length > 0) {
      throw new Error(failures[0]);
    }

    return results.flat();
  }

  private async fetchVariant(query: string) {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            api_key: this.apiKey,
            query,
            topic: 'general',
            search_depth: 'advanced',
            max_results: 4,
            include_answer: false,
            include_raw_content: false,
            include_images: false,
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Tavily request failed: ${response.status} ${body}`.trim());
        }

        return (await response.json()) as TavilyResponse;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown fetch error.');
        if (attempt < MAX_FETCH_ATTEMPTS) {
          await this.delay(RETRY_DELAY_MS * attempt);
        }
      }
    }

    throw lastError ?? new Error('Web search request failed.');
  }

  private buildQueryVariants(queryPlan: PlannedSearchQuery) {
    const variants = [queryPlan.query];
    const vendorTarget = queryPlan.vendorTarget?.trim().toLowerCase();
    const hintedDomain = vendorTarget ? vendorDomainHints[vendorTarget] : null;

    if (
      queryPlan.evidenceMode === 'vendor-primary' &&
      queryPlan.vendorTarget &&
      queryPlan.intent === 'pricing'
    ) {
      variants.push(
        hintedDomain
          ? `${queryPlan.vendorTarget} pricing plans site:${hintedDomain}`
          : `${queryPlan.vendorTarget} pricing plans official pricing`,
      );
    }

    if (
      queryPlan.evidenceMode === 'vendor-primary' &&
      queryPlan.vendorTarget &&
      queryPlan.intent === 'competitor-features'
    ) {
      variants.push(
        hintedDomain
          ? `${queryPlan.vendorTarget} product features CRM integrations sales teams site:${hintedDomain}`
          : `${queryPlan.vendorTarget} product features CRM integrations sales teams`,
      );
    }

    return [...new Set(variants)];
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>,
  ) {
    const results: R[] = new Array(items.length);
    let cursor = 0;

    const runWorker = async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
    );

    return results;
  }

  private delay(ms: number) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

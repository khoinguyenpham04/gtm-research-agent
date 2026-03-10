import type { PlannedSearchQuery, ScoredSource } from '@/lib/research/schemas';
import { resolvePlannedSearchQuery, resolveSectionKey } from '@/lib/research/section-routing';
import { scoreWebSource } from '@/lib/research/source-scoring';
import {
  resolveCanonicalVendorPages,
  type CanonicalVendorPage,
} from '@/lib/research/vendor-registry';

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
const PAGE_FETCH_TIMEOUT_MS = 8_000;
const featureKeywords = [
  'transcription',
  'summaries',
  'summary',
  'meeting notes',
  'action items',
  'conversation intelligence',
  'speaker identification',
  'recording',
  'crm sync',
  'crm integration',
  'real-time recap',
  'sales coaching',
  'call summaries',
];
const crmKeywords = [
  'Salesforce',
  'HubSpot',
  'Microsoft Dynamics',
  'Pipedrive',
  'Zoho',
  'Copper',
  'Freshsales',
];

interface VendorPageFacts {
  vendorPageType: ScoredSource['vendorPageType'];
  productName: string | null;
  targetUser: string | null;
  coreFeatures: string[];
  crmIntegrations: string[];
  planPricingText: string | null;
}

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

function stripHtml(input: string) {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHtmlTitle(html: string) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
}

function detectVendorPageType(url: string, title: string, text: string): VendorPageFacts['vendorPageType'] {
  const haystack = `${url.toLowerCase()} ${title.toLowerCase()} ${text.toLowerCase()}`;

  if (/(pricing|plans|plan highlights|user\/month|seat\/month|billed)/.test(haystack)) {
    return 'pricing';
  }
  if (/(\/docs|\/learn|documentation|developers)/.test(haystack)) {
    return 'docs';
  }
  if (/(\/news|\/blog|launch|introduces|announces)/.test(haystack)) {
    return 'newsroom';
  }
  if (/(\/compare|\/vs|comparison)/.test(haystack)) {
    return 'comparison';
  }
  if (/(features|meeting assistant|ai companion|sales teams|product)/.test(haystack)) {
    return 'product';
  }
  return 'unknown';
}

function firstSentenceMatching(text: string, regex: RegExp) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences.find((sentence) => regex.test(sentence))?.trim() ?? null;
}

function extractListMatches(text: string, values: string[]) {
  const lowered = text.toLowerCase();
  return values.filter((value) => lowered.includes(value.toLowerCase()));
}

function extractTargetUser(text: string) {
  const patterns = [
    /small and medium(?:-sized)? businesses/i,
    /small businesses/i,
    /sales teams/i,
    /customer success teams/i,
    /enterprise teams/i,
    /developers/i,
  ];

  for (const pattern of patterns) {
    const match = firstSentenceMatching(text, pattern);
    if (match) {
      return match;
    }
  }

  return null;
}

function extractProductName(title: string, vendorTarget: string | null) {
  const cleaned = title
    .replace(/\s+[|-]\s+.*$/, '')
    .replace(/\s+Try.*$/i, '')
    .trim();

  if (cleaned.length > 0) {
    return cleaned;
  }

  return vendorTarget;
}

function buildCanonicalSnippet(pageType: CanonicalVendorPage['vendorPageType'], text: string) {
  const canonicalSentenceMatchers: Record<
    CanonicalVendorPage['vendorPageType'],
    RegExp
  > = {
    product:
      /(meeting assistant|meeting notes|transcription|action items|crm|sales|summary|conversation intelligence)/i,
    pricing:
      /(\$|£|€|usd|gbp|eur|user\/month|seat\/month|billed annually|billed monthly|free plan)/i,
    docs: /(salesforce|hubspot|crm|integration|sync|api|setup)/i,
    newsroom: /(launch|introduces|announces|sales|meeting|crm|assistant)/i,
    comparison: /(compare|comparison|vs|features|pricing|crm)/i,
  };

  return (
    firstSentenceMatching(text, canonicalSentenceMatchers[pageType]) ??
    text.slice(0, 500).trim() ??
    null
  );
}

function buildVendorPageFacts(
  url: string,
  title: string,
  snippet: string,
  vendorTarget: string | null,
  pageText: string,
  forcedPageType?: VendorPageFacts['vendorPageType'],
): VendorPageFacts {
  const combined = `${title}. ${snippet}. ${pageText}`.trim();

  return {
    vendorPageType: forcedPageType ?? detectVendorPageType(url, title, combined),
    productName: extractProductName(title, vendorTarget),
    targetUser: extractTargetUser(combined),
    coreFeatures: extractListMatches(combined, featureKeywords).slice(0, 6),
    crmIntegrations: extractListMatches(combined, crmKeywords).slice(0, 5),
    planPricingText:
      firstSentenceMatching(
        combined,
        /(\$|£|€|usd|gbp|eur|user\/month|seat\/month|billed annually|billed monthly|free plan)/i,
      ) ?? null,
  };
}

export class TavilySearchService implements WebSearchService {
  constructor(private readonly apiKey = process.env.TAVILY_API_KEY?.trim()) {}

  async searchMany(queries: PlannedSearchQuery[]) {
    if (!this.apiKey) {
      throw new Error('Missing TAVILY_API_KEY.');
    }

    const failures: string[] = [];
    const results = await this.mapWithConcurrency(queries.map(resolvePlannedSearchQuery), MAX_QUERY_CONCURRENCY, async (query) => {
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
        const key = source.url
          ? `${source.sectionKey}:${source.url}`
          : `${source.sectionKey}:${source.query}:${source.title}`;
        const existing = deduped.get(key);
        if (!existing || existing.qualityScore < source.qualityScore) {
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
    const canonicalSectionKey = resolveSectionKey({
      intent: queryPlan.intent,
      subtopic: queryPlan.subtopic,
      sectionKey: queryPlan.sectionKey,
      claimType: queryPlan.claimType,
    });
    const variants = this.buildQueryVariants(queryPlan);
    const failures: string[] = [];
    const results: ScoredSource[][] = [];

    for (const [variantIndex, queryVariant] of variants.entries()) {
      try {
        const payload = await this.fetchVariant(queryVariant);
        results.push(
          await Promise.all(
            (payload.results ?? [])
              .filter((result) => result.url && result.title && result.content)
              .map(async (result, index) => {
                const vendorFacts =
                  queryPlan.evidenceMode === 'vendor-primary'
                    ? await this.extractVendorPageFacts(result.url!.trim(), result.title!.trim(), result.content!.trim(), queryPlan.vendorTarget)
                    : null;
              const scored = scoreWebSource({
                id: `${queryPlan.intent}-${variantIndex}-${index}-${result.url!.trim()}`,
                sourceType: 'web',
                title: result.title!.trim(),
                url: result.url!.trim(),
                snippet: result.content!.trim().slice(0, 500),
                query: queryPlan.query,
                subtopic: queryPlan.subtopic,
                queryIntent: queryPlan.intent,
                sectionKey: canonicalSectionKey,
                claimType: queryPlan.claimType,
                evidenceMode: queryPlan.evidenceMode,
                vendorTarget: queryPlan.vendorTarget,
                domain: parseDomain(result.url),
                vendorPageType: vendorFacts?.vendorPageType ?? null,
                productName: vendorFacts?.productName ?? null,
                targetUser: vendorFacts?.targetUser ?? null,
                coreFeatures: vendorFacts?.coreFeatures ?? [],
                crmIntegrations: vendorFacts?.crmIntegrations ?? [],
                planPricingText: vendorFacts?.planPricingText ?? null,
              });

              return {
                ...scored,
                claimType: queryPlan.claimType,
                evidenceMode: queryPlan.evidenceMode,
              };
            }),
          ),
        );
      } catch (error) {
        failures.push(error instanceof Error ? error.message : 'Unknown search error.');
      }
    }

    const canonicalVendorSources = await this.fetchCanonicalVendorSources(queryPlan);
    if (canonicalVendorSources.length > 0) {
      results.push(canonicalVendorSources);
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

  private async extractVendorPageFacts(
    url: string,
    title: string,
    snippet: string,
    vendorTarget: string | null,
  ): Promise<VendorPageFacts | null> {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`Page fetch failed: ${response.status}`);
      }

      const html = await response.text();
      const text = stripHtml(html).slice(0, 8000);
      return buildVendorPageFacts(url, title, snippet, vendorTarget, text);
    } catch {
      return buildVendorPageFacts(url, title, snippet, vendorTarget, '');
    }
  }

  private async fetchCanonicalVendorSources(queryPlan: PlannedSearchQuery) {
    if (queryPlan.evidenceMode !== 'vendor-primary' || !queryPlan.vendorTarget) {
      return [] as ScoredSource[];
    }

    const pages = resolveCanonicalVendorPages(queryPlan.vendorTarget, queryPlan.intent);
    if (pages.length === 0) {
      return [] as ScoredSource[];
    }

    const sources = await Promise.all(
      pages.map((page, index) => this.buildCanonicalVendorSource(queryPlan, page, index)),
    );

    return sources.filter((source): source is ScoredSource => Boolean(source));
  }

  private async buildCanonicalVendorSource(
    queryPlan: PlannedSearchQuery,
    page: CanonicalVendorPage,
    index: number,
  ) {
    const canonicalSectionKey = resolveSectionKey({
      intent: queryPlan.intent,
      subtopic: queryPlan.subtopic,
      sectionKey: queryPlan.sectionKey,
      claimType: queryPlan.claimType,
    });

    try {
      const response = await fetch(page.url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`Canonical vendor page fetch failed: ${response.status}`);
      }

      const html = await response.text();
      const text = stripHtml(html).slice(0, 8000);
      const title = extractHtmlTitle(html) ?? page.title;
      const snippet = buildCanonicalSnippet(page.vendorPageType, text) ?? page.title;
      const vendorFacts = buildVendorPageFacts(
        page.url,
        title,
        snippet,
        queryPlan.vendorTarget,
        text,
        page.vendorPageType,
      );

      return scoreWebSource({
        id: `${queryPlan.intent}-canonical-${index}-${page.url}`,
        sourceType: 'web',
        title,
        url: page.url,
        snippet,
        query: queryPlan.query,
        subtopic: queryPlan.subtopic,
        queryIntent: queryPlan.intent,
        sectionKey: canonicalSectionKey,
        claimType: queryPlan.claimType,
        evidenceMode: queryPlan.evidenceMode,
        vendorTarget: queryPlan.vendorTarget,
        domain: parseDomain(page.url),
        vendorPageType: vendorFacts.vendorPageType ?? page.vendorPageType,
        productName: vendorFacts.productName,
        targetUser: vendorFacts.targetUser,
        coreFeatures: vendorFacts.coreFeatures,
        crmIntegrations: vendorFacts.crmIntegrations,
        planPricingText: vendorFacts.planPricingText,
      });
    } catch {
      return null;
    }
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

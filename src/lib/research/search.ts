import type { PlannedSearchQuery, ScoredSource } from '@/lib/research/schemas';
import { resolvePlannedSearchQuery, resolveSectionKey } from '@/lib/research/section-routing';
import { scoreWebSource } from '@/lib/research/source-scoring';
import {
  resolveCanonicalVendorPages,
  type CanonicalVendorPage,
} from '@/lib/research/vendor-registry';
import {
  extractGenericCapabilityPhrases,
  extractGenericEcosystemSignals,
  normalizeResearchText,
} from '@/lib/research/topic-utils';

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
  tesla: 'tesla.com',
  powervault: 'powervault.co.uk',
};

const MAX_QUERY_CONCURRENCY = 3;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 700;
const PAGE_FETCH_TIMEOUT_MS = 8_000;
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
  if (/(features|product|overview|specification|specifications|datasheet|manual|for home|for business)/.test(haystack)) {
    return 'product';
  }
  return 'unknown';
}

function firstSentenceMatching(text: string, regex: RegExp) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences.find((sentence) => regex.test(sentence))?.trim() ?? null;
}

function compactText(input: string) {
  return input.replace(/\s+/g, ' ').trim();
}

function repairMalformedJsonEscapes(input: string) {
  return input
    .replace(/\\u(?![0-9a-fA-F]{4})/g, '\\\\u')
    .replace(/\\x([0-9a-fA-F]{0,2})/g, (_match, hex: string) => `\\\\x${hex}`)
    .replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
}

function parseTavilyResponseBody(body: string) {
  try {
    return JSON.parse(body) as TavilyResponse;
  } catch (error) {
    const repairedBody = repairMalformedJsonEscapes(body);

    if (repairedBody === body) {
      const message = error instanceof Error ? error.message : 'Unknown JSON parse failure.';
      throw new Error(`Tavily response JSON parse failed: ${message}`);
    }

    try {
      return JSON.parse(repairedBody) as TavilyResponse;
    } catch (repairError) {
      const message = repairError instanceof Error ? repairError.message : 'Unknown repaired JSON parse failure.';
      throw new Error(`Tavily response JSON parse failed after repair: ${message}`);
    }
  }
}

export function sanitizeOutboundQuery(input: string) {
  const sanitized = input
    .normalize('NFKC')
    .replace(/[“”‘’"'`]/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\.\./g, ' ')
    .replace(/\\[ux][0-9a-fA-F]{0,4}/g, ' ')
    .replace(/\\/g, ' ')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return sanitized.length > 260 ? sanitized.slice(0, 260).trim() : sanitized;
}

function isDiscountPricingText(input: string) {
  const normalized = input.toLowerCase();
  return (
    normalized.includes('student') ||
    normalized.includes('teacher') ||
    normalized.includes('.edu') ||
    normalized.includes('discount') ||
    normalized.includes('education')
  );
}

function extractCanonicalPricingText(text: string) {
  const normalized = compactText(text);
  const planPattern =
    /(?:free|basic|starter|pro|plus|team|business|premium|enterprise)[^.!?\n]{0,120}?(?:[$£€]\s?\d+(?:\.\d+)?(?:\s*(?:\/|\bper\b)\s*(?:seat|user|month))?|contact us|contact sales|custom pricing|free)/gi;
  const fallbackPattern =
    /(?:from\s*)?[$£€]\s?\d+(?:\.\d+)?[^.!?\n]{0,60}?(?:month|monthly|seat|user|billed annually|billed monthly)/gi;

  const planMatches = [...normalized.matchAll(planPattern)]
    .map((match) => compactText(match[0]))
    .filter((match) => !isDiscountPricingText(match));
  const fallbackMatches = [...normalized.matchAll(fallbackPattern)]
    .map((match) => compactText(match[0]))
    .filter((match) => !isDiscountPricingText(match));
  const uniqueMatches = [...new Set([...planMatches, ...fallbackMatches])];

  if (uniqueMatches.length > 0) {
    return uniqueMatches.slice(0, 3).join(' | ');
  }

  const fallbackSentence = firstSentenceMatching(
    normalized,
    /(\$|£|€|usd|gbp|eur|user\/month|seat\/month|billed annually|billed monthly|free plan)/i,
  );

  if (fallbackSentence && !isDiscountPricingText(fallbackSentence)) {
    return compactText(fallbackSentence);
  }

  return null;
}

function extractTargetUser(text: string) {
  const patterns = [
    /owner-occupied houses/i,
    /homeowners/i,
    /households/i,
    /small and medium(?:-sized)? businesses/i,
    /small businesses/i,
    /sales teams/i,
    /customer success teams/i,
    /enterprise teams/i,
    /installers/i,
    /portfolio landlords/i,
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
  if (pageType === 'pricing') {
    return extractCanonicalPricingText(text) ?? text.slice(0, 500).trim() ?? null;
  }

  const canonicalSentenceMatchers: Record<
    CanonicalVendorPage['vendorPageType'],
    RegExp
  > = {
    product:
      /(features?|capabilities|specifications?|datasheet|manual|warranty|capacity|backup|integration|workflow|summary|transcription|pricing)/i,
    pricing:
      /(\$|£|€|usd|gbp|eur|user\/month|seat\/month|billed annually|billed monthly|free plan)/i,
    docs: /(integration|setup|manual|api|datasheet|warranty|compatib|installation)/i,
    newsroom: /(launch|introduces|announces|product|pricing|feature|availability)/i,
    comparison: /(compare|comparison|vs|features|pricing|capacity|warranty)/i,
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
    coreFeatures: extractGenericCapabilityPhrases(combined, 6),
    crmIntegrations: extractGenericEcosystemSignals(combined, 5),
    planPricingText: extractCanonicalPricingText(combined),
  };
}

export class TavilySearchService implements WebSearchService {
  constructor(protected readonly apiKey = process.env.TAVILY_API_KEY?.trim()) {}

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

  protected async searchOne(queryPlan: PlannedSearchQuery) {
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

  protected async fetchVariant(query: string): Promise<TavilyResponse> {
    const sanitizedQuery = sanitizeOutboundQuery(query);
    if (!sanitizedQuery) {
      throw new Error('Search query became empty after sanitization.');
    }

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
            query: sanitizedQuery,
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

        return parseTavilyResponseBody(await response.text());
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown fetch error.');
        if (attempt < MAX_FETCH_ATTEMPTS) {
          await this.delay(RETRY_DELAY_MS * attempt);
        }
      }
    }

    throw lastError ?? new Error('Web search request failed.');
  }

  protected buildQueryVariants(queryPlan: PlannedSearchQuery) {
    const baseQuery = sanitizeOutboundQuery(queryPlan.query);
    const variants = baseQuery ? [baseQuery] : [];
    const sanitizedVendorTarget = queryPlan.vendorTarget
      ? sanitizeOutboundQuery(queryPlan.vendorTarget)
      : null;
    const vendorTarget = sanitizedVendorTarget?.trim().toLowerCase();
    const hintedDomain =
      vendorTarget
        ? vendorDomainHints[vendorTarget] ??
          (() => {
            const tokens = normalizeResearchText(vendorTarget)
              .split(' ')
              .filter((token) => token.length >= 3);
            return tokens.length === 1 ? `${tokens[0]}.com` : null;
          })()
        : null;

    if (
      queryPlan.evidenceMode === 'vendor-primary' &&
      sanitizedVendorTarget &&
      queryPlan.intent === 'pricing'
    ) {
      variants.push(
        hintedDomain
          ? sanitizeOutboundQuery(`${sanitizedVendorTarget} pricing plans site:${hintedDomain}`)
          : sanitizeOutboundQuery(`${sanitizedVendorTarget} pricing plans official pricing`),
      );
    }

    if (
      queryPlan.evidenceMode === 'vendor-primary' &&
      sanitizedVendorTarget &&
      queryPlan.intent === 'competitor-features'
    ) {
      variants.push(
        hintedDomain
          ? sanitizeOutboundQuery(`${sanitizedVendorTarget} product features site:${hintedDomain}`)
          : sanitizeOutboundQuery(`${sanitizedVendorTarget} product features official`),
      );
    }

    return [...new Set(variants.filter(Boolean))];
  }

  protected async extractVendorPageFacts(
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

  protected async buildCanonicalVendorSource(
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

  protected async mapWithConcurrency<T, R>(
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

  protected delay(ms: number) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

// ---------------------------------------------------------------------------
// Brave Search  (free tier: 2,000 queries/month — https://api.search.brave.com)
// Set BRAVE_SEARCH_API_KEY to use.
// ---------------------------------------------------------------------------

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
}

interface BraveResponse {
  web?: { results?: BraveWebResult[] };
}

export class BraveSearchService extends TavilySearchService {
  constructor(private readonly braveApiKey = process.env.BRAVE_SEARCH_API_KEY?.trim()) {
    // Pass a dummy string so the parent's `!this.apiKey` guard doesn't trigger.
    // The actual key check happens in our override.
    super('brave');
  }

  async searchMany(queries: PlannedSearchQuery[]) {
    if (!this.braveApiKey) {
      throw new Error('Missing BRAVE_SEARCH_API_KEY.');
    }
    return super.searchMany(queries);
  }

  protected override async fetchVariant(query: string): Promise<TavilyResponse> {
    const sanitizedQuery = sanitizeOutboundQuery(query);
    if (!sanitizedQuery) {
      throw new Error('Search query became empty after sanitization.');
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
      try {
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(sanitizedQuery)}&count=5&search_lang=en`;
        const response = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': this.braveApiKey!,
          },
          cache: 'no-store',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Brave Search request failed: ${response.status} ${body}`.trim());
        }

        const data = await response.json() as BraveResponse;
        return {
          results: (data.web?.results ?? []).map((r) => ({
            title: r.title,
            url: r.url,
            content: r.description,
          })),
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown fetch error.');
        if (attempt < MAX_FETCH_ATTEMPTS) {
          await this.delay(RETRY_DELAY_MS * attempt);
        }
      }
    }

    throw lastError ?? new Error('Brave Search request failed.');
  }
}

// ---------------------------------------------------------------------------
// Exa Search  (free tier: 1,000 requests/month — https://exa.ai)
// Set EXA_API_KEY to use. Exa uses neural+keyword hybrid search, which works
// well for research queries about market data and vendor features.
// ---------------------------------------------------------------------------

interface ExaResult {
  title?: string;
  url?: string;
  text?: string;
}

interface ExaResponse {
  results?: ExaResult[];
}

export class ExaSearchService extends TavilySearchService {
  constructor(private readonly exaApiKey = process.env.EXA_API_KEY?.trim()) {
    super('exa');
  }

  async searchMany(queries: PlannedSearchQuery[]) {
    if (!this.exaApiKey) {
      throw new Error('Missing EXA_API_KEY.');
    }
    return super.searchMany(queries);
  }

  protected override async fetchVariant(query: string): Promise<TavilyResponse> {
    const sanitizedQuery = sanitizeOutboundQuery(query);
    if (!sanitizedQuery) {
      throw new Error('Search query became empty after sanitization.');
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch('https://api.exa.ai/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.exaApiKey!,
          },
          body: JSON.stringify({
            query: sanitizedQuery,
            numResults: 5,
            type: 'auto',
            contents: { text: { maxCharacters: 600 } },
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Exa Search request failed: ${response.status} ${body}`.trim());
        }

        const data = await response.json() as ExaResponse;
        return {
          results: (data.results ?? []).map((r) => ({
            title: r.title,
            url: r.url,
            content: r.text,
          })),
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown fetch error.');
        if (attempt < MAX_FETCH_ATTEMPTS) {
          await this.delay(RETRY_DELAY_MS * attempt);
        }
      }
    }

    throw lastError ?? new Error('Exa Search request failed.');
  }
}

// ---------------------------------------------------------------------------
// Factory — selects provider based on SEARCH_PROVIDER env var.
// Defaults to Tavily for backwards compatibility.
//   SEARCH_PROVIDER=brave  → BraveSearchService  (BRAVE_SEARCH_API_KEY required)
//   SEARCH_PROVIDER=exa    → ExaSearchService    (EXA_API_KEY required)
//   SEARCH_PROVIDER=tavily → TavilySearchService (TAVILY_API_KEY required, default)
// ---------------------------------------------------------------------------

export function createSearchService(): WebSearchService {
  const provider = (process.env.SEARCH_PROVIDER ?? 'tavily').toLowerCase().trim();

  if (provider === 'brave') {
    return new BraveSearchService();
  }

  if (provider === 'exa') {
    return new ExaSearchService();
  }

  return new TavilySearchService();
}

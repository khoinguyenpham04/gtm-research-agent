import type { ScoredSource } from '@/lib/research/schemas';
import { scoreWebSource } from '@/lib/research/source-scoring';

export interface WebSearchService {
  searchMany(queries: string[]): Promise<ScoredSource[]>;
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
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

export class TavilySearchService implements WebSearchService {
  constructor(private readonly apiKey = process.env.TAVILY_API_KEY?.trim()) {}

  async searchMany(queries: string[]) {
    if (!this.apiKey) {
      throw new Error('Missing TAVILY_API_KEY.');
    }

    const results = await Promise.all(queries.map(async (query) => this.searchOne(query)));
    const deduped = new Map<string, ScoredSource>();

    for (const group of results) {
      for (const source of group) {
        const key = source.url ?? `${source.query}:${source.title}`;
        if (!deduped.has(key)) {
          deduped.set(key, source);
        }
      }
    }

    return Array.from(deduped.values());
  }

  private async searchOne(query: string) {
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
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Tavily request failed: ${response.status} ${body}`.trim());
    }

    const payload = (await response.json()) as TavilyResponse;

    return (payload.results ?? [])
      .filter((result) => result.url && result.title && result.content)
      .map((result, index) =>
        scoreWebSource({
          id: `${query}-${index}-${result.url!.trim()}`,
          sourceType: 'web',
          title: result.title!.trim(),
          url: result.url!.trim(),
          snippet: result.content!.trim().slice(0, 500),
          query,
          domain: parseDomain(result.url),
        }),
      );
  }
}

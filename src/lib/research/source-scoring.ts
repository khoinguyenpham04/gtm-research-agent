import {
  sourceCategoryValues,
  sourceQualityLabelValues,
  sourceRecencyValues,
  type ScoredSource,
} from '@/lib/research/schemas';

const CURRENT_YEAR = new Date().getUTCFullYear();

function extractPublishedYear(input: string) {
  const matches = input.match(/\b20\d{2}\b/g);
  if (!matches || matches.length === 0) {
    return null;
  }

  const validYears = matches
    .map((value) => Number(value))
    .filter((year) => year >= 2018 && year <= CURRENT_YEAR + 1);

  return validYears.length > 0 ? Math.max(...validYears) : null;
}

function getRecency(publishedYear: number | null): ScoredSource['recency'] {
  if (!publishedYear) {
    return 'unknown';
  }

  const age = CURRENT_YEAR - publishedYear;
  if (age <= 1) {
    return 'current';
  }
  if (age <= 2) {
    return 'recent';
  }
  if (age <= 4) {
    return 'dated';
  }
  return 'historical';
}

function startsWithAny(input: string, prefixes: string[]) {
  return prefixes.some((prefix) => input.startsWith(prefix));
}

function getSourceCategory(url: string | null, domain: string | null, title: string): ScoredSource['sourceCategory'] {
  const normalizedDomain = (domain ?? '').toLowerCase();
  const normalizedTitle = title.toLowerCase();
  const normalizedUrl = (url ?? '').toLowerCase();

  if (
    normalizedDomain.endsWith('.gov.uk') ||
    startsWithAny(normalizedDomain, ['gov.uk', 'ons.gov.uk']) ||
    normalizedDomain.endsWith('.gov') ||
    normalizedDomain.endsWith('.edu') ||
    normalizedDomain.endsWith('.ac.uk')
  ) {
    return 'official';
  }

  if (
    normalizedDomain.includes('oecd.org') ||
    normalizedDomain.includes('analysysmason.com') ||
    normalizedUrl.endsWith('.pdf')
  ) {
    return 'research';
  }

  if (
    normalizedDomain.includes('salesforce.com') ||
    normalizedDomain.includes('zapier.com') ||
    normalizedDomain.includes('ringover') ||
    normalizedDomain.includes('meetjamie') ||
    normalizedDomain.includes('pcmag.com')
  ) {
    return 'vendor';
  }

  if (
    normalizedDomain.includes('forbes.com') ||
    normalizedDomain.includes('prnewswire.com') ||
    normalizedDomain.includes('technavio.com')
  ) {
    return 'media';
  }

  if (
    normalizedTitle.includes('best ') ||
    normalizedTitle.includes('top ') ||
    normalizedTitle.includes('comparison') ||
    normalizedTitle.includes('review')
  ) {
    return 'blog';
  }

  return 'blog';
}

function getBaseScore(category: ScoredSource['sourceCategory']) {
  switch (category) {
    case 'official':
      return 0.95;
    case 'research':
      return 0.88;
    case 'media':
      return 0.62;
    case 'vendor':
      return 0.56;
    case 'community':
      return 0.45;
    case 'blog':
    default:
      return 0.38;
  }
}

function applyRecencyAdjustment(score: number, recency: ScoredSource['recency']) {
  switch (recency) {
    case 'current':
      return Math.min(1, score + 0.04);
    case 'recent':
      return Math.min(1, score + 0.02);
    case 'dated':
      return Math.max(0, score - 0.06);
    case 'historical':
      return Math.max(0, score - 0.12);
    case 'unknown':
    default:
      return score;
  }
}

function getQualityLabel(score: number): ScoredSource['qualityLabel'] {
  if (score >= 0.8) {
    return 'high';
  }
  if (score >= 0.58) {
    return 'medium';
  }
  return 'low';
}

export function coerceSourceCategory(value: unknown): ScoredSource['sourceCategory'] {
  return typeof value === 'string' && (sourceCategoryValues as readonly string[]).includes(value)
    ? (value as ScoredSource['sourceCategory'])
    : 'blog';
}

export function coerceSourceQualityLabel(value: unknown): ScoredSource['qualityLabel'] {
  return typeof value === 'string' && (sourceQualityLabelValues as readonly string[]).includes(value)
    ? (value as ScoredSource['qualityLabel'])
    : 'low';
}

export function coerceSourceRecency(value: unknown): ScoredSource['recency'] {
  return typeof value === 'string' && (sourceRecencyValues as readonly string[]).includes(value)
    ? (value as ScoredSource['recency'])
    : 'unknown';
}

function buildRationale(
  category: ScoredSource['sourceCategory'],
  recency: ScoredSource['recency'],
  publishedYear: number | null,
) {
  const categoryLabel = {
    official: 'official/public-sector source',
    research: 'research/report source',
    media: 'media or analyst source',
    vendor: 'vendor-authored source',
    blog: 'blog/comparison source',
    community: 'community source',
  }[category];

  const recencyLabel =
    recency === 'unknown'
      ? 'publication date not identified'
      : publishedYear
        ? `dated ${publishedYear}`
        : recency;

  return `${categoryLabel}; ${recencyLabel}`;
}

export function scoreWebSource(input: Omit<ScoredSource, 'sourceCategory' | 'qualityScore' | 'qualityLabel' | 'recency' | 'publishedYear' | 'rationale' | 'isPrimary'>): ScoredSource {
  const combinedText = [input.title, input.snippet, input.url ?? '', input.query].join(' ');
  const publishedYear = extractPublishedYear(combinedText);
  const recency = getRecency(publishedYear);
  const sourceCategory = getSourceCategory(input.url, input.domain, input.title);
  const qualityScore = Number(applyRecencyAdjustment(getBaseScore(sourceCategory), recency).toFixed(2));
  const qualityLabel = getQualityLabel(qualityScore);

  return {
    ...input,
    sourceCategory,
    qualityScore,
    qualityLabel,
    recency,
    publishedYear,
    rationale: buildRationale(sourceCategory, recency, publishedYear),
    isPrimary: sourceCategory === 'official' || sourceCategory === 'research',
  };
}

export function sortSourcesByQuality<T extends Pick<ScoredSource, 'qualityScore' | 'publishedYear'>>(sources: T[]) {
  return [...sources].sort((left, right) => {
    if (right.qualityScore !== left.qualityScore) {
      return right.qualityScore - left.qualityScore;
    }

    return (right.publishedYear ?? 0) - (left.publishedYear ?? 0);
  });
}

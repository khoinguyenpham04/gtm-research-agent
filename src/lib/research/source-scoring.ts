import {
  claimTypeValues,
  evidenceModeValues,
  finalReportSectionKeyValues,
  searchIntentValues,
  sourceCategoryValues,
  sourceQualityLabelValues,
  sourceRecencyValues,
  vendorPageTypeValues,
  type Citation,
  type ClaimType,
  type EvidenceMode,
  type ScoredSource,
  type VendorPageType,
} from '@/lib/research/schemas';

const CURRENT_YEAR = new Date().getUTCFullYear();
const STRONG_PRIMARY_THRESHOLD = 0.82;
const MEDIUM_QUALITY_THRESHOLD = 0.62;
const vendorDomainPatterns = [
  'zoom.com',
  'zoom.us',
  'news.zoom.us',
  'microsoft.com',
  'learn.microsoft.com',
  'otter.ai',
  'fireflies.ai',
  'fathom.video',
  'avoma.com',
  'gong.io',
  'tldv.io',
  'read.ai',
  'meetjamie.ai',
  'jiminny.com',
];

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

function isVendorDomain(domain: string) {
  return vendorDomainPatterns.some((pattern) => domain === pattern || domain.endsWith(`.${pattern}`));
}

function detectVendorPageType(url: string | null, title: string, vendorTarget: string | null): VendorPageType | null {
  const normalizedUrl = (url ?? '').toLowerCase();
  const normalizedTitle = title.toLowerCase();
  const normalizedTarget = (vendorTarget ?? '').toLowerCase();
  const haystack = `${normalizedUrl} ${normalizedTitle} ${normalizedTarget}`;

  if (
    haystack.includes('/pricing') ||
    haystack.includes('plan') ||
    haystack.includes('price') ||
    haystack.includes('billing')
  ) {
    return 'pricing';
  }

  if (
    haystack.includes('/docs') ||
    haystack.includes('/documentation') ||
    haystack.includes('/learn') ||
    haystack.includes('/developers')
  ) {
    return 'docs';
  }

  if (
    haystack.includes('/news') ||
    haystack.includes('/blog') ||
    haystack.includes('launch') ||
    haystack.includes('introduces')
  ) {
    return 'newsroom';
  }

  if (
    haystack.includes('/compare') ||
    haystack.includes('/vs') ||
    normalizedTitle.includes('comparison')
  ) {
    return 'comparison';
  }

  if (
    haystack.includes('/product') ||
    haystack.includes('/products') ||
    haystack.includes('/features') ||
    haystack.includes('ai companion') ||
    haystack.includes('meeting assistant')
  ) {
    return 'product';
  }

  return null;
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

  if (isVendorDomain(normalizedDomain)) {
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
      return 0.62;
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

function hasProductSpecificTerms(input: string) {
  const normalized = input.toLowerCase();
  return (
    normalized.includes('meeting assistant') ||
    normalized.includes('meeting note') ||
    normalized.includes('transcription') ||
    normalized.includes('conversation intelligence') ||
    normalized.includes('meeting recap') ||
    normalized.includes('sales call')
  );
}

function getClaimType(intent: ScoredSource['queryIntent']): ClaimType {
  switch (intent) {
    case 'market-size':
      return 'market-sizing';
    case 'adoption':
      return 'adoption-signal';
    case 'competitor-features':
      return 'competitor-feature';
    case 'pricing':
      return 'pricing';
    case 'gtm-channels':
      return 'gtm-channel';
    case 'buyer-pain':
    default:
      return 'buyer-pain';
  }
}

function getEvidenceMode(
  sourceCategory: ScoredSource['sourceCategory'],
  queryIntent: ScoredSource['queryIntent'],
  combinedText: string,
): EvidenceMode {
  if (queryIntent === 'competitor-features' || queryIntent === 'pricing') {
    return sourceCategory === 'vendor' ? 'vendor-primary' : 'independent-validation';
  }

  if (hasProductSpecificTerms(combinedText)) {
    return 'product-specific';
  }

  if (queryIntent === 'buyer-pain' || queryIntent === 'gtm-channels') {
    return sourceCategory === 'official' || sourceCategory === 'research' || sourceCategory === 'media'
      ? 'independent-validation'
      : 'market-adjacent';
  }

  return 'market-adjacent';
}

export function coerceSourceCategory(value: unknown): ScoredSource['sourceCategory'] {
  return typeof value === 'string' && (sourceCategoryValues as readonly string[]).includes(value)
    ? (value as ScoredSource['sourceCategory'])
    : 'blog';
}

export function coerceSearchIntent(value: unknown): ScoredSource['queryIntent'] {
  return typeof value === 'string' && (searchIntentValues as readonly string[]).includes(value)
    ? (value as ScoredSource['queryIntent'])
    : 'buyer-pain';
}

export function coerceSectionKey(value: unknown): ScoredSource['sectionKey'] {
  return typeof value === 'string' && (finalReportSectionKeyValues as readonly string[]).includes(value)
    ? (value as ScoredSource['sectionKey'])
    : 'icp-and-buyer';
}

export function coerceClaimType(value: unknown): ClaimType {
  return typeof value === 'string' && (claimTypeValues as readonly string[]).includes(value)
    ? (value as ClaimType)
    : 'buyer-pain';
}

export function coerceEvidenceMode(value: unknown): EvidenceMode {
  return typeof value === 'string' && (evidenceModeValues as readonly string[]).includes(value)
    ? (value as EvidenceMode)
    : 'market-adjacent';
}

export function coerceVendorPageType(value: unknown): VendorPageType | null {
  return typeof value === 'string' && (vendorPageTypeValues as readonly string[]).includes(value)
    ? (value as VendorPageType)
    : null;
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
  const claimType = getClaimType(input.queryIntent);
  const evidenceMode = getEvidenceMode(sourceCategory, input.queryIntent, combinedText);
  const vendorPageType =
    input.vendorPageType ?? detectVendorPageType(input.url, input.title, input.vendorTarget);

  return {
    ...input,
    claimType,
    evidenceMode,
    vendorPageType,
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

function isCommercialIntent(intent: ScoredSource['queryIntent']) {
  return intent === 'competitor-features' || intent === 'pricing';
}

export function shouldUseSourceInSynthesis(source: Pick<ScoredSource, 'sourceCategory' | 'qualityScore' | 'queryIntent'>) {
  if (source.sourceCategory === 'official' || source.sourceCategory === 'research') {
    return source.qualityScore >= 0.74;
  }

  if (source.sourceCategory === 'media') {
    return source.qualityScore >= MEDIUM_QUALITY_THRESHOLD;
  }

  if (source.sourceCategory === 'vendor') {
    return isCommercialIntent(source.queryIntent) && source.qualityScore >= 0.54;
  }

  if (source.sourceCategory === 'blog' || source.sourceCategory === 'community') {
    return isCommercialIntent(source.queryIntent) && source.qualityScore >= 0.5;
  }

  return false;
}

export function gateSourcesForSynthesis<T extends ScoredSource>(sources: T[]) {
  return sortSourcesByQuality(sources).filter((source) => shouldUseSourceInSynthesis(source));
}

function getDomainKey(source: Pick<ScoredSource, 'domain' | 'url'>) {
  if (source.domain) {
    return source.domain.toLowerCase();
  }

  if (source.url) {
    try {
      return new URL(source.url).hostname.toLowerCase();
    } catch {
      return source.url.toLowerCase();
    }
  }

  return null;
}

export function getEvidenceRuleAssessment(
  evidence: Citation[],
  sourceIndex: Map<string, Pick<ScoredSource, 'sourceCategory' | 'qualityScore' | 'domain' | 'url'>>,
) {
  const matchedSources = evidence
    .map((citation) => sourceIndex.get(citation.evidenceId))
    .filter((source): source is NonNullable<typeof source> => Boolean(source));

  const hasStrongPrimary = matchedSources.some(
    (source) =>
      (source.sourceCategory === 'official' || source.sourceCategory === 'research') &&
      source.qualityScore >= STRONG_PRIMARY_THRESHOLD,
  );

  const mediumIndependentDomains = new Set(
    matchedSources
      .filter((source) => source.qualityScore >= MEDIUM_QUALITY_THRESHOLD)
      .map((source) => getDomainKey(source))
      .filter((domain): domain is string => Boolean(domain)),
  );

  return {
    matchedSourceCount: matchedSources.length,
    hasStrongPrimary,
    independentMediumSourceCount: mediumIndependentDomains.size,
    passes: hasStrongPrimary || mediumIndependentDomains.size >= 2,
  };
}

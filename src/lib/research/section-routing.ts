import type {
  ClaimType,
  PlannedSearchQuery,
  ResearchEvidence,
  ResearchFinding,
  SearchIntent,
} from '@/lib/research/schemas';

type SectionKey = Exclude<ResearchFinding['sectionKey'], 'recommendation'>;

const riskSubtopicTokens = [
  'adoption-barrier',
  'barrier',
  'privacy',
  'consent',
  'data-protection',
  'gdpr',
  'integration',
  'trust',
  'security',
  'compliance',
  'rollout',
  'deployment',
  'risk',
];

const gtmSubtopicTokens = [
  'buying-process',
  'channel',
  'partner',
  'msp',
  'marketplace',
  'direct',
  'purchase-friction',
  'procurement',
];

function normalize(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hasToken(input: string, tokens: string[]) {
  return tokens.some((token) => input.includes(token));
}

export function deriveSectionKeyFromIntent(
  intent: SearchIntent | null | undefined,
  subtopic: string | null | undefined,
): SectionKey {
  const normalizedSubtopic = normalize(subtopic);

  switch (intent) {
    case 'market-size':
      return 'market-landscape';
    case 'competitor-features':
      return 'competitor-landscape';
    case 'pricing':
      return 'pricing-and-packaging';
    case 'gtm-channels':
      return 'gtm-motion';
    case 'adoption':
      return hasToken(normalizedSubtopic, riskSubtopicTokens)
        ? 'risks-and-unknowns'
        : 'icp-and-buyer';
    case 'buyer-pain':
      if (hasToken(normalizedSubtopic, gtmSubtopicTokens)) {
        return 'gtm-motion';
      }

      return hasToken(normalizedSubtopic, riskSubtopicTokens)
        ? 'risks-and-unknowns'
        : 'icp-and-buyer';
    default:
      if (hasToken(normalizedSubtopic, gtmSubtopicTokens)) {
        return 'gtm-motion';
      }

      if (hasToken(normalizedSubtopic, riskSubtopicTokens)) {
        return 'risks-and-unknowns';
      }

      return 'icp-and-buyer';
  }
}

export function deriveSectionKeyFromClaimType(claimType: ClaimType | null | undefined): SectionKey {
  switch (claimType) {
    case 'market-sizing':
      return 'market-landscape';
    case 'competitor-feature':
      return 'competitor-landscape';
    case 'pricing':
      return 'pricing-and-packaging';
    case 'gtm-channel':
      return 'gtm-motion';
    case 'risk':
      return 'risks-and-unknowns';
    case 'adoption-signal':
    case 'buyer-pain':
    case 'recommendation-input':
    default:
      return 'icp-and-buyer';
  }
}

export function resolveSectionKey(input: {
  intent?: SearchIntent | null;
  subtopic?: string | null;
  sectionKey?: string | null;
  claimType?: ClaimType | null;
}): SectionKey {
  if (input.intent) {
    return deriveSectionKeyFromIntent(input.intent, input.subtopic);
  }

  if (input.claimType) {
    return deriveSectionKeyFromClaimType(input.claimType);
  }

  const explicit = normalize(input.sectionKey);
  switch (explicit) {
    case 'market-landscape':
    case 'icp-and-buyer':
    case 'competitor-landscape':
    case 'pricing-and-packaging':
    case 'gtm-motion':
    case 'risks-and-unknowns':
      return explicit;
    default:
      return deriveSectionKeyFromIntent(null, input.subtopic);
  }
}

export function resolvePlannedSearchQuery(query: PlannedSearchQuery): PlannedSearchQuery {
  return {
    ...query,
    sectionKey: resolveSectionKey({
      intent: query.intent,
      subtopic: query.subtopic,
      sectionKey: query.sectionKey,
      claimType: query.claimType,
    }),
  };
}

export function resolveEvidenceSectionKey(record: Pick<ResearchEvidence, 'sectionKey' | 'metadataJson'>): SectionKey {
  const metadata = record.metadataJson ?? {};
  const intent = normalize(metadata.queryIntent) as SearchIntent | '';
  const claimType = normalize(metadata.claimType) as ClaimType | '';

  return resolveSectionKey({
    intent: intent || undefined,
    subtopic: normalize(metadata.subtopic),
    sectionKey: record.sectionKey,
    claimType: claimType || undefined,
  });
}

export function resolveFindingSectionKey(
  finding: Pick<ResearchFinding, 'sectionKey' | 'claimType' | 'evidence'>,
  evidenceRecordIndex: Map<string, ResearchEvidence>,
): SectionKey {
  const citedSections = finding.evidence
    .map((citation) => evidenceRecordIndex.get(citation.evidenceId))
    .filter((record): record is ResearchEvidence => Boolean(record))
    .map((record) => resolveEvidenceSectionKey(record));

  if (citedSections.length > 0) {
    const sectionCounts = new Map<SectionKey, number>();
    for (const sectionKey of citedSections) {
      sectionCounts.set(sectionKey, (sectionCounts.get(sectionKey) ?? 0) + 1);
    }

    const strongestSection = Array.from(sectionCounts.entries()).sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0]);
    })[0];

    if (strongestSection) {
      return strongestSection[0];
    }
  }

  return resolveSectionKey({
    sectionKey: finding.sectionKey,
    claimType: finding.claimType,
  });
}

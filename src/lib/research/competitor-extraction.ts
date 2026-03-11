import { listCanonicalVendorPages } from '@/lib/research/vendor-registry';
import type {
  CompetitorMatrixEntry,
  ResearchEvidence,
  ResearchFinding,
} from '@/lib/research/schemas';

export interface DeterministicCompetitorProfile extends CompetitorMatrixEntry {
  evidenceIds: string[];
  hasFeatureEvidence: boolean;
  hasPricingEvidence: boolean;
}

const vendorAliases: Array<{ label: string; aliases: string[] }> = [
  { label: 'Gong', aliases: ['gong.io', 'gong'] },
  { label: 'Otter.ai', aliases: ['otter.ai', 'otter ai', 'otter'] },
  { label: 'Fireflies.ai', aliases: ['fireflies.ai', 'fireflies ai', 'fireflies'] },
  { label: 'Avoma', aliases: ['avoma.com', 'avoma'] },
  { label: 'Microsoft Teams + Microsoft 365 Copilot', aliases: ['microsoft teams', 'microsoft 365 copilot', 'teams', 'microsoft'] },
  { label: 'Zoom AI Companion', aliases: ['zoom ai companion', 'zoom'] },
  { label: 'Fathom', aliases: ['fathom.video', 'fathom'] },
];

const featureSignals: Array<[string, string[]]> = [
  ['transcription', ['transcription', 'transcribe', 'transcripts']],
  ['meeting recording', ['recording', 'record meetings', 'record meetings']],
  ['ai summaries', ['summary', 'summaries', 'recap', 'recaps']],
  ['action items', ['action items', 'next steps', 'follow-ups']],
  ['crm sync', ['crm sync', 'crm writeback', 'sync meeting notes', 'sync notes to crm']],
  ['conversation intelligence', ['conversation intelligence', 'sentiment', 'talk-to-listen', 'topic trackers', 'call analytics']],
  ['coaching workflows', ['coaching', 'scorecards', 'playlists', 'call analytics']],
];

const crmSignals = ['salesforce', 'hubspot', 'pipedrive', 'zoho', 'freshsales', 'close', 'dynamics'];
const canonicalVendorPageUrls = new Set(
  listCanonicalVendorPages().map((page) => page.url.toLowerCase()),
);

function normalizeText(input: string | null | undefined) {
  return (input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getVendorLabel(record: ResearchEvidence) {
  const candidates = [
    typeof record.metadataJson.vendorTarget === 'string' ? record.metadataJson.vendorTarget : '',
    typeof record.metadataJson.productName === 'string' ? record.metadataJson.productName : '',
    record.title,
    record.url ?? '',
  ].map(normalizeText);

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const matched = vendorAliases.find(({ aliases }) =>
      aliases.some((alias) => {
        const normalizedAlias = normalizeText(alias);
        return (
          candidate === normalizedAlias ||
          candidate.includes(normalizedAlias) ||
          normalizedAlias.includes(candidate)
        );
      }),
    );

    if (matched) {
      return matched.label;
    }
  }

  return typeof record.metadataJson.vendorTarget === 'string'
    ? record.metadataJson.vendorTarget
    : record.title.split('|')[0]?.trim() || record.title;
}

export function getCompetitorVendorLabel(record: ResearchEvidence) {
  return getVendorLabel(record);
}

function getCombinedText(record: ResearchEvidence) {
  return [
    record.title,
    record.excerpt,
    typeof record.metadataJson.targetUser === 'string' ? record.metadataJson.targetUser : '',
    typeof record.metadataJson.planPricingText === 'string' ? record.metadataJson.planPricingText : '',
    Array.isArray(record.metadataJson.coreFeatures) ? record.metadataJson.coreFeatures.join(' ') : '',
    Array.isArray(record.metadataJson.crmIntegrations)
      ? record.metadataJson.crmIntegrations.join(' ')
      : '',
  ]
    .join(' ')
    .toLowerCase();
}

function isVendorPrimary(record: ResearchEvidence) {
  return record.metadataJson.evidenceMode === 'vendor-primary';
}

function isCompetitorRecord(record: ResearchEvidence) {
  return (
    isVendorPrimary(record) &&
    (record.sectionKey === 'competitor-landscape' || record.sectionKey === 'pricing-and-packaging')
  );
}

function isCanonicalCompetitorRecord(record: ResearchEvidence) {
  if (!isCompetitorRecord(record) || !record.url) {
    return false;
  }

  const normalizedUrl = record.url.toLowerCase();
  const pageType =
    typeof record.metadataJson.vendorPageType === 'string'
      ? record.metadataJson.vendorPageType
      : 'unknown';

  if (!['product', 'docs', 'pricing'].includes(pageType)) {
    return false;
  }

  if (normalizedUrl.includes('/blog/') || normalizedUrl.includes('/press/')) {
    return false;
  }

  return canonicalVendorPageUrls.has(normalizedUrl);
}

export function isPricingRecord(record: ResearchEvidence) {
  return (
    record.sectionKey === 'pricing-and-packaging' ||
    record.metadataJson.vendorPageType === 'pricing' ||
    typeof record.metadataJson.planPricingText === 'string'
  );
}

function uniqueStrings(values: string[]) {
  return values.filter((value, index, allValues) => value && allValues.indexOf(value) === index);
}

function normalizeFeatureLabel(input: string) {
  const normalized = input.toLowerCase().trim();

  if (normalized.includes('transcript') || normalized.includes('transcription')) {
    return 'transcription';
  }
  if (normalized.includes('summary') || normalized.includes('recap')) {
    return 'AI summaries';
  }
  if (normalized.includes('meeting note') || normalized.includes('note-taking')) {
    return 'meeting notes';
  }
  if (normalized.includes('action item') || normalized.includes('next step') || normalized.includes('follow-up')) {
    return 'action items';
  }
  if (normalized.includes('crm')) {
    return 'CRM sync';
  }
  if (normalized.includes('conversation intelligence') || normalized.includes('call analytics')) {
    return 'conversation intelligence';
  }
  if (normalized.includes('coaching') || normalized.includes('scorecard') || normalized.includes('playlist')) {
    return 'coaching workflows';
  }
  if (normalized.includes('speaker')) {
    return 'speaker identification';
  }
  if (normalized.includes('record')) {
    return 'meeting recording';
  }

  return input.trim();
}

function compactSegmentLabel(input: string) {
  const normalized = input.toLowerCase();
  const labels: string[] = [];

  if (normalized.includes('uk')) {
    labels.push('UK');
  }

  if (normalized.includes('smb') || normalized.includes('small business') || normalized.includes('small team')) {
    labels.push('SMB');
  } else if (normalized.includes('mid-market')) {
    labels.push('mid-market');
  } else if (normalized.includes('enterprise')) {
    labels.push('enterprise');
  }

  if (normalized.includes('sales') || normalized.includes('revenue')) {
    labels.push('sales teams');
  } else if (normalized.includes('customer success')) {
    labels.push('customer success teams');
  } else if (normalized.includes('team')) {
    labels.push('business teams');
  }

  const compact = labels.join(' ').trim();
  return compact.length > 0 ? compact : '';
}

function extractPricePoints(input: string) {
  const normalized = input.replace(/\s+/g, ' ').trim();
  const monthlyMatches = [
    ...normalized.matchAll(
      /(?:from\s*)?([$£€]\s?\d+(?:\.\d+)?)\s*(?:\/|\bper\b)?\s*(seat|user)\s*(?:\/|\bper\b)?\s*month/gi,
    ),
  ].map((match) => `${match[1].replace(/\s+/g, '')}/${match[2].toLowerCase()}/month`);
  const monthThenUserMatches = [
    ...normalized.matchAll(
      /(?:from\s*)?([$£€]\s?\d+(?:\.\d+)?)\s*\/\s*month\s*(?:per\s*)?(seat|user)/gi,
    ),
  ].map((match) => `${match[1].replace(/\s+/g, '')}/${match[2].toLowerCase()}/month`);
  const boundedMonthlyMatches = [
    ...normalized.matchAll(
      /(?:from\s*)?([$£€]\s?\d+(?:\.\d+)?)\s*(?:monthly|monthly billing)/gi,
    ),
  ].map((match) => `${match[1].replace(/\s+/g, '')}/month`);
  const specialLabels = [
    normalized.toLowerCase().includes('free') ? 'free plan' : '',
    normalized.toLowerCase().includes('enterprise') || normalized.toLowerCase().includes('contact')
      ? 'enterprise/contact'
      : '',
  ].filter(Boolean);

  return uniqueStrings([...monthlyMatches, ...monthThenUserMatches, ...boundedMonthlyMatches, ...specialLabels]).slice(0, 3);
}

function inferIcp(records: ResearchEvidence[]) {
  const explicitTarget = records
    .map((record) =>
      typeof record.metadataJson.targetUser === 'string' ? record.metadataJson.targetUser.trim() : '',
    )
    .find(Boolean);

  if (explicitTarget) {
    const compact = compactSegmentLabel(explicitTarget);
    if (compact) {
      return compact;
    }
  }

  const combined = records.map(getCombinedText).join(' ');
  if (combined.includes('sales') && (combined.includes('small') || combined.includes('smb'))) {
    return 'SMB sales teams';
  }
  if (combined.includes('sales')) {
    return 'Sales teams';
  }
  if (combined.includes('small teams') || combined.includes('small business')) {
    return 'SMB teams';
  }
  return 'Business teams';
}

function inferCoreFeatures(records: ResearchEvidence[]) {
  const explicitFeatures = records.flatMap((record) =>
    Array.isArray(record.metadataJson.coreFeatures)
      ? record.metadataJson.coreFeatures
          .filter((value): value is string => typeof value === 'string')
          .map(normalizeFeatureLabel)
      : [],
  );

  const combined = records.map(getCombinedText).join(' ');
  const inferredFeatures = featureSignals
    .filter(([, keywords]) => keywords.some((keyword) => combined.includes(keyword)))
    .map(([label]) => normalizeFeatureLabel(label));

  return uniqueStrings([...explicitFeatures, ...inferredFeatures]).slice(0, 6);
}

function inferCrmIntegrations(records: ResearchEvidence[]) {
  const explicit = records.flatMap((record) =>
    Array.isArray(record.metadataJson.crmIntegrations)
      ? record.metadataJson.crmIntegrations.filter((value): value is string => typeof value === 'string')
      : [],
  );

  const combined = records.map(getCombinedText).join(' ');
  const inferred = crmSignals.filter((crm) => combined.includes(crm));

  return uniqueStrings(
    [...explicit, ...inferred].map((value) =>
      value === 'hubspot'
        ? 'HubSpot'
        : value === 'salesforce'
          ? 'Salesforce'
          : value === 'pipedrive'
            ? 'Pipedrive'
            : value === 'zoho'
              ? 'Zoho'
              : value === 'freshsales'
                ? 'Freshsales'
                : value === 'close'
                  ? 'Close'
                  : value === 'dynamics'
                    ? 'Microsoft Dynamics'
                    : value,
    ),
  ).slice(0, 6);
}

function trimEvidenceText(input: string) {
  const normalized = input.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 140) {
    return normalized;
  }

  return `${normalized.slice(0, 137).trimEnd()}...`;
}

function isDiscountPricingText(input: string) {
  const normalized = input.toLowerCase();
  return (
    normalized.includes('student') ||
    normalized.includes('teacher') ||
    normalized.includes('.edu') ||
    normalized.includes('discounted price') ||
    normalized.includes('discounted prices') ||
    normalized.includes('education discount')
  );
}

function getPriceValue(pricePoint: string) {
  const match = pricePoint.match(/[$£€]\s?(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function buildPricingSummary(pricePoints: string[]) {
  const normalized = uniqueStrings(pricePoints);
  const hasFreePlan = normalized.includes('free plan');
  const hasEnterpriseContact = normalized.includes('enterprise/contact');
  const selfServePrices = normalized
    .filter((pricePoint) => pricePoint !== 'free plan' && pricePoint !== 'enterprise/contact')
    .sort((left, right) => getPriceValue(left) - getPriceValue(right));
  const summaryParts: string[] = [];

  if (hasFreePlan) {
    summaryParts.push('free plan');
  }

  if (selfServePrices.length > 0) {
    summaryParts.push(`self-serve from ${selfServePrices.slice(0, 2).join(', ')}`);
  }

  if (hasEnterpriseContact) {
    summaryParts.push('enterprise/contact');
  }

  return summaryParts.join('; ');
}

function inferPricingEvidence(records: ResearchEvidence[]) {
  const pricingRecords = records.filter(isPricingRecord);
  if (pricingRecords.length === 0) {
    return 'Pricing not established from canonical vendor evidence.';
  }

  const pricingPageRecords = pricingRecords.filter(
    (record) => record.metadataJson.vendorPageType === 'pricing',
  );
  const nonDiscountPricingRecords = pricingPageRecords.filter((record) => {
    const pricingText =
      typeof record.metadataJson.planPricingText === 'string' && record.metadataJson.planPricingText.trim()
        ? record.metadataJson.planPricingText
        : record.excerpt;
    return !isDiscountPricingText(pricingText);
  });
  const prioritizedRecords =
    nonDiscountPricingRecords.length > 0
      ? nonDiscountPricingRecords
      : pricingPageRecords.length > 0
        ? pricingPageRecords
        : pricingRecords;
  const pricePoints = uniqueStrings(
    prioritizedRecords.flatMap((record) =>
      extractPricePoints(
        typeof record.metadataJson.planPricingText === 'string' && record.metadataJson.planPricingText.trim()
          ? record.metadataJson.planPricingText
          : record.excerpt,
      ),
    ),
  );

  if (pricePoints.length > 0) {
    return trimEvidenceText(buildPricingSummary(pricePoints));
  }

  const fallbackPricePoints = uniqueStrings(
    pricingRecords.flatMap((record) =>
      extractPricePoints(
        typeof record.metadataJson.planPricingText === 'string' && record.metadataJson.planPricingText.trim()
          ? record.metadataJson.planPricingText
          : record.excerpt,
      ),
    ),
  );

  if (fallbackPricePoints.length > 0) {
    return trimEvidenceText(buildPricingSummary(fallbackPricePoints));
  }

  return trimEvidenceText(
    uniqueStrings(
      pricingRecords.map((record) =>
        typeof record.metadataJson.vendorPageType === 'string' && record.metadataJson.vendorPageType === 'pricing'
          ? 'pricing page available'
          : record.title,
      ),
    ).slice(0, 2).join(' | '),
  );
}

function inferTargetSegment(records: ResearchEvidence[]) {
  const combined = records.map(getCombinedText).join(' ');

  if (combined.includes('sales') && (combined.includes('small') || combined.includes('smb'))) {
    return 'SMB sales teams';
  }
  if (combined.includes('enterprise') && (combined.includes('small') || combined.includes('business'))) {
    return 'SMB to enterprise teams';
  }
  if (combined.includes('enterprise')) {
    return 'Enterprise teams';
  }

  if (combined.includes('small teams') || combined.includes('small business')) {
    return 'SMB buyers';
  }

  if (combined.includes('sales')) {
    return 'Sales teams';
  }

  return 'Business teams';
}

function inferConfidence(records: ResearchEvidence[], hasFeatureEvidence: boolean, hasPricingEvidence: boolean) {
  if (records.length >= 3 && hasFeatureEvidence && hasPricingEvidence) {
    return 'high' as const;
  }

  if (records.length >= 2 && hasFeatureEvidence) {
    return 'medium' as const;
  }

  return 'low' as const;
}

export function buildDeterministicCompetitorProfiles(evidenceRecords: ResearchEvidence[]) {
  const grouped = new Map<string, ResearchEvidence[]>();

  for (const record of evidenceRecords.filter(isCanonicalCompetitorRecord)) {
    const vendor = getVendorLabel(record);
    const existing = grouped.get(vendor) ?? [];
    existing.push(record);
    grouped.set(vendor, existing);
  }

  const profiles: DeterministicCompetitorProfile[] = [];

  for (const [vendor, records] of grouped.entries()) {
    const hasFeatureEvidence = records.some((record) => record.sectionKey === 'competitor-landscape');
    const hasPricingEvidence = records.some(isPricingRecord);
    const coreFeatures = inferCoreFeatures(records);

    if (coreFeatures.length === 0) {
      continue;
    }

    profiles.push({
      vendor,
      icp: inferIcp(records),
      coreFeatures,
      crmIntegrations: inferCrmIntegrations(records),
      pricingEvidence: inferPricingEvidence(records),
      targetSegment: inferTargetSegment(records),
      confidence: inferConfidence(records, hasFeatureEvidence, hasPricingEvidence),
      evidenceIds: uniqueStrings(records.map((record) => record.id)),
      hasFeatureEvidence,
      hasPricingEvidence,
    });
  }

  return profiles.sort((left, right) => {
    const confidenceRank = { high: 0, medium: 1, low: 2 };
    return confidenceRank[left.confidence] - confidenceRank[right.confidence];
  });
}

export function buildCompetitorMatrixEntries(evidenceRecords: ResearchEvidence[]): CompetitorMatrixEntry[] {
  return buildDeterministicCompetitorProfiles(evidenceRecords).map((profile) => ({
    vendor: profile.vendor,
    icp: profile.icp,
    coreFeatures: profile.coreFeatures,
    crmIntegrations: profile.crmIntegrations,
    pricingEvidence: profile.pricingEvidence,
    targetSegment: profile.targetSegment,
    confidence: profile.confidence,
  }));
}

export function buildCompetitorProfileSummary(evidenceRecords: ResearchEvidence[]) {
  const profiles = buildDeterministicCompetitorProfiles(evidenceRecords);

  if (profiles.length === 0) {
    return 'No deterministic vendor profiles could be built from vendor-primary evidence.';
  }

  return profiles
    .map((profile) =>
      [
        `Vendor: ${profile.vendor}`,
        `ICP: ${profile.icp}`,
        `Core features: ${profile.coreFeatures.join(', ')}`,
        `CRM integrations: ${profile.crmIntegrations.join(', ') || 'Not established'}`,
        `Pricing evidence: ${profile.pricingEvidence}`,
        `Target segment: ${profile.targetSegment}`,
        `Confidence: ${profile.confidence}`,
        `Evidence IDs: ${profile.evidenceIds.join(', ')}`,
      ].join('\n'),
    )
    .join('\n\n---\n\n');
}

export function buildCompetitorDeltaInputs(findings: ResearchFinding[]) {
  return findings.filter((finding) => finding.sectionKey === 'competitor-landscape');
}

export function countDistinctCompetitorVendors(evidenceRecords: ResearchEvidence[]) {
  return uniqueStrings(evidenceRecords.filter(isCompetitorRecord).map(getVendorLabel)).length;
}

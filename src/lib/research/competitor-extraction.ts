import { listCanonicalVendorPages } from '@/lib/research/vendor-registry';
import type {
  CompetitorMatrixEntry,
  ResearchEvidence,
  ResearchFinding,
} from '@/lib/research/schemas';
import { resolveEvidenceSectionKey } from '@/lib/research/section-routing';
import {
  extractGenericCapabilityPhrases,
  extractGenericEcosystemSignals,
  normalizeResearchText,
} from '@/lib/research/topic-utils';

export interface DeterministicCompetitorProfile extends CompetitorMatrixEntry {
  evidenceIds: string[];
  hasFeatureEvidence: boolean;
  hasPricingEvidence: boolean;
}

const vendorDisplayOverrides: Record<string, string> = {
  gong: 'Gong',
  otter: 'Otter.ai',
  'otter ai': 'Otter.ai',
  fireflies: 'Fireflies.ai',
  'fireflies ai': 'Fireflies.ai',
  avoma: 'Avoma',
  fathom: 'Fathom',
  microsoft: 'Microsoft',
  'microsoft teams': 'Microsoft Teams',
  zoom: 'Zoom',
  tesla: 'Tesla',
  powervault: 'Powervault',
};
const canonicalVendorPageUrls = new Set(
  listCanonicalVendorPages().map((page) => page.url.toLowerCase()),
);

function normalizeText(input: string | null | undefined) {
  return normalizeResearchText(input ?? '');
}

function getVendorLabel(record: ResearchEvidence) {
  const vendorTarget =
    typeof record.metadataJson.vendorTarget === 'string' ? record.metadataJson.vendorTarget.trim() : '';
  if (vendorTarget) {
    return vendorDisplayOverrides[normalizeText(vendorTarget)] ?? vendorTarget;
  }

  const productName =
    typeof record.metadataJson.productName === 'string' ? record.metadataJson.productName.trim() : '';
  if (productName) {
    return vendorDisplayOverrides[normalizeText(productName)] ?? productName;
  }

  if (record.url) {
    try {
      const hostname = new URL(record.url).hostname.replace(/^www\./, '');
      const domainStem = hostname.split('.').slice(0, -1).join(' ').trim();
      if (domainStem) {
        return (
          vendorDisplayOverrides[normalizeText(domainStem)] ??
          domainStem.replace(/\b\w/g, (char) => char.toUpperCase())
        );
      }
    } catch {
      // Ignore malformed URL and fall back to title parsing.
    }
  }

  const titleStem = record.title.split('|')[0]?.trim() || record.title;
  return vendorDisplayOverrides[normalizeText(titleStem)] ?? titleStem;
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
  const resolvedSection = resolveEvidenceSectionKey(record);
  return (
    isVendorPrimary(record) &&
    (resolvedSection === 'competitor-landscape' || resolvedSection === 'pricing-and-packaging')
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

  if (canonicalVendorPageUrls.has(normalizedUrl)) {
    return true;
  }

  const vendorTarget =
    typeof record.metadataJson.vendorTarget === 'string' ? normalizeText(record.metadataJson.vendorTarget) : '';
  const combined = normalizeText(
    [
      record.url,
      record.title,
      typeof record.metadataJson.productName === 'string' ? record.metadataJson.productName : '',
      typeof record.metadataJson.vendorTarget === 'string' ? record.metadataJson.vendorTarget : '',
    ].join(' '),
  );

  return Boolean(
    vendorTarget &&
      vendorTarget
        .split(' ')
        .filter((token) => token.length >= 3)
        .some((token) => combined.includes(token)),
  );
}

export function isPricingRecord(record: ResearchEvidence) {
  const resolvedSection = resolveEvidenceSectionKey(record);
  return (
    resolvedSection === 'pricing-and-packaging' ||
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
  if (combined.includes('homeowner') || combined.includes('owner occupied') || combined.includes('household')) {
    return 'Homeowners';
  }
  if (combined.includes('installer')) {
    return 'Installers';
  }
  if (combined.includes('sales') && (combined.includes('small') || combined.includes('smb'))) {
    return 'SMB sales teams';
  }
  if (combined.includes('sales')) {
    return 'Sales teams';
  }
  if (combined.includes('small teams') || combined.includes('small business')) {
    return 'SMB teams';
  }
  if (combined.includes('enterprise')) {
    return 'Enterprise buyers';
  }

  return 'Target segment not explicit';
}

function inferCoreFeatures(records: ResearchEvidence[]) {
  const explicitFeatures = records.flatMap((record) =>
    Array.isArray(record.metadataJson.coreFeatures)
      ? record.metadataJson.coreFeatures
          .filter((value): value is string => typeof value === 'string')
          .map(normalizeFeatureLabel)
      : [],
  );

  const inferredFeatures = records.flatMap((record) =>
    extractGenericCapabilityPhrases(getCombinedText(record), 6).map(normalizeFeatureLabel),
  );

  return uniqueStrings([...explicitFeatures, ...inferredFeatures]).slice(0, 6);
}

function inferCrmIntegrations(records: ResearchEvidence[]) {
  const explicit = records.flatMap((record) =>
    Array.isArray(record.metadataJson.crmIntegrations)
      ? record.metadataJson.crmIntegrations.filter((value): value is string => typeof value === 'string')
      : [],
  );

  const inferred = records.flatMap((record) =>
    extractGenericEcosystemSignals(getCombinedText(record), 5),
  );

  return uniqueStrings([...explicit, ...inferred]).slice(0, 6);
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

  if (combined.includes('homeowner') || combined.includes('owner occupied') || combined.includes('household')) {
    return 'Homeowners';
  }
  if (combined.includes('installer') || combined.includes('dealer') || combined.includes('reseller')) {
    return 'Installer / channel-led buyers';
  }
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

  return 'Category buyers';
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
    const hasFeatureEvidence = records.some(
      (record) => resolveEvidenceSectionKey(record) === 'competitor-landscape',
    );
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
        `Integrations / ecosystem: ${profile.crmIntegrations.join(', ') || 'Not established'}`,
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

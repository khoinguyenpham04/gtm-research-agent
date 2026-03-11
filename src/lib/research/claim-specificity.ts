import type {
  Citation,
  ClaimType,
  EvidenceMode,
  InferenceLabel,
  ResearchEvidence,
  ResearchFinding,
} from '@/lib/research/schemas';
import { resolveEvidenceSectionKey } from '@/lib/research/section-routing';
import { getGtmEvidenceSignals } from '@/lib/research/section-policy';

const claimTypeBySection: Record<ResearchFinding['sectionKey'], ClaimType> = {
  'market-landscape': 'market-sizing',
  'icp-and-buyer': 'adoption-signal',
  'competitor-landscape': 'competitor-feature',
  'pricing-and-packaging': 'pricing',
  'gtm-motion': 'gtm-channel',
  'risks-and-unknowns': 'risk',
  recommendation: 'recommendation-input',
};

const evidenceModePriority: Record<EvidenceMode, number> = {
  'document-internal': 5,
  'vendor-primary': 4,
  'product-specific': 3,
  'independent-validation': 2,
  'market-adjacent': 1,
};

function getEvidenceMode(record: ResearchEvidence): EvidenceMode {
  if (record.sourceType === 'document') {
    return 'document-internal';
  }

  const value = record.metadataJson.evidenceMode;
  if (
    value === 'market-adjacent' ||
    value === 'product-specific' ||
    value === 'vendor-primary' ||
    value === 'independent-validation' ||
    value === 'document-internal'
  ) {
  if (
    value === 'market-adjacent' &&
      resolveEvidenceSectionKey(record) === 'risks-and-unknowns' &&
      hasBarrierSignals(record)
  ) {
      return 'independent-validation';
    }

    return value;
  }

  return 'market-adjacent';
}

function getQueryIntent(record: ResearchEvidence) {
  return typeof record.metadataJson.queryIntent === 'string' ? record.metadataJson.queryIntent : null;
}

function getVendorPageType(record: ResearchEvidence) {
  return typeof record.metadataJson.vendorPageType === 'string'
    ? record.metadataJson.vendorPageType
    : 'unknown';
}

function getPlanPricingText(record: ResearchEvidence) {
  return typeof record.metadataJson.planPricingText === 'string'
    ? record.metadataJson.planPricingText
    : null;
}

function getCombinedEvidenceText(record: ResearchEvidence) {
  return [
    record.title,
    record.excerpt,
    typeof record.metadataJson.productName === 'string' ? record.metadataJson.productName : '',
    typeof record.metadataJson.targetUser === 'string' ? record.metadataJson.targetUser : '',
    Array.isArray(record.metadataJson.coreFeatures) ? record.metadataJson.coreFeatures.join(' ') : '',
    Array.isArray(record.metadataJson.crmIntegrations)
      ? record.metadataJson.crmIntegrations.join(' ')
      : '',
  ]
    .join(' ')
    .toLowerCase();
}

function hasBuyingBehaviorSignals(record: ResearchEvidence) {
  const combined = `${getCombinedEvidenceText(record)} ${String(record.metadataJson.query ?? '')}`;
  return (
    combined.includes('buying') ||
    combined.includes('buyer behavior') ||
    combined.includes('purchase') ||
    combined.includes('channel') ||
    combined.includes('choose software') ||
    combined.includes('decision') ||
    combined.includes('partnership') ||
    combined.includes('reseller') ||
    combined.includes('referral') ||
    combined.includes('search') ||
    combined.includes('software buying')
  );
}

function hasBarrierSignals(record: ResearchEvidence) {
  const combined = getCombinedEvidenceText(record);
  return (
    combined.includes('barrier') ||
    combined.includes('barriers') ||
    combined.includes('lack of funding') ||
    combined.includes('cost') ||
    combined.includes('costs') ||
    combined.includes('roi') ||
    combined.includes('privacy') ||
    combined.includes('trust') ||
    combined.includes('security') ||
    combined.includes('skills') ||
    combined.includes('lack of skilled personnel') ||
    combined.includes('integration') ||
    combined.includes('reliability') ||
    combined.includes('uncertain') ||
    combined.includes('scam')
  );
}

function getSourceStrength(record: ResearchEvidence) {
  return typeof record.metadataJson.qualityScore === 'number'
    ? record.metadataJson.qualityScore
    : record.sourceType === 'document'
      ? 0.84
      : 0;
}

function getDominantEvidenceMode(evidenceRecords: ResearchEvidence[]): EvidenceMode {
  if (evidenceRecords.length === 0) {
    return 'market-adjacent';
  }

  return [...evidenceRecords]
    .sort(
      (left, right) =>
        evidenceModePriority[getEvidenceMode(right)] - evidenceModePriority[getEvidenceMode(left)],
    )[0]
    ? getEvidenceMode(
        [...evidenceRecords].sort(
          (left, right) =>
            evidenceModePriority[getEvidenceMode(right)] - evidenceModePriority[getEvidenceMode(left)],
        )[0],
      )
    : 'market-adjacent';
}

export function getDefaultClaimType(sectionKey: ResearchFinding['sectionKey']): ClaimType {
  return claimTypeBySection[sectionKey];
}

export function inferFindingSpecificity(
  sectionKey: ResearchFinding['sectionKey'],
  evidenceRecords: ResearchEvidence[],
): {
  claimType: ClaimType;
  evidenceMode: EvidenceMode;
  inferenceLabel: InferenceLabel;
  notes: string[];
} {
  const claimType = getDefaultClaimType(sectionKey);
  const evidenceMode = getDominantEvidenceMode(evidenceRecords);
  const strongEvidenceCount = evidenceRecords.filter((record) => getSourceStrength(record) >= 0.8).length;
  const vendorPrimaryCount = evidenceRecords.filter(
    (record) => getEvidenceMode(record) === 'vendor-primary',
  ).length;
  const pricingEvidenceCount = evidenceRecords.filter(
    (record) =>
      getEvidenceMode(record) === 'vendor-primary' &&
      (getVendorPageType(record) === 'pricing' || Boolean(getPlanPricingText(record))),
  ).length;
  const vendorFeatureEvidenceCount = evidenceRecords.filter(
    (record) =>
      getEvidenceMode(record) === 'vendor-primary' &&
      ['product', 'docs', 'newsroom', 'comparison'].includes(getVendorPageType(record)),
  ).length;
  const independentSpecificCount = evidenceRecords.filter((record) => {
    const mode = getEvidenceMode(record);
    return mode === 'product-specific' || mode === 'independent-validation';
  }).length;
  const notes: string[] = [];

  if (sectionKey === 'competitor-landscape') {
    if (vendorPrimaryCount >= 1 && vendorFeatureEvidenceCount >= 1) {
      return {
        claimType,
        evidenceMode,
        inferenceLabel: strongEvidenceCount > 0 ? 'direct' : 'inferred',
        notes,
      };
    }

    notes.push('Claim lacks vendor-primary product/docs/newsroom evidence for a competitor section.');
    return { claimType, evidenceMode, inferenceLabel: 'speculative', notes };
  }

  if (sectionKey === 'pricing-and-packaging') {
    if (vendorPrimaryCount >= 1 && pricingEvidenceCount >= 1) {
      return {
        claimType,
        evidenceMode,
        inferenceLabel: 'direct',
        notes,
      };
    }

    notes.push('Claim lacks vendor-primary pricing evidence for a pricing section.');
    return { claimType, evidenceMode, inferenceLabel: 'speculative', notes };
  }

  if (sectionKey === 'gtm-motion') {
    const gtmSignals = getGtmEvidenceSignals(evidenceRecords);
    const hasCompleteMotionEvidence =
      gtmSignals.buyingProcessCount >= 1 &&
      gtmSignals.channelCount >= 1 &&
      gtmSignals.partnerPreferenceCount >= 1 &&
      gtmSignals.purchaseFrictionCount >= 1;

    if (hasCompleteMotionEvidence || evidenceMode === 'document-internal') {
      return { claimType, evidenceMode, inferenceLabel: 'direct', notes };
    }

    if (evidenceRecords.some(hasBuyingBehaviorSignals)) {
      notes.push('Claim covers only part of the GTM motion and is missing channel, partner/direct, or purchase-friction evidence.');
      return { claimType, evidenceMode, inferenceLabel: 'inferred', notes };
    }

    notes.push('Claim lacks direct buying-process, channel, partner/direct, or purchase-friction evidence for GTM motion.');
    return { claimType, evidenceMode, inferenceLabel: 'speculative', notes };
  }

  if (sectionKey === 'risks-and-unknowns') {
    if (
      (independentSpecificCount >= 1 && evidenceRecords.some(hasBarrierSignals)) ||
      evidenceMode === 'document-internal'
    ) {
      return {
        claimType,
        evidenceMode: evidenceMode === 'document-internal' ? 'document-internal' : 'independent-validation',
        inferenceLabel: 'direct',
        notes,
      };
    }

    notes.push('Claim relies on adjacent evidence rather than direct risk or adoption-barrier evidence.');
    return { claimType, evidenceMode, inferenceLabel: 'inferred', notes };
  }

  if (
    sectionKey === 'market-landscape' &&
    evidenceRecords.every((record) => getQueryIntent(record) === 'adoption' || getEvidenceMode(record) === 'market-adjacent')
  ) {
    notes.push('General AI adoption evidence only supports product-category demand as an inference.');
    return { claimType, evidenceMode, inferenceLabel: 'inferred', notes };
  }

  if (evidenceMode === 'market-adjacent') {
    notes.push('Claim is inferred from adjacent market evidence rather than product-specific evidence.');
    return { claimType, evidenceMode, inferenceLabel: 'inferred', notes };
  }

  return { claimType, evidenceMode, inferenceLabel: 'direct', notes };
}

export function buildFindingEvidenceRecords(
  finding: Pick<ResearchFinding, 'evidence'>,
  evidenceById: Map<string, ResearchEvidence>,
) {
  return finding.evidence
    .map((citation) => evidenceById.get(citation.evidenceId))
    .filter((record): record is ResearchEvidence => Boolean(record));
}

export function buildEvidenceByCitation(
  citations: Citation[],
  evidenceById: Map<string, ResearchEvidence>,
) {
  return citations
    .map((citation) => evidenceById.get(citation.evidenceId))
    .filter((record): record is ResearchEvidence => Boolean(record));
}

import type {
  DraftReportSection,
  ResearchEvidence,
  ResearchFinding,
  RetrievalCandidate,
  SearchIntent,
  SectionStatus,
} from '@/lib/research/schemas';
import { deriveSectionKeyFromIntent, resolveEvidenceSectionKey, resolveSectionKey } from '@/lib/research/section-routing';

type SectionKey = ResearchFinding['sectionKey'];

interface SectionPolicy {
  minEvidence: number;
  minVerifiedFindings: number;
  minStrongEvidence: number;
  minVendorPrimaryEvidence: number;
  minProductCategoryEvidence: number;
  minBarrierEvidence: number;
  minBuyingProcessEvidence: number;
  minChannelEvidence: number;
  minPartnerPreferenceEvidence: number;
  minPurchaseFrictionEvidence: number;
  maxWeakEvidence: number;
  allowedSourceTypes: Array<ResearchEvidence['sourceType']>;
  allowedCategories: string[];
  allowedEvidenceModes: string[];
  derivedOnly?: boolean;
  recommendationDependencies?: SectionKey[];
}

export const searchIntentToSectionKey: Record<SearchIntent, SectionKey> = {
  'market-size': deriveSectionKeyFromIntent('market-size', null),
  adoption: deriveSectionKeyFromIntent('adoption', null),
  'competitor-features': deriveSectionKeyFromIntent('competitor-features', null),
  pricing: deriveSectionKeyFromIntent('pricing', null),
  'buyer-pain': deriveSectionKeyFromIntent('buyer-pain', null),
  'gtm-channels': deriveSectionKeyFromIntent('gtm-channels', null),
};

const sectionPolicyByKey: Record<SectionKey, SectionPolicy> = {
  'market-landscape': {
    minEvidence: 2,
    minVerifiedFindings: 1,
    minStrongEvidence: 1,
    minVendorPrimaryEvidence: 0,
    minProductCategoryEvidence: 1,
    minBarrierEvidence: 0,
    minBuyingProcessEvidence: 0,
    minChannelEvidence: 0,
    minPartnerPreferenceEvidence: 0,
    minPurchaseFrictionEvidence: 0,
    maxWeakEvidence: 1,
    allowedSourceTypes: ['web', 'document'],
    allowedCategories: ['official', 'research', 'media'],
    allowedEvidenceModes: ['market-adjacent', 'product-specific', 'independent-validation', 'document-internal'],
  },
  'icp-and-buyer': {
    minEvidence: 2,
    minVerifiedFindings: 1,
    minStrongEvidence: 1,
    minVendorPrimaryEvidence: 0,
    minProductCategoryEvidence: 0,
    minBarrierEvidence: 0,
    minBuyingProcessEvidence: 0,
    minChannelEvidence: 0,
    minPartnerPreferenceEvidence: 0,
    minPurchaseFrictionEvidence: 0,
    maxWeakEvidence: 1,
    allowedSourceTypes: ['web', 'document'],
    allowedCategories: ['official', 'research', 'media'],
    allowedEvidenceModes: ['market-adjacent', 'product-specific', 'independent-validation', 'document-internal'],
  },
  'competitor-landscape': {
    minEvidence: 2,
    minVerifiedFindings: 1,
    minStrongEvidence: 0,
    minVendorPrimaryEvidence: 1,
    minProductCategoryEvidence: 0,
    minBarrierEvidence: 0,
    minBuyingProcessEvidence: 0,
    minChannelEvidence: 0,
    minPartnerPreferenceEvidence: 0,
    minPurchaseFrictionEvidence: 0,
    maxWeakEvidence: 2,
    allowedSourceTypes: ['web', 'document'],
    allowedCategories: ['vendor', 'media', 'research'],
    allowedEvidenceModes: ['vendor-primary', 'independent-validation', 'document-internal'],
  },
  'pricing-and-packaging': {
    minEvidence: 2,
    minVerifiedFindings: 1,
    minStrongEvidence: 0,
    minVendorPrimaryEvidence: 1,
    minProductCategoryEvidence: 0,
    minBarrierEvidence: 0,
    minBuyingProcessEvidence: 0,
    minChannelEvidence: 0,
    minPartnerPreferenceEvidence: 0,
    minPurchaseFrictionEvidence: 0,
    maxWeakEvidence: 1,
    allowedSourceTypes: ['web', 'document'],
    allowedCategories: ['vendor', 'media', 'research'],
    allowedEvidenceModes: ['vendor-primary', 'independent-validation', 'document-internal'],
  },
  'gtm-motion': {
    minEvidence: 4,
    minVerifiedFindings: 1,
    minStrongEvidence: 1,
    minVendorPrimaryEvidence: 0,
    minProductCategoryEvidence: 0,
    minBarrierEvidence: 0,
    minBuyingProcessEvidence: 1,
    minChannelEvidence: 1,
    minPartnerPreferenceEvidence: 1,
    minPurchaseFrictionEvidence: 1,
    maxWeakEvidence: 1,
    allowedSourceTypes: ['web', 'document'],
    allowedCategories: ['official', 'research', 'media'],
    allowedEvidenceModes: ['independent-validation', 'document-internal'],
  },
  'risks-and-unknowns': {
    minEvidence: 1,
    minVerifiedFindings: 1,
    minStrongEvidence: 1,
    minVendorPrimaryEvidence: 0,
    minProductCategoryEvidence: 0,
    minBarrierEvidence: 1,
    minBuyingProcessEvidence: 0,
    minChannelEvidence: 0,
    minPartnerPreferenceEvidence: 0,
    minPurchaseFrictionEvidence: 0,
    maxWeakEvidence: 1,
    allowedSourceTypes: ['web', 'document'],
    allowedCategories: ['official', 'research', 'media'],
    allowedEvidenceModes: ['independent-validation', 'document-internal'],
  },
  recommendation: {
    minEvidence: 0,
    minVerifiedFindings: 2,
    minStrongEvidence: 0,
    minVendorPrimaryEvidence: 0,
    minProductCategoryEvidence: 0,
    minBarrierEvidence: 0,
    minBuyingProcessEvidence: 0,
    minChannelEvidence: 0,
    minPartnerPreferenceEvidence: 0,
    minPurchaseFrictionEvidence: 0,
    maxWeakEvidence: 0,
    allowedSourceTypes: [],
    allowedCategories: [],
    allowedEvidenceModes: [],
    derivedOnly: true,
    recommendationDependencies: [
      'market-landscape',
      'icp-and-buyer',
      'gtm-motion',
      'pricing-and-packaging',
      'risks-and-unknowns',
    ],
  },
};

export function getSectionPolicy(sectionKey: SectionKey) {
  return sectionPolicyByKey[sectionKey];
}

function getEvidenceCategory(record: ResearchEvidence) {
  return typeof record.metadataJson.sourceCategory === 'string'
    ? record.metadataJson.sourceCategory
    : record.sourceType === 'document'
      ? 'research'
      : 'blog';
}

function getEvidenceStrength(record: ResearchEvidence) {
  return typeof record.metadataJson.qualityScore === 'number'
    ? record.metadataJson.qualityScore
    : record.sourceType === 'document'
      ? 0.84
      : 0;
}

function getEvidenceMode(record: ResearchEvidence) {
  const storedMode =
    typeof record.metadataJson.evidenceMode === 'string'
      ? record.metadataJson.evidenceMode
      : record.sourceType === 'document'
        ? 'document-internal'
        : 'market-adjacent';

  if (
    storedMode === 'market-adjacent' &&
    resolveEvidenceSectionKey(record) === 'risks-and-unknowns' &&
    ['official', 'research', 'media'].includes(getEvidenceCategory(record)) &&
    hasBarrierSignals(record)
  ) {
    return 'independent-validation';
  }

  return storedMode;
}

function getEvidenceSection(record: ResearchEvidence) {
  return resolveEvidenceSectionKey(record);
}

function getEvidenceText(record: ResearchEvidence) {
  return [
    record.title,
    record.excerpt,
    typeof record.metadataJson.query === 'string' ? record.metadataJson.query : '',
    typeof record.metadataJson.productName === 'string' ? record.metadataJson.productName : '',
    typeof record.metadataJson.targetUser === 'string' ? record.metadataJson.targetUser : '',
    typeof record.metadataJson.planPricingText === 'string' ? record.metadataJson.planPricingText : '',
    typeof record.metadataJson.vendorPageType === 'string' ? record.metadataJson.vendorPageType : '',
    Array.isArray(record.metadataJson.coreFeatures) ? record.metadataJson.coreFeatures.join(' ') : '',
    Array.isArray(record.metadataJson.crmIntegrations)
      ? record.metadataJson.crmIntegrations.join(' ')
      : '',
  ]
    .join(' ')
    .toLowerCase();
}

function hasProductCategorySignals(record: ResearchEvidence) {
  const mode = getEvidenceMode(record);
  if (mode === 'product-specific' || mode === 'vendor-primary' || mode === 'document-internal') {
    return true;
  }

  const combined = getEvidenceText(record);
  return (
    combined.includes('meeting assistant') ||
    combined.includes('meeting assistants') ||
    combined.includes('conversation intelligence') ||
    combined.includes('ai note taker') ||
    combined.includes('meeting notes') ||
    combined.includes('call summaries') ||
    combined.includes('sales agent')
  );
}

function hasBarrierSignals(record: ResearchEvidence) {
  const combined = getEvidenceText(record);
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

function hasBuyingProcessSignals(record: ResearchEvidence) {
  const combined = getEvidenceText(record);
  return (
    combined.includes('buying process') ||
    combined.includes('software buying') ||
    combined.includes('buyer journey') ||
    combined.includes('purchase process') ||
    combined.includes('procurement') ||
    combined.includes('evaluate vendors') ||
    combined.includes('evaluation') ||
    combined.includes('shortlist') ||
    combined.includes('decision-maker') ||
    combined.includes('approval') ||
    combined.includes('purchase decision')
  );
}

function hasChannelSignals(record: ResearchEvidence) {
  const combined = getEvidenceText(record);
  return (
    combined.includes('channel') ||
    combined.includes('go to market') ||
    combined.includes('go-to-market') ||
    combined.includes('marketplace') ||
    combined.includes('reseller') ||
    combined.includes('partner-led') ||
    combined.includes('self-serve') ||
    combined.includes('direct purchase') ||
    combined.includes('buy direct') ||
    combined.includes('app marketplace')
  );
}

function hasPartnerPreferenceSignals(record: ResearchEvidence) {
  const combined = getEvidenceText(record);
  return (
    combined.includes('msp') ||
    combined.includes('managed service') ||
    combined.includes('reseller') ||
    combined.includes('partner') ||
    combined.includes('channel partner') ||
    combined.includes('direct purchase') ||
    combined.includes('buy direct') ||
    combined.includes('marketplace') ||
    combined.includes('referral')
  );
}

function hasPurchaseFrictionSignals(record: ResearchEvidence) {
  const combined = getEvidenceText(record);
  return (
    hasBarrierSignals(record) ||
    combined.includes('implementation') ||
    combined.includes('rollout') ||
    combined.includes('change management') ||
    combined.includes('approval') ||
    combined.includes('compliance') ||
    combined.includes('data residency') ||
    combined.includes('consent') ||
    combined.includes('integration') ||
    combined.includes('training')
  );
}

function getEvidenceSubtopic(record: ResearchEvidence) {
  return typeof record.metadataJson.subtopic === 'string'
    ? record.metadataJson.subtopic.toLowerCase()
    : '';
}

function getGtmSubtopicBucket(record: ResearchEvidence) {
  const subtopic = getEvidenceSubtopic(record);

  if (!subtopic) {
    return null;
  }

  if (
    subtopic === 'buying-process' ||
    subtopic.includes('buyer-journey') ||
    subtopic.includes('procurement') ||
    subtopic.includes('shortlist') ||
    subtopic.includes('evaluation') ||
    subtopic.includes('approval')
  ) {
    return 'buying-process' as const;
  }

  if (
    subtopic === 'channel-preference' ||
    subtopic.includes('channel') ||
    subtopic.includes('marketplace') ||
    subtopic.includes('self-serve')
  ) {
    return 'channel-preference' as const;
  }

  if (
    subtopic === 'partner-msp-direct' ||
    subtopic.includes('partner') ||
    subtopic.includes('msp') ||
    subtopic.includes('reseller') ||
    subtopic.includes('direct')
  ) {
    return 'partner-msp-direct' as const;
  }

  if (
    subtopic === 'purchase-friction' ||
    subtopic.includes('friction') ||
    subtopic.includes('privacy') ||
    subtopic.includes('security') ||
    subtopic.includes('consent') ||
    subtopic.includes('integration') ||
    subtopic.includes('compliance') ||
    subtopic.includes('data-residency') ||
    subtopic.includes('trust')
  ) {
    return 'purchase-friction' as const;
  }

  return null;
}

export function getGtmEvidenceSignals(evidenceRecords: ResearchEvidence[]) {
  const buyingProcessRecords = evidenceRecords.filter((record) =>
    getGtmSubtopicBucket(record) === 'buying-process' || hasBuyingProcessSignals(record),
  );
  const channelRecords = evidenceRecords.filter((record) =>
    getGtmSubtopicBucket(record) === 'channel-preference' || hasChannelSignals(record),
  );
  const partnerPreferenceRecords = evidenceRecords.filter((record) =>
    getGtmSubtopicBucket(record) === 'partner-msp-direct' || hasPartnerPreferenceSignals(record),
  );
  const purchaseFrictionRecords = evidenceRecords.filter((record) =>
    getGtmSubtopicBucket(record) === 'purchase-friction' || hasPurchaseFrictionSignals(record),
  );

  return {
    buyingProcessCount: buyingProcessRecords.length,
    channelCount: channelRecords.length,
    partnerPreferenceCount: partnerPreferenceRecords.length,
    purchaseFrictionCount: purchaseFrictionRecords.length,
  };
}

export function evidenceMatchesSectionPolicy(sectionKey: SectionKey, record: ResearchEvidence) {
  const policy = getSectionPolicy(sectionKey);
  if (policy.derivedOnly) {
    return false;
  }

  if (!policy.allowedSourceTypes.includes(record.sourceType)) {
    return false;
  }

  const category = getEvidenceCategory(record);
  if (!policy.allowedCategories.includes(category)) {
    return false;
  }

  if (!policy.allowedEvidenceModes.includes(getEvidenceMode(record))) {
    return false;
  }

  const recordSection = getEvidenceSection(record);
  return recordSection === sectionKey;
}

export function selectEvidenceForSection(sectionKey: SectionKey, evidenceRecords: ResearchEvidence[]) {
  return evidenceRecords.filter((record) => evidenceMatchesSectionPolicy(sectionKey, record));
}

export function filterCandidatesForSection(
  sectionKey: SectionKey,
  candidates: RetrievalCandidate[],
) {
  return candidates.filter(
    (candidate) =>
      resolveSectionKey({
        intent:
          typeof candidate.metadataJson.queryIntent === 'string'
            ? (candidate.metadataJson.queryIntent as SearchIntent)
            : null,
        sectionKey: candidate.sectionKey,
        claimType: candidate.claimType,
        subtopic:
          typeof candidate.metadataJson.subtopic === 'string'
            ? candidate.metadataJson.subtopic
            : null,
      }) === sectionKey,
  );
}

export function assessSectionStatus(
  sectionKey: SectionKey,
  evidenceRecords: ResearchEvidence[],
  findings: ResearchFinding[],
) {
  const policy = getSectionPolicy(sectionKey);
  const notes: string[] = [];

  if (policy.derivedOnly) {
    const verifiedDependencies = findings.filter(
      (finding) =>
        finding.status === 'verified' &&
        policy.recommendationDependencies?.includes(finding.sectionKey),
    );

    if (verifiedDependencies.length < policy.minVerifiedFindings) {
      notes.push('Not enough verified upstream findings to derive a recommendation section.');
      return { status: 'insufficient_evidence' as SectionStatus, notes };
    }

    return { status: 'ready' as SectionStatus, notes };
  }

  const selectedEvidence = selectEvidenceForSection(sectionKey, evidenceRecords);
  const strongEvidenceCount = selectedEvidence.filter((record) => getEvidenceStrength(record) >= 0.8).length;
  const weakEvidenceCount = selectedEvidence.filter((record) => getEvidenceStrength(record) < 0.58).length;
  const vendorPrimaryCount = selectedEvidence.filter(
    (record) => getEvidenceMode(record) === 'vendor-primary',
  ).length;
  const productCategoryEvidenceCount = selectedEvidence.filter(hasProductCategorySignals).length;
  const barrierEvidenceCount = selectedEvidence.filter(hasBarrierSignals).length;
  const gtmSignals = getGtmEvidenceSignals(selectedEvidence);
  const verifiedFindings = findings.filter(
    (finding) => finding.sectionKey === sectionKey && finding.status === 'verified',
  );

  if (selectedEvidence.length < policy.minEvidence) {
    notes.push(`Section requires at least ${policy.minEvidence} policy-matched evidence records.`);
  }

  if (strongEvidenceCount < policy.minStrongEvidence) {
    notes.push(`Section requires at least ${policy.minStrongEvidence} strong evidence record${policy.minStrongEvidence === 1 ? '' : 's'}.`);
  }

  if (vendorPrimaryCount < policy.minVendorPrimaryEvidence) {
    notes.push(`Section requires at least ${policy.minVendorPrimaryEvidence} vendor-primary evidence record${policy.minVendorPrimaryEvidence === 1 ? '' : 's'}.`);
  }

  if (productCategoryEvidenceCount < policy.minProductCategoryEvidence) {
    notes.push(
      `Section requires at least ${policy.minProductCategoryEvidence} product-category or market-report evidence record${policy.minProductCategoryEvidence === 1 ? '' : 's'}.`,
    );
  }

  if (barrierEvidenceCount < policy.minBarrierEvidence) {
    notes.push(
      `Section requires at least ${policy.minBarrierEvidence} direct barrier-evidence record${policy.minBarrierEvidence === 1 ? '' : 's'}.`,
    );
  }

  if (gtmSignals.buyingProcessCount < policy.minBuyingProcessEvidence) {
    notes.push(
      `Section requires at least ${policy.minBuyingProcessEvidence} buying-process evidence record${policy.minBuyingProcessEvidence === 1 ? '' : 's'}.`,
    );
  }

  if (gtmSignals.channelCount < policy.minChannelEvidence) {
    notes.push(
      `Section requires at least ${policy.minChannelEvidence} channel-evidence record${policy.minChannelEvidence === 1 ? '' : 's'}.`,
    );
  }

  if (gtmSignals.partnerPreferenceCount < policy.minPartnerPreferenceEvidence) {
    notes.push(
      `Section requires at least ${policy.minPartnerPreferenceEvidence} partner, MSP, marketplace, or direct-preference evidence record${policy.minPartnerPreferenceEvidence === 1 ? '' : 's'}.`,
    );
  }

  if (gtmSignals.purchaseFrictionCount < policy.minPurchaseFrictionEvidence) {
    notes.push(
      `Section requires at least ${policy.minPurchaseFrictionEvidence} purchase-friction evidence record${policy.minPurchaseFrictionEvidence === 1 ? '' : 's'}.`,
    );
  }

  if (weakEvidenceCount > policy.maxWeakEvidence) {
    notes.push(`Section exceeds the weak-evidence budget (${weakEvidenceCount}/${policy.maxWeakEvidence}).`);
  }

  if (verifiedFindings.length < policy.minVerifiedFindings) {
    notes.push(`Section requires at least ${policy.minVerifiedFindings} verified finding${policy.minVerifiedFindings === 1 ? '' : 's'}.`);
  }

  if (notes.length > 0) {
    return { status: 'insufficient_evidence' as SectionStatus, notes };
  }

  const hasNeedsReview = findings.some(
    (finding) => finding.sectionKey === sectionKey && finding.status === 'needs-review',
  );

  return {
    status: (hasNeedsReview ? 'needs-review' : 'ready') as SectionStatus,
    notes,
  };
}

export function buildInsufficientEvidenceSection(
  section: Pick<DraftReportSection, 'sectionKey' | 'title'>,
  notes: string[],
) {
  const noteLines = notes.map((note) => `- ${note}`);

  return {
    sectionKey: section.sectionKey,
    title: section.title,
    contentMarkdown: ['### Insufficient evidence', ...noteLines].join('\n'),
    citations: [],
    status: 'insufficient_evidence' as const,
    statusNotes: notes,
  } satisfies DraftReportSection;
}

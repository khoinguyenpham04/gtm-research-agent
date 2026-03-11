import type {
  DraftReportSection,
  ResearchEvidence,
  ResearchFinding,
  RetrievalCandidate,
  SearchIntent,
  SectionStatus,
} from '@/lib/research/schemas';
import {
  deriveSectionKeyFromIntent,
  resolveCandidateSectionHints,
  resolveEvidenceSectionKey,
  resolveEvidenceSectionHints,
  resolveSectionKey,
} from '@/lib/research/section-routing';
import { hasTopicSignal } from '@/lib/research/topic-utils';

type SectionKey = ResearchFinding['sectionKey'];
type NonDerivedSectionKey = Exclude<SectionKey, 'recommendation'>;

interface SectionPolicy {
  minEvidence: number;
  minVerifiedFindings: number;
  minStrongEvidence: number;
  minWeightedEvidenceScore: number;
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

export const searchIntentToSectionKey: Record<SearchIntent, NonDerivedSectionKey> = {
  'market-size': deriveSectionKeyFromIntent('market-size', null),
  adoption: deriveSectionKeyFromIntent('adoption', null),
  'competitor-features': deriveSectionKeyFromIntent('competitor-features', null),
  pricing: deriveSectionKeyFromIntent('pricing', null),
  'buyer-pain': deriveSectionKeyFromIntent('buyer-pain', null),
  'gtm-channels': deriveSectionKeyFromIntent('gtm-channels', null),
};

const sectionPolicyByKey: Record<SectionKey, SectionPolicy> = {
  'market-landscape': {
    minEvidence: 1,
    minVerifiedFindings: 1,
    minStrongEvidence: 0,
    minWeightedEvidenceScore: 1.5,
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
  'icp-and-buyer': {
    minEvidence: 1,
    minVerifiedFindings: 1,
    minStrongEvidence: 0,
    minWeightedEvidenceScore: 1.0,
    minVendorPrimaryEvidence: 0,
    minProductCategoryEvidence: 0,
    minBarrierEvidence: 0,
    minBuyingProcessEvidence: 0,
    minChannelEvidence: 0,
    minPartnerPreferenceEvidence: 0,
    minPurchaseFrictionEvidence: 0,
    maxWeakEvidence: 1,
    allowedSourceTypes: ['web', 'document'],
    allowedCategories: ['official', 'research', 'media', 'blog'],
    allowedEvidenceModes: ['market-adjacent', 'product-specific', 'independent-validation', 'document-internal'],
  },
  'competitor-landscape': {
    minEvidence: 1,
    minVerifiedFindings: 1,
    minStrongEvidence: 0,
    minWeightedEvidenceScore: 0,
    minVendorPrimaryEvidence: 1,
    minProductCategoryEvidence: 0,
    minBarrierEvidence: 0,
    minBuyingProcessEvidence: 0,
    minChannelEvidence: 0,
    minPartnerPreferenceEvidence: 0,
    minPurchaseFrictionEvidence: 0,
    maxWeakEvidence: 3,
    allowedSourceTypes: ['web', 'document'],
    // 'blog' added: consumer-facing vendor home pages often score as blog due to low domain authority
    allowedCategories: ['vendor', 'media', 'research', 'blog'],
    allowedEvidenceModes: ['vendor-primary', 'independent-validation', 'document-internal'],
  },
  'pricing-and-packaging': {
    minEvidence: 1,
    minVerifiedFindings: 1,
    minStrongEvidence: 0,
    minWeightedEvidenceScore: 0,
    minVendorPrimaryEvidence: 0,
    minProductCategoryEvidence: 0,
    minBarrierEvidence: 0,
    minBuyingProcessEvidence: 0,
    minChannelEvidence: 0,
    minPartnerPreferenceEvidence: 0,
    minPurchaseFrictionEvidence: 0,
    maxWeakEvidence: 3,
    allowedSourceTypes: ['web', 'document'],
    // 'blog' added: consumer price comparison sites and installer pages often score as blog
    allowedCategories: ['vendor', 'media', 'research', 'blog'],
    allowedEvidenceModes: ['vendor-primary', 'independent-validation', 'document-internal', 'product-specific'],
  },
  'gtm-motion': {
    minEvidence: 1,
    minVerifiedFindings: 1,
    minStrongEvidence: 0,
    minWeightedEvidenceScore: 1.0,
    minVendorPrimaryEvidence: 0,
    minProductCategoryEvidence: 0,
    minBarrierEvidence: 0,
    minBuyingProcessEvidence: 0,
    minChannelEvidence: 0,
    minPartnerPreferenceEvidence: 0,
    minPurchaseFrictionEvidence: 0,
    // Raised: consumer hardware GTM evidence comes from vendor/comparison/installer pages that score low
    maxWeakEvidence: 6,
    allowedSourceTypes: ['web', 'document'],
    allowedCategories: ['official', 'research', 'media', 'vendor', 'blog', 'community'],
    allowedEvidenceModes: ['independent-validation', 'document-internal', 'vendor-primary', 'market-adjacent', 'product-specific'],
  },
  'risks-and-unknowns': {
    minEvidence: 1,
    minVerifiedFindings: 1,
    minStrongEvidence: 0,
    // Lowered: risk evidence for consumer products is sparse; scoring handles quality differentiation
    minWeightedEvidenceScore: 1.0,
    minVendorPrimaryEvidence: 0,
    minProductCategoryEvidence: 0,
    // Removed hard barrier requirement: barrier signals exist on vendor pages but may not always trigger
    minBarrierEvidence: 0,
    minBuyingProcessEvidence: 0,
    minChannelEvidence: 0,
    minPartnerPreferenceEvidence: 0,
    minPurchaseFrictionEvidence: 0,
    maxWeakEvidence: 2,
    allowedSourceTypes: ['web', 'document'],
    allowedCategories: ['official', 'research', 'media', 'blog', 'vendor'],
    // Added vendor-primary and product-specific: vendor pages describe installation requirements, warranty, grid connection
    allowedEvidenceModes: ['independent-validation', 'document-internal', 'vendor-primary', 'product-specific', 'market-adjacent'],
  },
  recommendation: {
    minEvidence: 0,
    minVerifiedFindings: 2,
    minStrongEvidence: 0,
    minWeightedEvidenceScore: 0,
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
    // Require only the three most reliably-filled sections; pricing and risks are advisory
    recommendationDependencies: [
      'market-landscape',
      'icp-and-buyer',
      'competitor-landscape',
      'pricing-and-packaging',
      'gtm-motion',
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
  return resolveEvidenceSectionHints(record);
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
  const query = typeof record.metadataJson.query === 'string' ? record.metadataJson.query : '';
  const vendorTarget =
    typeof record.metadataJson.vendorTarget === 'string' ? record.metadataJson.vendorTarget : null;

  return hasTopicSignal(combined, query, vendorTarget);
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
    combined.includes('purchase decision') ||
    // Hardware / consumer product purchase journey signals
    combined.includes('installation quote') ||
    combined.includes('find an installer') ||
    combined.includes('get a quote') ||
    combined.includes('contact for quote') ||
    combined.includes('contact for a quote') ||
    combined.includes('site survey') ||
    combined.includes('application process') ||
    combined.includes('how to buy') ||
    combined.includes('buying guide')
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
    combined.includes('app marketplace') ||
    // Hardware / consumer installer-channel signals
    combined.includes('installer') ||
    combined.includes('installation company') ||
    combined.includes('certified installer') ||
    combined.includes('mcs certified') ||
    combined.includes('mcs accredited') ||
    combined.includes('energy supplier') ||
    combined.includes('distribution network') ||
    combined.includes('dealer network') ||
    combined.includes('authorised dealer') ||
    combined.includes('authorized dealer')
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
    combined.includes('referral') ||
    // Hardware / installer-channel partner signals
    combined.includes('installer network') ||
    combined.includes('approved installer') ||
    combined.includes('accredited installer') ||
    combined.includes('installation partner') ||
    combined.includes('distribution partner')
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

function getGtmEvidenceClass(record: ResearchEvidence) {
  const stored =
    typeof record.metadataJson.gtmEvidenceClass === 'string'
      ? record.metadataJson.gtmEvidenceClass
      : null;

  if (stored === 'direct' || stored === 'adjacent') {
    return stored;
  }

  const combined = getEvidenceText(record);
  const directSignals = [
    'buying process',
    'buyer journey',
    'evaluation',
    'shortlist',
    'self-serve',
    'self-service',
    'direct sales',
    'direct purchase',
    'partner-led',
    'marketplace',
    'trial',
    'free trial',
    'freemium',
    'free tier',
    'demo',
    'approval',
    'security review',
    'purchase friction',
    'product-led',
    'plg',
    'sign up',
    'signup',
    'saas buying',
    'software buying',
    'purchase process',
    'purchasing process',
    'pilot program',
    'proof of concept',
    'how to buy',
    'try for free',
    'app store',
    'onboard',
    'software purchase',
    'buying guide',
    // Hardware / installer-channel direct signals
    'find an installer',
    'certified installer',
    'mcs certified',
    'mcs accredited',
    'approved installer',
    'installation quote',
    'get a quote',
    'contact for quote',
    'site survey',
    'smart export guarantee',
    'feed-in tariff',
    'energy supplier',
    'installer network',
    'installation company',
    'how to install',
    'installation cost',
    'cost of installation',
  ].some((signal) => combined.includes(signal));
  const adjacentSignals = [
    'managed service provider',
    'msp market',
    'sector revenue',
    'board of trade',
    'business rates',
    'employment allowance',
    'fair payments code',
    'export support',
    'public procurement regime',
  ].some((signal) => combined.includes(signal));

  if (adjacentSignals && !directSignals) {
    return 'adjacent' as const;
  }

  return directSignals ? ('direct' as const) : ('adjacent' as const);
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
  const directRecords = evidenceRecords.filter((record) => getGtmEvidenceClass(record) === 'direct');
  const directBuyingProcessRecords = buyingProcessRecords.filter((record) => getGtmEvidenceClass(record) === 'direct');
  const directChannelRecords = channelRecords.filter((record) => getGtmEvidenceClass(record) === 'direct');
  const directPartnerPreferenceRecords = partnerPreferenceRecords.filter((record) => getGtmEvidenceClass(record) === 'direct');
  const directPurchaseFrictionRecords = purchaseFrictionRecords.filter((record) => getGtmEvidenceClass(record) === 'direct');
  const directBucketCount = [
    directBuyingProcessRecords.length > 0,
    directChannelRecords.length > 0,
    directPartnerPreferenceRecords.length > 0,
    directPurchaseFrictionRecords.length > 0,
  ].filter(Boolean).length;
  const totalBucketCount = [
    buyingProcessRecords.length > 0,
    channelRecords.length > 0,
    partnerPreferenceRecords.length > 0,
    purchaseFrictionRecords.length > 0,
  ].filter(Boolean).length;

  return {
    buyingProcessCount: buyingProcessRecords.length,
    channelCount: channelRecords.length,
    partnerPreferenceCount: partnerPreferenceRecords.length,
    purchaseFrictionCount: purchaseFrictionRecords.length,
    directBuyingProcessCount: directBuyingProcessRecords.length,
    directChannelCount: directChannelRecords.length,
    directPartnerPreferenceCount: directPartnerPreferenceRecords.length,
    directPurchaseFrictionCount: directPurchaseFrictionRecords.length,
    directEvidenceCount: directRecords.length,
    directBucketCount,
    totalBucketCount,
  };
}

export function getSectionWeightedEvidenceScore(
  sectionKey: NonDerivedSectionKey,
  evidenceRecords: ResearchEvidence[],
) {
  const selectedEvidence = selectEvidenceForSection(sectionKey, evidenceRecords);

  return selectedEvidence.reduce((total, record) => {
    const strength = getEvidenceStrength(record);
    const category = getEvidenceCategory(record);
    const mode = getEvidenceMode(record);

    let weight =
      strength >= 0.8
        ? 2
        : strength >= 0.68
          ? 1.5
          : strength >= 0.58
            ? 1
            : 0.5;

    if (sectionKey === 'market-landscape') {
      if (mode === 'product-specific') {
        weight += 0.75;
      }
      if (category === 'official' || category === 'research') {
        weight += 0.25;
      }
    }

    if (sectionKey === 'icp-and-buyer') {
      if (category === 'official' || category === 'research' || record.sourceType === 'document') {
        weight += 0.25;
      }
    }

    if (sectionKey === 'gtm-motion') {
      weight += getGtmEvidenceClass(record) === 'direct' ? 0.75 : 0.15;
    }

    if (sectionKey === 'risks-and-unknowns' && hasBarrierSignals(record)) {
      weight += 0.25;
    }

    return total + weight;
  }, 0);
}

export function evidenceMatchesSectionPolicy(sectionKey: NonDerivedSectionKey, record: ResearchEvidence) {
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

  const recordSections = getEvidenceSection(record);
  return recordSections.includes(sectionKey);
}

export function selectEvidenceForSection(sectionKey: NonDerivedSectionKey, evidenceRecords: ResearchEvidence[]) {
  return evidenceRecords.filter((record) => evidenceMatchesSectionPolicy(sectionKey, record));
}

export function filterCandidatesForSection(
  sectionKey: NonDerivedSectionKey,
  candidates: RetrievalCandidate[],
) {
  return candidates.filter(
    (candidate) =>
      resolveCandidateSectionHints(candidate).includes(sectionKey) ||
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
  const hardNotes: string[] = [];
  const softNotes: string[] = [];

  if (policy.derivedOnly) {
    const verifiedDependencies = findings.filter(
      (finding) =>
        finding.status === 'verified' &&
        policy.recommendationDependencies?.includes(finding.sectionKey),
    );

    if (verifiedDependencies.length < policy.minVerifiedFindings) {
      hardNotes.push('Not enough verified upstream findings to derive a recommendation section.');
      return { status: 'insufficient_evidence' as SectionStatus, notes: hardNotes };
    }

    return { status: 'ready' as SectionStatus, notes: hardNotes };
  }

  const nonDerivedSectionKey = sectionKey as NonDerivedSectionKey;
  const selectedEvidence = selectEvidenceForSection(nonDerivedSectionKey, evidenceRecords);
  const strongEvidenceCount = selectedEvidence.filter((record) => getEvidenceStrength(record) >= 0.8).length;
  const weakEvidenceCount = selectedEvidence.filter((record) => getEvidenceStrength(record) < 0.58).length;
  const vendorPrimaryCount = selectedEvidence.filter(
    (record) => getEvidenceMode(record) === 'vendor-primary',
  ).length;
  const productCategoryEvidenceCount = selectedEvidence.filter(hasProductCategorySignals).length;
  const barrierEvidenceCount = selectedEvidence.filter(hasBarrierSignals).length;
  const gtmSignals = getGtmEvidenceSignals(selectedEvidence);
  const weightedEvidenceScore = getSectionWeightedEvidenceScore(nonDerivedSectionKey, evidenceRecords);
  const verifiedFindings = findings.filter(
    (finding) => finding.sectionKey === sectionKey && finding.status === 'verified',
  );

  if (selectedEvidence.length < policy.minEvidence) {
    hardNotes.push(`Section requires at least ${policy.minEvidence} policy-matched evidence records.`);
  }

  if (strongEvidenceCount < policy.minStrongEvidence) {
    softNotes.push(`Section requires at least ${policy.minStrongEvidence} strong evidence record${policy.minStrongEvidence === 1 ? '' : 's'}.`);
  }

  if (weightedEvidenceScore < policy.minWeightedEvidenceScore) {
    softNotes.push(
      `Section requires a weighted evidence score of at least ${policy.minWeightedEvidenceScore.toFixed(1)} (current ${weightedEvidenceScore.toFixed(1)}).`,
    );
  }

  if (vendorPrimaryCount < policy.minVendorPrimaryEvidence) {
    hardNotes.push(`Section requires at least ${policy.minVendorPrimaryEvidence} vendor-primary evidence record${policy.minVendorPrimaryEvidence === 1 ? '' : 's'}.`);
  }

  if (productCategoryEvidenceCount < policy.minProductCategoryEvidence) {
    softNotes.push(
      `Section requires at least ${policy.minProductCategoryEvidence} product-category or market-report evidence record${policy.minProductCategoryEvidence === 1 ? '' : 's'}.`,
    );
  }

  if (barrierEvidenceCount < policy.minBarrierEvidence) {
    softNotes.push(
      `Section requires at least ${policy.minBarrierEvidence} direct barrier-evidence record${policy.minBarrierEvidence === 1 ? '' : 's'}.`,
    );
  }

  if (gtmSignals.buyingProcessCount < policy.minBuyingProcessEvidence) {
    softNotes.push(
      `Section requires at least ${policy.minBuyingProcessEvidence} buying-process evidence record${policy.minBuyingProcessEvidence === 1 ? '' : 's'}.`,
    );
  }

  if (gtmSignals.channelCount < policy.minChannelEvidence) {
    softNotes.push(
      `Section requires at least ${policy.minChannelEvidence} channel-evidence record${policy.minChannelEvidence === 1 ? '' : 's'}.`,
    );
  }

  if (gtmSignals.partnerPreferenceCount < policy.minPartnerPreferenceEvidence) {
    softNotes.push(
      `Section requires at least ${policy.minPartnerPreferenceEvidence} partner, MSP, marketplace, or direct-preference evidence record${policy.minPartnerPreferenceEvidence === 1 ? '' : 's'}.`,
    );
  }

  if (gtmSignals.purchaseFrictionCount < policy.minPurchaseFrictionEvidence) {
    softNotes.push(
      `Section requires at least ${policy.minPurchaseFrictionEvidence} purchase-friction evidence record${policy.minPurchaseFrictionEvidence === 1 ? '' : 's'}.`,
    );
  }

  if (
    sectionKey === 'gtm-motion' &&
    selectedEvidence.length > 0 &&
    gtmSignals.totalBucketCount < 1
  ) {
    softNotes.push(
      `GTM motion requires coverage across at least 1 GTM evidence bucket (current ${gtmSignals.totalBucketCount}).`,
    );
  }

  if (weakEvidenceCount > policy.maxWeakEvidence) {
    softNotes.push(`Section exceeds the weak-evidence budget (${weakEvidenceCount}/${policy.maxWeakEvidence}).`);
  }

  if (verifiedFindings.length < policy.minVerifiedFindings) {
    hardNotes.push(`Section requires at least ${policy.minVerifiedFindings} verified finding${policy.minVerifiedFindings === 1 ? '' : 's'}.`);
  }

  if (hardNotes.length > 0) {
    return { status: 'insufficient_evidence' as SectionStatus, notes: [...hardNotes, ...softNotes] };
  }

  const hasNeedsReview = findings.some(
    (finding) => finding.sectionKey === sectionKey && finding.status === 'needs-review',
  );

  if (softNotes.length > 0 || hasNeedsReview) {
    return {
      status: 'needs-review' as SectionStatus,
      notes: softNotes,
    };
  }

  return {
    status: 'ready' as SectionStatus,
    notes: [],
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

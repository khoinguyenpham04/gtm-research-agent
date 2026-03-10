import type {
  DraftReportSection,
  ResearchEvidence,
  ResearchFinding,
  RetrievalCandidate,
  SearchIntent,
  SectionStatus,
} from '@/lib/research/schemas';

type SectionKey = ResearchFinding['sectionKey'];

interface SectionPolicy {
  minEvidence: number;
  minVerifiedFindings: number;
  minStrongEvidence: number;
  maxWeakEvidence: number;
  allowedSourceTypes: Array<ResearchEvidence['sourceType']>;
  allowedCategories: string[];
  derivedOnly?: boolean;
  recommendationDependencies?: SectionKey[];
}

export const searchIntentToSectionKey: Record<SearchIntent, SectionKey> = {
  'market-size': 'market-landscape',
  adoption: 'icp-and-buyer',
  'competitor-features': 'competitor-landscape',
  pricing: 'pricing-and-packaging',
  'buyer-pain': 'icp-and-buyer',
  'gtm-channels': 'gtm-motion',
};

const sectionPolicyByKey: Record<SectionKey, SectionPolicy> = {
  'market-landscape': {
    minEvidence: 2,
    minVerifiedFindings: 1,
    minStrongEvidence: 1,
    maxWeakEvidence: 1,
    allowedSourceTypes: ['web', 'document'],
    allowedCategories: ['official', 'research', 'media'],
  },
  'icp-and-buyer': {
    minEvidence: 2,
    minVerifiedFindings: 1,
    minStrongEvidence: 1,
    maxWeakEvidence: 1,
    allowedSourceTypes: ['web', 'document'],
    allowedCategories: ['official', 'research', 'media'],
  },
  'competitor-landscape': {
    minEvidence: 2,
    minVerifiedFindings: 1,
    minStrongEvidence: 0,
    maxWeakEvidence: 2,
    allowedSourceTypes: ['web', 'document'],
    allowedCategories: ['vendor', 'media', 'research'],
  },
  'pricing-and-packaging': {
    minEvidence: 2,
    minVerifiedFindings: 1,
    minStrongEvidence: 0,
    maxWeakEvidence: 1,
    allowedSourceTypes: ['web', 'document'],
    allowedCategories: ['vendor', 'media', 'research'],
  },
  'gtm-motion': {
    minEvidence: 2,
    minVerifiedFindings: 1,
    minStrongEvidence: 1,
    maxWeakEvidence: 1,
    allowedSourceTypes: ['web', 'document'],
    allowedCategories: ['official', 'research', 'media'],
  },
  'risks-and-unknowns': {
    minEvidence: 1,
    minVerifiedFindings: 1,
    minStrongEvidence: 1,
    maxWeakEvidence: 1,
    allowedSourceTypes: ['web', 'document'],
    allowedCategories: ['official', 'research', 'media'],
  },
  recommendation: {
    minEvidence: 0,
    minVerifiedFindings: 2,
    minStrongEvidence: 0,
    maxWeakEvidence: 0,
    allowedSourceTypes: [],
    allowedCategories: [],
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

function getEvidenceSection(record: ResearchEvidence) {
  if (record.sectionKey) {
    return record.sectionKey;
  }

  const queryIntent =
    typeof record.metadataJson.queryIntent === 'string'
      ? (record.metadataJson.queryIntent as SearchIntent)
      : null;

  return queryIntent ? searchIntentToSectionKey[queryIntent] : null;
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
  return candidates.filter((candidate) => candidate.sectionKey === sectionKey);
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
  const verifiedFindings = findings.filter(
    (finding) => finding.sectionKey === sectionKey && finding.status === 'verified',
  );

  if (selectedEvidence.length < policy.minEvidence) {
    notes.push(`Section requires at least ${policy.minEvidence} policy-matched evidence records.`);
  }

  if (strongEvidenceCount < policy.minStrongEvidence) {
    notes.push(`Section requires at least ${policy.minStrongEvidence} strong evidence record${policy.minStrongEvidence === 1 ? '' : 's'}.`);
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

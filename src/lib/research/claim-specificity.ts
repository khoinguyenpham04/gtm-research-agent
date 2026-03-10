import type {
  Citation,
  ClaimType,
  EvidenceMode,
  InferenceLabel,
  ResearchEvidence,
  ResearchFinding,
} from '@/lib/research/schemas';

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
    return value;
  }

  return 'market-adjacent';
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
  const independentSpecificCount = evidenceRecords.filter((record) => {
    const mode = getEvidenceMode(record);
    return mode === 'product-specific' || mode === 'independent-validation';
  }).length;
  const notes: string[] = [];

  if (sectionKey === 'competitor-landscape' || sectionKey === 'pricing-and-packaging') {
    if (vendorPrimaryCount >= 1) {
      return {
        claimType,
        evidenceMode,
        inferenceLabel: strongEvidenceCount > 0 ? 'direct' : 'inferred',
        notes,
      };
    }

    notes.push('Claim lacks vendor-primary evidence for a competitor or pricing section.');
    return { claimType, evidenceMode, inferenceLabel: 'speculative', notes };
  }

  if (sectionKey === 'gtm-motion' || sectionKey === 'risks-and-unknowns') {
    if (independentSpecificCount >= 1 || evidenceMode === 'document-internal') {
      return { claimType, evidenceMode, inferenceLabel: 'direct', notes };
    }

    notes.push('Claim relies on adjacent evidence rather than direct workflow or buying-behavior evidence.');
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

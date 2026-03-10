import { generateStructuredOutput } from '@/lib/research/ai';
import { buildEvidenceByCitation, getDefaultClaimType, inferFindingSpecificity } from '@/lib/research/claim-specificity';
import {
  buildCompetitorMatrixEntries,
  buildCompetitorProfileSummary,
  countDistinctCompetitorVendors,
  getCompetitorVendorLabel,
} from '@/lib/research/competitor-extraction';
import {
  appendResearchEvent,
  hasStageCompleted,
  listResearchFindings,
  replaceResearchFindings,
  setRunStage,
} from '@/lib/research/repository';
import {
  type Citation,
  type CompetitorMatrixEntry,
  type ResearchEvidence,
  type ResearchFinding,
  type ResearchGraphState,
  verifiedFindingSchema,
} from '@/lib/research/schemas';
import { resolveEvidenceSectionKey, resolveFindingSectionKey, resolveSectionKey } from '@/lib/research/section-routing';
import { getSectionPolicy } from '@/lib/research/section-policy';
import { coerceSourceCategory, getEvidenceRuleAssessment } from '@/lib/research/source-scoring';
import { z } from 'zod';

const verificationWorkerSchema = z.object({
  keyTakeaways: z.array(z.string().trim().min(1)).max(3),
  findings: z.array(verifiedFindingSchema).max(6),
});

type VerificationWorkerOutput = z.infer<typeof verificationWorkerSchema>;
type VerificationSectionKey = Exclude<ResearchFinding['sectionKey'], 'recommendation'>;

function buildEvidenceIndex(evidenceRecords: ResearchEvidence[]) {
  return new Map(
    evidenceRecords.map((record) => [
      record.id,
      {
        evidenceId: record.id,
        sourceId: record.sourceId ?? record.id,
        sourceType: record.sourceType,
        title: record.title,
        url: record.url,
        excerpt: record.excerpt,
        documentExternalId: record.documentExternalId ?? null,
        documentChunkId: record.documentChunkId ?? null,
      } satisfies Citation,
    ]),
  );
}

function buildEvidenceRuleSourceIndex(evidenceRecords: ResearchEvidence[]) {
  return new Map(
    evidenceRecords.map((record) => [
      record.id,
      {
        sourceCategory:
          typeof record.metadataJson.sourceCategory === 'string'
            ? coerceSourceCategory(record.metadataJson.sourceCategory)
            : record.sourceType === 'document'
              ? 'research'
              : 'blog',
        qualityScore:
          typeof record.metadataJson.qualityScore === 'number'
            ? record.metadataJson.qualityScore
            : record.sourceType === 'document'
              ? 0.84
              : 0,
        domain:
          typeof record.metadataJson.domain === 'string'
            ? record.metadataJson.domain
            : record.documentExternalId,
        url: record.url,
      },
    ]),
  );
}

function buildEvidenceRecordIndex(evidenceRecords: ResearchEvidence[]) {
  return new Map(evidenceRecords.map((record) => [record.id, record]));
}

function sanitizeFindings(
  findings: ResearchFinding[],
  evidenceIndex: Map<string, Citation>,
  evidenceRecordIndex: Map<string, ResearchEvidence>,
) {
  return findings
    .map((finding) => {
      const evidence = finding.evidence
        .map((citation) => evidenceIndex.get(citation.evidenceId))
        .filter((citation): citation is Citation => Boolean(citation));
      const sectionKey = resolveFindingSectionKey(finding, evidenceRecordIndex);
      const specificity = inferFindingSpecificity(
        sectionKey,
        buildEvidenceByCitation(evidence, evidenceRecordIndex),
        finding.claim,
      );

      return {
        ...finding,
        sectionKey,
        claimType: getDefaultClaimType(sectionKey),
        evidence,
        evidenceMode: specificity.evidenceMode,
        inferenceLabel: specificity.inferenceLabel,
        verificationNotes: [finding.verificationNotes ?? '', ...specificity.notes].filter(Boolean).join(' '),
        gaps: finding.gaps ?? [],
        contradictions: finding.contradictions ?? [],
      };
    })
    .filter((finding) => finding.evidence.length > 0);
}

function isEvidenceUsedInSynthesis(record: ResearchEvidence) {
  if (record.sourceType === 'document') {
    return true;
  }

  return Boolean(record.metadataJson.usedInSynthesis);
}

function uniqueStrings(values: string[]) {
  return values.filter((value, index, allValues) => Boolean(value) && allValues.indexOf(value) === index);
}

function buildVerificationEvidenceSummary(
  evidenceRecords: ResearchEvidence[],
  sectionKeys: VerificationSectionKey[],
) {
  const scopedEvidence = evidenceRecords.filter((record) =>
    sectionKeys.includes(resolveEvidenceSectionKey(record)),
  );

  return scopedEvidence
    .map((record) =>
      [
        `Evidence ID: ${record.id}`,
        `Source type: ${record.sourceType}`,
        `Section: ${record.sectionKey ?? 'unassigned'}`,
        `Title: ${record.title}`,
        `URL: ${record.url ?? 'n/a'}`,
        `Excerpt: ${record.excerpt}`,
        `Metadata: ${JSON.stringify(record.metadataJson)}`,
      ].join('\n'),
    )
    .join('\n\n---\n\n');
}

function buildVerificationDraftFindingSummary(
  findings: ResearchGraphState['findings'],
  sectionKeys: VerificationSectionKey[],
) {
  return findings
    .filter(
      (finding) =>
        finding.sectionKey !== 'recommendation' && sectionKeys.includes(finding.sectionKey),
    )
    .map((finding) => {
      const evidenceIds = finding.evidence.map((citation) => citation.evidenceId).join(', ');
      return [
        `Section: ${finding.sectionKey}`,
        `Claim type: ${finding.claimType}`,
        `Claim: ${finding.claim}`,
        `Evidence mode: ${finding.evidenceMode}`,
        `Inference label: ${finding.inferenceLabel}`,
        `Confidence: ${finding.confidence}`,
        `Evidence IDs: ${evidenceIds}`,
        `Notes: ${finding.verificationNotes || 'n/a'}`,
        `Gaps: ${finding.gaps.join(' | ') || 'none'}`,
      ].join('\n');
    })
    .join('\n\n---\n\n');
}

async function runVerificationWorker(
  state: ResearchGraphState,
  synthesisEvidence: ResearchEvidence[],
  sectionKeys: VerificationSectionKey[],
  sectionRules: string[],
  extraContext?: string,
) {
  const evidenceSummary = buildVerificationEvidenceSummary(synthesisEvidence, sectionKeys);
  const draftFindingsSummary = buildVerificationDraftFindingSummary(state.findings, sectionKeys);

  if (!evidenceSummary && !draftFindingsSummary) {
    return {
      keyTakeaways: [],
      findings: [],
    } satisfies VerificationWorkerOutput;
  }

  return generateStructuredOutput<VerificationWorkerOutput>({
    schema: verificationWorkerSchema,
    system:
      'You are a GTM research verifier. Verify or downgrade only the supplied section claims using only the supplied evidence. Return concise takeaways and verified or needs-review findings.',
    prompt: [
      `Topic: ${state.topic}`,
      `Objective: ${state.objective ?? 'Not provided.'}`,
      `Target sections:\n- ${sectionKeys.join('\n- ')}`,
      'Evidence rules:',
      '- claims should remain verified only if evidence is sufficiently strong',
      '- do not invent details that are not grounded in the evidence',
      '- downgrade broad AI market evidence to inferred unless it directly supports the claim about meeting assistants, buyer workflow, or the product category',
      '- competitor and pricing claims require vendor-primary evidence to remain direct',
      '- gtm-motion claims must stay about buying process, channel choice, partner or direct preference, and purchase friction; productivity alone is not GTM motion evidence',
      '- return 0-2 key takeaways for these sections only',
      `Section rules:\n- ${sectionRules.join('\n- ')}`,
      extraContext ?? '',
      `Section-scoped evidence ledger:\n${evidenceSummary || 'No evidence available.'}`,
      `Draft claims for these sections:\n${draftFindingsSummary || 'No draft claims available.'}`,
      'For every finding object, always include status, verificationNotes, gaps, and contradictions.',
      'Use only evidence IDs that were provided.',
    ]
      .filter(Boolean)
      .join('\n\n'),
  });
}

function getCommercialSectionAssessment(
  finding: ResearchFinding,
  evidenceRecordIndex: Map<string, ResearchEvidence>,
) {
  const evidenceRecords = buildEvidenceByCitation(finding.evidence, evidenceRecordIndex);

  if (finding.sectionKey === 'pricing-and-packaging') {
    const pricingRecords = evidenceRecords.filter(
      (record) =>
        record.metadataJson.evidenceMode === 'vendor-primary' &&
        (record.metadataJson.vendorPageType === 'pricing' ||
          typeof record.metadataJson.planPricingText === 'string'),
    );
    const vendorCount = new Set(pricingRecords.map(getCompetitorVendorLabel)).size;

    return {
      passes: pricingRecords.length >= 2 && vendorCount >= 2,
      failureNote:
        'Pricing section requires vendor-primary pricing evidence from at least two distinct vendors.',
      failureGap:
        'Add vendor-primary pricing pages from at least two distinct vendors before treating pricing as verified.',
    };
  }

  if (finding.sectionKey === 'competitor-landscape') {
    const vendorRecords = evidenceRecords.filter(
      (record) =>
        record.metadataJson.evidenceMode === 'vendor-primary' &&
        ['product', 'docs', 'pricing'].includes(
          typeof record.metadataJson.vendorPageType === 'string'
            ? record.metadataJson.vendorPageType
            : 'unknown',
        ),
    );
    const vendorCount = new Set(vendorRecords.map(getCompetitorVendorLabel)).size;

    return {
      passes: vendorRecords.length >= 2 && vendorCount >= 2,
      failureNote:
        'Competitor section requires vendor-primary canonical evidence spanning at least two vendors.',
      failureGap:
        'Add canonical product, docs, or pricing pages from at least two vendors before treating this competitor claim as verified.',
    };
  }

  return null;
}

export async function runVerificationNode(state: ResearchGraphState) {
  console.info(`[research:${state.runId}] stage_start`, { stage: 'verification' });

  if (await hasStageCompleted(state.runId, 'verification')) {
    const findings = await listResearchFindings(state.runId);

    return {
      status: state.status,
      currentStage: state.currentStage,
      findings: findings.map((finding) => ({
        sectionKey: resolveSectionKey({
          sectionKey: finding.sectionKey,
          claimType: finding.claimType,
        }),
        claimType: finding.claimType,
        claim: finding.claim,
        evidence: finding.evidenceJson,
        evidenceMode: finding.evidenceMode,
        inferenceLabel: finding.inferenceLabel,
        confidence: finding.confidence,
        status: finding.status as ResearchFinding['status'],
        verificationNotes: finding.verificationNotes,
        gaps: finding.gapsJson,
        contradictions: finding.contradictionsJson,
      })),
    };
  }

  await setRunStage(state.runId, 'verifying', 'verification');
  await appendResearchEvent(state.runId, 'verification', 'stage_started', 'Verifying claims and evidence.');

  const synthesisEvidence = state.evidenceRecords.filter(isEvidenceUsedInSynthesis);
  const evidenceIndex = buildEvidenceIndex(synthesisEvidence);
  const evidenceRecordIndex = buildEvidenceRecordIndex(synthesisEvidence);
  const ruleSourceIndex = buildEvidenceRuleSourceIndex(synthesisEvidence);
  const deterministicCompetitorMatrix = buildCompetitorMatrixEntries(synthesisEvidence);
  const competitorProfileSummary = buildCompetitorProfileSummary(synthesisEvidence);
  const [marketAndIcp, gtmAndRisk, commercial] = await Promise.all([
    runVerificationWorker(
      state,
      synthesisEvidence,
      ['market-landscape', 'icp-and-buyer'],
      [
        'market-landscape findings should stay category-aware and keep broad AI adoption evidence inferred unless it directly addresses meeting assistants or conversation intelligence.',
        'icp-and-buyer findings should stay focused on buyer readiness, workflow pain, CRM usage, and early-adopter fit.',
      ],
    ),
    runVerificationWorker(
      state,
      synthesisEvidence,
      ['gtm-motion', 'risks-and-unknowns'],
      [
        'gtm-motion findings must stay about buying process, route-to-market, channel preference, partner or MSP or marketplace versus direct, and purchase friction.',
        'risks-and-unknowns findings must stay about privacy, consent, compliance, trust, deployment, rollout, or integration barriers.',
      ],
    ),
    runVerificationWorker(
      state,
      synthesisEvidence,
      ['competitor-landscape', 'pricing-and-packaging'],
      [
        'competitor findings should summarize vendor deltas from the deterministic profiles instead of repeating vendor marketing copy.',
        'pricing findings should confirm self-serve versus sales-led packaging from vendor-primary pricing evidence only.',
      ],
      `Deterministic competitor profiles:\n${competitorProfileSummary}`,
    ),
  ]);

  const verifiedFindings = [
    ...marketAndIcp.findings,
    ...gtmAndRisk.findings,
    ...commercial.findings,
  ];
  const findings = sanitizeFindings(verifiedFindings, evidenceIndex, evidenceRecordIndex)
    .filter((finding) => !getSectionPolicy(finding.sectionKey).derivedOnly)
    .map((finding) => {
      const commercialAssessment = getCommercialSectionAssessment(finding, evidenceRecordIndex);
      const assessment = getEvidenceRuleAssessment(finding.evidence, ruleSourceIndex);
      const competitorVendorCount =
        finding.sectionKey === 'competitor-landscape'
          ? countDistinctCompetitorVendors(buildEvidenceByCitation(finding.evidence, evidenceRecordIndex))
          : 0;
      const failed = commercialAssessment ? !commercialAssessment.passes : !assessment.passes;
      const specificityFailed = finding.inferenceLabel === 'speculative';
      const competitorDeltaFailed =
        finding.sectionKey === 'competitor-landscape' && competitorVendorCount < 2;
      const inferredPenalty = finding.inferenceLabel === 'inferred';

      return {
        ...finding,
        confidence:
          failed || specificityFailed || competitorDeltaFailed
            ? 'low'
            : inferredPenalty && finding.confidence === 'high'
              ? 'medium'
              : finding.confidence,
        status: failed || specificityFailed || competitorDeltaFailed ? 'needs-review' : finding.status,
        verificationNotes: failed || competitorDeltaFailed
          ? [
              finding.verificationNotes,
              failed
                ? commercialAssessment?.failureNote ??
                  'Evidence rule failed: requires one strong primary/research source or two independent medium-quality sources.'
                : '',
              competitorDeltaFailed
                ? 'Competitor summary failed: needs evidence spanning at least two distinct vendors.'
                : '',
            ]
              .filter(Boolean)
              .join(' ')
          : finding.verificationNotes,
        gaps:
          failed || specificityFailed || competitorDeltaFailed
            ? [
                ...finding.gaps,
                ...(specificityFailed
                  ? ['Evidence remains speculative for this section and needs more section-specific support.']
                  : []),
                ...(failed && commercialAssessment ? [commercialAssessment.failureGap] : []),
                ...(competitorDeltaFailed
                  ? ['Add evidence from at least one more vendor before treating this as a comparative competitor claim.']
                  : []),
                ...(!commercialAssessment && failed
                  ? ['Add one strong official/research source or two independent medium-quality sources to verify this claim.']
                  : []),
              ]
            : finding.gaps,
      };
    });

  await replaceResearchFindings(state.runId, findings);
  await appendResearchEvent(
    state.runId,
    'verification',
    'stage_completed',
    'Claims verified and evidence gaps recorded.',
    {
      verifiedFindingCount: findings.filter((finding) => finding.status === 'verified').length,
      needsReviewCount: findings.filter((finding) => finding.status === 'needs-review').length,
      competitorMatrixCount: deterministicCompetitorMatrix.length,
    },
  );
  console.info(`[research:${state.runId}] stage_complete`, {
    stage: 'verification',
    verifiedFindingCount: findings.filter((finding) => finding.status === 'verified').length,
    needsReviewCount: findings.filter((finding) => finding.status === 'needs-review').length,
    competitorMatrixCount: deterministicCompetitorMatrix.length,
  });

  return {
    status: 'verifying' as const,
    currentStage: 'verification',
    findings,
    competitorMatrix: deterministicCompetitorMatrix as CompetitorMatrixEntry[],
    keyTakeaways: uniqueStrings([
      ...marketAndIcp.keyTakeaways,
      ...gtmAndRisk.keyTakeaways,
      ...commercial.keyTakeaways,
    ]).slice(0, 5),
  };
}

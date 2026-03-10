import { generateStructuredOutput } from '@/lib/research/ai';
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
  type VerificationOutput,
  verificationOutputSchema,
} from '@/lib/research/schemas';
import { getSectionPolicy } from '@/lib/research/section-policy';
import { coerceSourceCategory, getEvidenceRuleAssessment } from '@/lib/research/source-scoring';

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

function sanitizeFindings(findings: ResearchFinding[], evidenceIndex: Map<string, Citation>) {
  return findings
    .map((finding) => ({
      ...finding,
      evidence: finding.evidence
        .map((citation) => evidenceIndex.get(citation.evidenceId))
        .filter((citation): citation is Citation => Boolean(citation)),
      verificationNotes: finding.verificationNotes ?? '',
      gaps: finding.gaps ?? [],
      contradictions: finding.contradictions ?? [],
    }))
    .filter((finding) => finding.evidence.length > 0);
}

function isEvidenceUsedInSynthesis(record: ResearchEvidence) {
  if (record.sourceType === 'document') {
    return true;
  }

  return Boolean(record.metadataJson.usedInSynthesis);
}

export async function runVerificationNode(state: ResearchGraphState) {
  console.info(`[research:${state.runId}] stage_start`, { stage: 'verification' });

  if (await hasStageCompleted(state.runId, 'verification')) {
    const findings = await listResearchFindings(state.runId);

    return {
      status: state.status,
      currentStage: state.currentStage,
      findings: findings.map((finding) => ({
        sectionKey: finding.sectionKey,
        claim: finding.claim,
        evidence: finding.evidenceJson,
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
  const ruleSourceIndex = buildEvidenceRuleSourceIndex(synthesisEvidence);
  const evidenceSummary = synthesisEvidence
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

  const draftFindingsSummary = state.findings
    .map((finding) => {
      const evidenceIds = finding.evidence.map((citation) => citation.evidenceId).join(', ');
      return [
        `Section: ${finding.sectionKey}`,
        `Claim: ${finding.claim}`,
        `Confidence: ${finding.confidence}`,
        `Evidence IDs: ${evidenceIds}`,
        `Notes: ${finding.verificationNotes || 'n/a'}`,
        `Gaps: ${finding.gaps.join(' | ') || 'none'}`,
      ].join('\n');
    })
    .join('\n\n---\n\n');

  const verified = await generateStructuredOutput<VerificationOutput>({
    schema: verificationOutputSchema,
    system:
      'You are a GTM research verifier. Verify or downgrade claims based on the supplied evidence only. Return verified claims, explicit gaps, and a competitor matrix when the evidence supports it.',
    prompt: [
      `Topic: ${state.topic}`,
      `Objective: ${state.objective ?? 'Not provided.'}`,
      'Evidence rules:',
      '- claims should remain verified only if evidence is sufficiently strong',
      '- competitorMatrix rows must stay close to the cited evidence and should be sparse if evidence is thin',
      '- do not invent pricing, integrations, or positioning details that are not grounded in the evidence',
      `Evidence ledger:\n${evidenceSummary || 'No evidence available.'}`,
      `Draft claims:\n${draftFindingsSummary || 'No draft claims available.'}`,
      'For every finding object, always include status, verificationNotes, gaps, and contradictions.',
      'Use only evidence IDs that were provided.',
    ].join('\n\n'),
  });

  const findings = sanitizeFindings(verified.findings, evidenceIndex)
    .filter((finding) => !getSectionPolicy(finding.sectionKey).derivedOnly)
    .map((finding) => {
    const assessment = getEvidenceRuleAssessment(finding.evidence, ruleSourceIndex);
    const failed = !assessment.passes;

    return {
      ...finding,
      confidence: failed ? 'low' : finding.confidence,
      status: failed ? 'needs-review' : finding.status,
      verificationNotes: failed
        ? [finding.verificationNotes, 'Evidence rule failed: requires one strong primary/research source or two independent medium-quality sources.']
            .filter(Boolean)
            .join(' ')
        : finding.verificationNotes,
      gaps: failed
        ? [
            ...finding.gaps,
            'Add one strong official/research source or two independent medium-quality sources to verify this claim.',
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
      competitorMatrixCount: verified.competitorMatrix.length,
    },
  );
  console.info(`[research:${state.runId}] stage_complete`, {
    stage: 'verification',
    verifiedFindingCount: findings.filter((finding) => finding.status === 'verified').length,
    needsReviewCount: findings.filter((finding) => finding.status === 'needs-review').length,
    competitorMatrixCount: verified.competitorMatrix.length,
  });

  return {
    status: 'verifying' as const,
    currentStage: 'verification',
    findings,
    competitorMatrix: verified.competitorMatrix as CompetitorMatrixEntry[],
    keyTakeaways: verified.keyTakeaways,
  };
}

import { generateStructuredOutput } from '@/lib/research/ai';
import { buildEvidenceByCitation, getDefaultClaimType, inferFindingSpecificity } from '@/lib/research/claim-specificity';
import {
  appendResearchEvent,
  hasStageCompleted,
  listResearchFindings,
  replaceResearchFindings,
  setRunStage,
} from '@/lib/research/repository';
import {
  draftReportSchema,
  finalReportSectionKeyValues,
  type Citation,
  type DraftReport,
  type ResearchEvidence,
  type ResearchFinding,
  type ResearchGraphState,
} from '@/lib/research/schemas';
import { getSectionPolicy, selectEvidenceForSection } from '@/lib/research/section-policy';

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
      const specificity = inferFindingSpecificity(
        finding.sectionKey,
        buildEvidenceByCitation(evidence, evidenceRecordIndex),
        finding.claim,
      );

      return {
        ...finding,
        claimType: getDefaultClaimType(finding.sectionKey),
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

export async function runDraftReportNode(state: ResearchGraphState) {
  console.info(`[research:${state.runId}] stage_start`, { stage: 'draft_report' });

  if (!state.plan) {
    throw new Error('Cannot extract claims without a research plan.');
  }

  if (await hasStageCompleted(state.runId, 'draft_report')) {
    const findings = await listResearchFindings(state.runId);

    return {
      status: state.status,
      currentStage: state.currentStage,
      findings: findings.map((finding) => ({
        sectionKey: finding.sectionKey,
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

  await setRunStage(state.runId, 'drafting', 'draft_report');
  await appendResearchEvent(state.runId, 'draft_report', 'stage_started', 'Extracting draft claims from evidence.');

  const synthesisEvidence = state.evidenceRecords.filter(isEvidenceUsedInSynthesis);
  const evidenceIndex = buildEvidenceIndex(synthesisEvidence);
  const evidenceRecordIndex = buildEvidenceRecordIndex(synthesisEvidence);
  const evidenceSummary = finalReportSectionKeyValues
    .filter((sectionKey) => !getSectionPolicy(sectionKey).derivedOnly)
    .map((sectionKey) => {
      const sectionEvidence = selectEvidenceForSection(sectionKey, synthesisEvidence);
      return [
        `Section: ${sectionKey}`,
        sectionEvidence.length === 0
          ? 'No policy-matched evidence.'
          : sectionEvidence
              .map((record) =>
                [
                  `Evidence ID: ${record.id}`,
                  `Source type: ${record.sourceType}`,
                  `Evidence mode: ${record.metadataJson.evidenceMode ?? (record.sourceType === 'document' ? 'document-internal' : 'market-adjacent')}`,
                  `Title: ${record.title}`,
                  `URL: ${record.url ?? 'n/a'}`,
                  `Excerpt: ${record.excerpt}`,
                  `Metadata: ${JSON.stringify(record.metadataJson)}`,
                ].join('\n'),
              )
              .join('\n\n---\n\n'),
      ].join('\n');
    })
    .join('\n\n====\n\n');

  const draft = await generateStructuredOutput<DraftReport>({
    schema: draftReportSchema,
    system:
      'You are a GTM research analyst. Extract draft claims from evidence. Every claim must cite one or more provided evidence IDs, and all claims must stay close to the evidence.',
    prompt: [
      `Topic: ${state.topic}`,
      `Objective: ${state.objective ?? 'Not provided.'}`,
      'Generate claims for these exact section keys only:',
      '- market-landscape',
      '- icp-and-buyer',
      '- competitor-landscape',
      '- pricing-and-packaging',
      '- gtm-motion',
      '- risks-and-unknowns',
      'Do not generate direct recommendation claims from raw evidence. Recommendation will be derived later from verified claims.',
      'Section-specific rules:',
      '- competitor-landscape claims should focus on meaningful differences across vendors, especially workflow fit, CRM sync, conversation intelligence, and team packaging',
      '- pricing-and-packaging claims should stay literal to vendor seat mechanics, plan structure, and packaging',
      '- gtm-motion claims must be about software buying process, channel preference, partner or marketplace usage, direct purchase preference, or adoption friction relevant to buying; do not use generic productivity claims as GTM motion evidence',
      '- risks-and-unknowns claims should focus on deployment, compliance, privacy, consent, integration, trust, or rollout friction',
      'For every finding include:',
      '- claimType that matches the section',
      '- evidenceMode based on the strongest cited evidence',
      '- inferenceLabel set to direct when the evidence states the point directly, inferred when the claim connects adjacent evidence to the target market, and speculative only if the evidence is weak',
      `Research questions:\n- ${state.plan.researchQuestions.join('\n- ')}`,
      `Search intents:\n- ${state.plan.searchQueries.map((query) => `${query.intent}: ${query.query}`).join('\n- ')}`,
      `Section-scoped evidence ledger:\n${evidenceSummary || 'No qualifying evidence records available.'}`,
      'Return 1-2 concise claims per section where evidence exists.',
      'For each finding:',
      '- use status "draft"',
      '- keep verificationNotes empty unless the evidence itself is obviously weak',
      '- include gaps when the evidence is insufficient',
      '- include contradictions when evidence appears to conflict or when evidence for a section is missing',
      '- cite only evidence IDs that were provided',
    ].join('\n\n'),
  });

  const findings = sanitizeFindings(draft.findings, evidenceIndex, evidenceRecordIndex);

  await replaceResearchFindings(state.runId, findings);
  await appendResearchEvent(state.runId, 'draft_report', 'stage_completed', 'Draft claims saved.', {
    findingCount: findings.length,
    evidenceCount: synthesisEvidence.length,
  });
  console.info(`[research:${state.runId}] stage_complete`, {
    stage: 'draft_report',
    findingCount: findings.length,
    evidenceCount: synthesisEvidence.length,
  });

  return {
    status: 'drafting' as const,
    currentStage: 'draft_report',
    findings,
  };
}

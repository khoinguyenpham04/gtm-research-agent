import { generateStructuredOutput } from '@/lib/research/ai';
import {
  appendResearchEvent,
  hasStageCompleted,
  listResearchFindings,
  replaceResearchFindings,
  setRunStage,
} from '@/lib/research/repository';
import {
  draftReportSchema,
  type Citation,
  type DraftReport,
  type ResearchEvidence,
  type ResearchFinding,
  type ResearchGraphState,
} from '@/lib/research/schemas';

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

  await setRunStage(state.runId, 'drafting', 'draft_report');
  await appendResearchEvent(state.runId, 'draft_report', 'stage_started', 'Extracting draft claims from evidence.');

  const synthesisEvidence = state.evidenceRecords.filter(isEvidenceUsedInSynthesis);
  const evidenceIndex = buildEvidenceIndex(synthesisEvidence);
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
      '- recommendation',
      `Research questions:\n- ${state.plan.researchQuestions.join('\n- ')}`,
      `Search intents:\n- ${state.plan.searchQueries.map((query) => `${query.intent}: ${query.query}`).join('\n- ')}`,
      `Evidence ledger:\n${evidenceSummary || 'No qualifying evidence records available.'}`,
      'Return 1-2 concise claims per section where evidence exists.',
      'For each finding:',
      '- use status "draft"',
      '- keep verificationNotes empty unless the evidence itself is obviously weak',
      '- include gaps when the evidence is insufficient',
      '- include contradictions when evidence appears to conflict or when evidence for a section is missing',
      '- cite only evidence IDs that were provided',
    ].join('\n\n'),
  });

  const findings = sanitizeFindings(draft.findings, evidenceIndex);

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

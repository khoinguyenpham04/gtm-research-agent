import { generateStructuredOutput } from '@/lib/research/ai';
import { buildEvidenceByCitation, getDefaultClaimType, inferFindingSpecificity } from '@/lib/research/claim-specificity';
import {
  buildDeterministicCompetitorProfiles,
  type DeterministicCompetitorProfile,
} from '@/lib/research/competitor-extraction';
import {
  appendResearchEvent,
  hasStageCompleted,
  listResearchFindings,
  replaceResearchFindings,
  setRunStage,
} from '@/lib/research/repository';
import {
  researchFindingSchema,
  type Citation,
  type ResearchEvidence,
  type ResearchFinding,
  type ResearchGraphState,
} from '@/lib/research/schemas';
import { resolveFindingSectionKey, resolveSectionKey } from '@/lib/research/section-routing';
import { selectEvidenceForSection } from '@/lib/research/section-policy';
import { z } from 'zod';

const sectionWorkerSchema = z.object({
  findings: z.array(researchFindingSchema).max(6),
});

type DraftSectionKey = Exclude<ResearchFinding['sectionKey'], 'recommendation'>;

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
        resolveFindingSectionKey(finding, evidenceRecordIndex),
        buildEvidenceByCitation(evidence, evidenceRecordIndex),
        finding.claim,
      );
      const sectionKey = resolveFindingSectionKey(finding, evidenceRecordIndex);

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

function buildSectionEvidenceSummary(
  synthesisEvidence: ResearchEvidence[],
  sectionKeys: DraftSectionKey[],
) {
  return sectionKeys
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
                  `Evidence mode: ${
                    record.metadataJson.evidenceMode ??
                    (record.sourceType === 'document' ? 'document-internal' : 'market-adjacent')
                  }`,
                  `Subtopic: ${typeof record.metadataJson.subtopic === 'string' ? record.metadataJson.subtopic : 'unknown'}`,
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
}

async function runNarrativeSectionWorker(
  state: ResearchGraphState,
  synthesisEvidence: ResearchEvidence[],
  sectionKeys: DraftSectionKey[],
  sectionRules: string[],
) {
  const evidenceSummary = buildSectionEvidenceSummary(synthesisEvidence, sectionKeys);
  const result = await generateStructuredOutput<{ findings: ResearchFinding[] }>({
    schema: sectionWorkerSchema,
    system:
      'You are a GTM research analyst. Extract draft claims only for the requested sections. Every claim must cite provided evidence IDs and stay close to the evidence.',
    prompt: [
      `Topic: ${state.topic}`,
      `Objective: ${state.objective ?? 'Not provided.'}`,
      `Target sections:\n- ${sectionKeys.join('\n- ')}`,
      'Do not generate recommendation claims.',
      'Return 0-2 concise claims per requested section when evidence exists.',
      'For every finding include:',
      '- claimType that matches the section',
      '- evidenceMode based on the strongest cited evidence',
      '- inferenceLabel set to direct when the evidence states the point directly, inferred when the claim connects adjacent evidence to the target market, and speculative only if the evidence is weak',
      '- status "draft"',
      '- verificationNotes empty unless the evidence itself is obviously weak',
      '- gaps when the evidence is insufficient',
      '- contradictions when evidence appears to conflict or when evidence for a section is missing',
      '- cite only evidence IDs that were provided',
      `Research questions:\n- ${state.plan?.researchQuestions.join('\n- ') ?? 'None'}`,
      `Worker rules:\n- ${sectionRules.join('\n- ')}`,
      `Section-scoped evidence ledger:\n${evidenceSummary || 'No qualifying evidence records available.'}`,
    ].join('\n\n'),
  });

  return result.findings;
}

function buildCitationMap(
  evidenceIds: string[],
  evidenceIndex: Map<string, Citation>,
) {
  return evidenceIds
    .map((evidenceId) => evidenceIndex.get(evidenceId))
    .filter((citation): citation is Citation => Boolean(citation));
}

function isSelfServePricing(profile: DeterministicCompetitorProfile) {
  const pricingText = profile.pricingEvidence.toLowerCase();
  return pricingText.includes('$') || pricingText.includes('per seat') || pricingText.includes('per user');
}

function isCustomPricing(profile: DeterministicCompetitorProfile) {
  const pricingText = profile.pricingEvidence.toLowerCase();
  return pricingText.includes('custom') || pricingText.includes('contact') || pricingText.includes('proposal');
}

function buildDeterministicCommercialFindings(
  synthesisEvidence: ResearchEvidence[],
  evidenceIndex: Map<string, Citation>,
) {
  const profiles = buildDeterministicCompetitorProfiles(synthesisEvidence);
  const findings: ResearchFinding[] = [];

  const competitorProfiles = profiles.filter((profile) => profile.hasFeatureEvidence);
  if (competitorProfiles.length >= 2) {
    const evidenceIds = competitorProfiles.slice(0, 4).flatMap((profile) => profile.evidenceIds);
    const competitorEvidence = buildCitationMap(
      evidenceIds.filter((id, index, ids) => ids.indexOf(id) === index),
      evidenceIndex,
    );

    const gongProfile = competitorProfiles.find((profile) => profile.vendor === 'Gong');
    const selfServeProfiles = competitorProfiles.filter(
      (profile) =>
        ['Otter.ai', 'Fireflies.ai', 'Avoma', 'Fathom', 'Zoom AI Companion'].includes(profile.vendor),
    );

    const deltaSummary =
      gongProfile && selfServeProfiles.length > 0
        ? `Competitor delta summary: ${gongProfile.vendor} positions around revenue intelligence, coaching, and sales-led packaging, while ${selfServeProfiles
            .slice(0, 3)
            .map((profile) => profile.vendor)
            .join(', ')} emphasize meeting capture, summaries, and CRM-connected follow-up with lower-friction team deployment.`
        : `Competitor delta summary: ${competitorProfiles
            .slice(0, 3)
            .map((profile) => `${profile.vendor} focuses on ${profile.coreFeatures.slice(0, 3).join(', ')}`)
            .join('; ')}.`;

    findings.push({
      sectionKey: 'competitor-landscape',
      claimType: 'competitor-feature',
      claim: deltaSummary,
      evidence: competitorEvidence,
      evidenceMode: 'vendor-primary',
      inferenceLabel: 'inferred',
      confidence: 'medium',
      status: 'draft',
      verificationNotes: '',
      gaps: [
        'No independent head-to-head benchmark for CRM-sync fidelity, transcript accuracy, or SMB sales outcomes in the evidence set.',
      ],
      contradictions: [],
    });
  }

  const pricingProfiles = profiles.filter((profile) => profile.hasPricingEvidence);
  if (pricingProfiles.length >= 2) {
    const evidenceIds = pricingProfiles.slice(0, 4).flatMap((profile) => profile.evidenceIds);
    const pricingEvidence = buildCitationMap(
      evidenceIds.filter((id, index, ids) => ids.indexOf(id) === index),
      evidenceIndex,
    );
    const selfServeVendors = pricingProfiles.filter(isSelfServePricing).map((profile) => profile.vendor);
    const customPricingVendors = pricingProfiles.filter(isCustomPricing).map((profile) => profile.vendor);

    findings.push({
      sectionKey: 'pricing-and-packaging',
      claimType: 'pricing',
      claim:
        customPricingVendors.length > 0
          ? `Public vendor pricing pages show a split between self-serve per-seat pricing from ${selfServeVendors.join(', ')} and sales-led custom pricing from ${customPricingVendors.join(', ')}.`
          : `Public vendor pricing pages show a per-seat SaaS model with free-to-paid or business-tier progression across ${selfServeVendors.join(', ')}.`,
      evidence: pricingEvidence,
      evidenceMode: 'vendor-primary',
      inferenceLabel: 'direct',
      confidence: 'high',
      status: 'draft',
      verificationNotes: '',
      gaps: [
        'No UK-specific GBP/VAT price sheet or reseller-discount evidence in the current pricing set.',
      ],
      contradictions: [],
    });
  }

  return findings;
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

  await setRunStage(state.runId, 'drafting', 'draft_report');
  await appendResearchEvent(state.runId, 'draft_report', 'stage_started', 'Extracting draft claims from evidence.');

  const synthesisEvidence = state.evidenceRecords.filter(isEvidenceUsedInSynthesis);
  const evidenceIndex = buildEvidenceIndex(synthesisEvidence);
  const evidenceRecordIndex = buildEvidenceRecordIndex(synthesisEvidence);

  const [marketAndBuyerFindings, gtmAndRiskFindings] = await Promise.all([
    runNarrativeSectionWorker(
      state,
      synthesisEvidence,
      ['market-landscape', 'icp-and-buyer'],
      [
        'market-landscape claims should stay grounded in product-category demand, UK AI adoption, or supply-side market evidence.',
        'icp-and-buyer claims should focus on adoption readiness, admin burden, CRM usage, and who is most likely to adopt first.',
      ],
    ),
    runNarrativeSectionWorker(
      state,
      synthesisEvidence,
      ['gtm-motion', 'risks-and-unknowns'],
      [
        'gtm-motion claims must be about buying process, channel preference, partner or MSP or marketplace versus direct route, and purchase friction.',
        'risks-and-unknowns claims should focus on deployment, compliance, privacy, consent, integration, trust, or rollout friction.',
      ],
    ),
  ]);

  const commercialFindings = buildDeterministicCommercialFindings(
    synthesisEvidence,
    evidenceIndex,
  );
  const findings = sanitizeFindings(
    [...marketAndBuyerFindings, ...gtmAndRiskFindings, ...commercialFindings],
    evidenceIndex,
    evidenceRecordIndex,
  );

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

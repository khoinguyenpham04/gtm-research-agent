import {
  appendResearchEvent,
  finalizeRun,
  hasStageCompleted,
  replaceResearchReportSections,
} from '@/lib/research/repository';
import {
  assessSectionStatus,
  buildInsufficientEvidenceSection,
  filterCandidatesForSection,
  getSectionPolicy,
} from '@/lib/research/section-policy';
import type {
  Citation,
  CompetitorMatrixEntry,
  DraftReportSection,
  ResearchFinding,
  ResearchGraphState,
} from '@/lib/research/schemas';
import { structuredRecommendationSchema, type StructuredRecommendation } from '@/lib/research/schemas';

const sectionDefinitions = [
  { key: 'market-landscape', title: 'Market Landscape' },
  { key: 'icp-and-buyer', title: 'ICP and Buyer' },
  { key: 'competitor-landscape', title: 'Competitor Landscape' },
  { key: 'pricing-and-packaging', title: 'Pricing and Packaging' },
  { key: 'gtm-motion', title: 'GTM Motion' },
  { key: 'risks-and-unknowns', title: 'Risks and Unknowns' },
  { key: 'recommendation', title: 'Recommendation' },
] as const;

const sectionRank: Record<ResearchFinding['sectionKey'], number> = {
  'market-landscape': 0,
  'icp-and-buyer': 1,
  'competitor-landscape': 2,
  'pricing-and-packaging': 3,
  'gtm-motion': 4,
  'risks-and-unknowns': 5,
  recommendation: 6,
};

const confidenceRank: Record<ResearchFinding['confidence'], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

interface SectionBuildResult extends DraftReportSection {
  sectionKey: ResearchFinding['sectionKey'];
}

function uniqueCitations(findings: ResearchFinding[]) {
  const seen = new Map<string, Citation>();

  for (const finding of findings) {
    for (const citation of finding.evidence) {
      seen.set(citation.evidenceId, citation);
    }
  }

  return Array.from(seen.values());
}

function buildCompetitorMatrixMarkdown(entries: CompetitorMatrixEntry[]) {
  if (entries.length === 0) {
    return 'No competitor matrix could be built from verified evidence yet.';
  }

  const lines = [
    '### Competitor Matrix',
    '| Vendor | ICP | Core features | CRM integrations | Pricing evidence | Target segment | Confidence |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const entry of entries) {
    lines.push(
      `| ${entry.vendor} | ${entry.icp} | ${entry.coreFeatures.join(', ')} | ${entry.crmIntegrations.join(', ') || 'Not established'} | ${entry.pricingEvidence} | ${entry.targetSegment} | ${entry.confidence} |`,
    );
  }

  return lines.join('\n');
}

function buildSectionMarkdown(sectionKey: ResearchFinding['sectionKey'], findings: ResearchFinding[], competitorMatrix: CompetitorMatrixEntry[]) {
  const verified = findings.filter((finding) => finding.status === 'verified');
  const needsReview = findings.filter((finding) => finding.status === 'needs-review');
  const lines: string[] = [];

  if (verified.length > 0) {
    lines.push('### Verified claims');
    for (const finding of verified) {
      lines.push(`- ${finding.claim}`);
      lines.push(
        `  Type: ${finding.claimType} | Evidence mode: ${finding.evidenceMode} | Inference: ${finding.inferenceLabel}`,
      );
      if (finding.verificationNotes) {
        lines.push(`  Note: ${finding.verificationNotes}`);
      }
    }
  }

  if (sectionKey === 'competitor-landscape') {
    lines.push('', buildCompetitorMatrixMarkdown(competitorMatrix));
  }

  if (needsReview.length > 0) {
    lines.push('', '### Needs review');
    for (const finding of needsReview) {
      lines.push(`- ${finding.claim}`);
      lines.push(
        `  Type: ${finding.claimType} | Evidence mode: ${finding.evidenceMode} | Inference: ${finding.inferenceLabel}`,
      );
      if (finding.verificationNotes) {
        lines.push(`  Note: ${finding.verificationNotes}`);
      }
      for (const gap of finding.gaps) {
        lines.push(`  Gap: ${gap}`);
      }
      for (const contradiction of finding.contradictions) {
        lines.push(`  Contradiction: ${contradiction}`);
      }
    }
  }

  if (lines.length === 0) {
    return 'No strong evidence-backed claims were generated for this section yet.';
  }

  return lines.join('\n');
}

function buildIcpSummary(findings: ResearchFinding[], competitorMatrix: CompetitorMatrixEntry[]) {
  const combined = [
    ...findings.map((finding) => finding.claim.toLowerCase()),
    ...competitorMatrix.map((entry) => `${entry.icp} ${entry.targetSegment}`.toLowerCase()),
  ].join(' ');

  if (combined.includes('sales') && (combined.includes('small') || combined.includes('smb'))) {
    return 'UK SMB sales teams already using cloud CRM and meeting software.';
  }

  if (combined.includes('sales')) {
    return 'UK sales teams with recurring meeting follow-up and CRM admin work.';
  }

  if (combined.includes('small') || combined.includes('smb')) {
    return 'UK SMB teams with repeat meeting documentation and follow-up workflows.';
  }

  return 'UK SMB sales teams with repeat meeting and CRM follow-up workflows.';
}

function buildTriggerProblemSummary(findings: ResearchFinding[]) {
  const combined = findings.map((finding) => finding.claim.toLowerCase()).join(' ');

  if (
    combined.includes('crm') ||
    combined.includes('follow-up') ||
    combined.includes('notes') ||
    combined.includes('admin')
  ) {
    return 'Manual meeting notes, CRM updates, and follow-up admin reduce time spent selling.';
  }

  return 'Post-meeting admin and fragmented follow-up slow sales execution and CRM hygiene.';
}

function buildPricingThesis(
  pricingClaims: ResearchFinding[],
  competitorMatrix: CompetitorMatrixEntry[],
) {
  if (pricingClaims.length === 0 && competitorMatrix.length === 0) {
    return 'Use transparent self-serve per-seat pricing before adding enterprise sales assist or custom packaging.';
  }

  const pricingText = [
    ...pricingClaims.map((finding) => finding.claim.toLowerCase()),
    ...competitorMatrix.map((entry) => entry.pricingEvidence.toLowerCase()),
  ].join(' ');

  if (pricingText.includes('enterprise') || pricingText.includes('contact')) {
    return 'Lead with transparent self-serve per-seat pricing and keep an enterprise/contact tier for larger deployments.';
  }

  return 'Lead with transparent self-serve per-seat pricing and a low-friction team tier for expansion.';
}

function buildGtmChannelSummary(
  readySectionKeys: Set<ResearchFinding['sectionKey']>,
  gtmClaims: ResearchFinding[],
) {
  if (!readySectionKeys.has('gtm-motion') || gtmClaims.length === 0) {
    return 'Insufficient direct GTM evidence to choose between direct, partner, MSP, or marketplace-led acquisition yet; validate the buying path before scaling channel spend.';
  }

  return gtmClaims[0]?.claim ?? 'Validate the strongest direct and channel route from verified GTM evidence before scaling spend.';
}

function buildRecommendationSection(
  findings: ResearchFinding[],
  readySectionKeys: Set<ResearchFinding['sectionKey']>,
  baseSections: SectionBuildResult[],
  competitorMatrix: CompetitorMatrixEntry[],
) {
  const dependencies = getSectionPolicy('recommendation').recommendationDependencies ?? [];
  const upstreamClaims = findings.filter(
    (finding) =>
      finding.status === 'verified' &&
      finding.inferenceLabel !== 'speculative' &&
      dependencies.includes(finding.sectionKey) &&
      readySectionKeys.has(finding.sectionKey),
  );

  if (upstreamClaims.length < 2) {
    return {
      contentMarkdown: '### Insufficient evidence\n- Not enough verified upstream findings to derive a recommendation safely.',
      status: 'insufficient_evidence' as const,
      statusNotes: ['Not enough verified upstream findings to derive a recommendation safely.'],
      citations: [],
    };
  }

  const bySection = (sectionKey: ResearchFinding['sectionKey']) =>
    upstreamClaims.filter((finding) => finding.sectionKey === sectionKey);
  const incompleteSections = baseSections.filter((section) => section.status !== 'ready');
  const pricingClaims = bySection('pricing-and-packaging');
  const gtmClaims = bySection('gtm-motion');
  const riskClaims = bySection('risks-and-unknowns');
  const buyerClaims = bySection('icp-and-buyer');
  const competitorCount = competitorMatrix.length;
  const directClaimCount = upstreamClaims.filter((finding) => finding.inferenceLabel === 'direct').length;

  const recommendationInput: StructuredRecommendation = {
    icp: buildIcpSummary(buyerClaims, competitorMatrix),
    triggerProblem: buildTriggerProblemSummary(buyerClaims),
    positionAgainstIncumbentWorkflow:
      competitorCount > 0
        ? 'Position as a lightweight layer on top of existing meeting and CRM workflows, replacing manual note capture and CRM writeback rather than forcing a platform switch.'
        : 'Position against manual note-taking, fragmented follow-up, and incomplete CRM updates rather than against a single incumbent vendor.',
    pricingHypothesis: buildPricingThesis(pricingClaims, competitorMatrix),
    gtmChannelHypothesis: buildGtmChannelSummary(readySectionKeys, gtmClaims),
    implementationRisk:
      riskClaims[0]?.claim ||
      'UK deployment still needs explicit handling for consent, privacy, data protection, and CRM integration friction before broader rollout.',
    confidence:
      readySectionKeys.has('gtm-motion') &&
      readySectionKeys.has('risks-and-unknowns') &&
      directClaimCount >= 3
        ? 'high'
        : readySectionKeys.has('pricing-and-packaging') && directClaimCount >= 2
          ? 'medium'
          : 'low',
    openQuestions: [
      ...incompleteSections.flatMap((section) =>
        section.statusNotes.map((note) => `${section.title}: ${note}`),
      ),
      ...upstreamClaims.flatMap((finding) => finding.gaps),
    ]
      .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
      .slice(0, 6),
  };

  if (recommendationInput.openQuestions.length === 0) {
    recommendationInput.openQuestions.push(
      'Validate UK buying-path evidence for direct, partner, MSP, or marketplace-led acquisition before committing to a scaled GTM motion.',
    );
  }

  const recommendation = structuredRecommendationSchema.parse(recommendationInput);

  const lines = [
    '### Structured recommendation',
    `- ICP: ${recommendation.icp}`,
    `- Trigger problem: ${recommendation.triggerProblem}`,
    `- Position against incumbent workflow: ${recommendation.positionAgainstIncumbentWorkflow}`,
    `- Pricing hypothesis: ${recommendation.pricingHypothesis}`,
    `- GTM channel hypothesis: ${recommendation.gtmChannelHypothesis}`,
    `- Implementation risk: ${recommendation.implementationRisk}`,
    `- Confidence: ${recommendation.confidence}`,
    '',
    '### Open questions',
    ...recommendation.openQuestions.map((question) => `- ${question}`),
    '',
    '### Verified inputs used',
    ...upstreamClaims.slice(0, 6).map((finding) => `- [${finding.sectionKey}] ${finding.claim}`),
  ];

  return {
    contentMarkdown: lines.join('\n'),
    status: 'ready' as const,
    statusNotes: [] as string[],
    citations: uniqueCitations(upstreamClaims).map((citation) => citation.evidenceId),
  };
}

function buildReportSections(
  findings: ResearchFinding[],
  competitorMatrix: CompetitorMatrixEntry[],
  evidenceRecords: ResearchGraphState['evidenceRecords'],
  retrievalCandidates: ResearchGraphState['retrievalCandidates'],
) {
  const baseSections = sectionDefinitions
    .filter((section) => section.key !== 'recommendation')
    .map((section) => {
    const sectionFindings = findings.filter((finding) => finding.sectionKey === section.key);
    const sectionStatus = assessSectionStatus(section.key, evidenceRecords, findings);
    const selectedCandidates = filterCandidatesForSection(section.key, retrievalCandidates).filter(
      (candidate) => candidate.selected,
    );

    if (selectedCandidates.length === 0) {
      sectionStatus.notes.push('No selected retrieval candidates met the section policy.');
    }

    if (sectionStatus.status === 'insufficient_evidence') {
      return {
        ...buildInsufficientEvidenceSection(
          { sectionKey: section.key, title: section.title },
          sectionStatus.notes,
        ),
        sectionKey: section.key,
      } satisfies SectionBuildResult;
    }

    return {
      sectionKey: section.key,
      title: section.title,
      contentMarkdown: buildSectionMarkdown(section.key, sectionFindings, competitorMatrix),
      citations: uniqueCitations(sectionFindings).map((citation) => citation.evidenceId),
      status: sectionStatus.status,
      statusNotes: sectionStatus.notes,
    } satisfies SectionBuildResult;
  });

  const readySectionKeys = new Set(
    baseSections
      .filter((section) => section.status === 'ready')
      .map((section) => section.sectionKey as ResearchFinding['sectionKey']),
  );
  const recommendation = buildRecommendationSection(
    findings,
    readySectionKeys,
    baseSections,
    competitorMatrix,
  );

  return [
    ...baseSections,
    {
      sectionKey: 'recommendation',
      title: 'Recommendation',
      contentMarkdown: recommendation.contentMarkdown,
      citations: recommendation.citations,
      status: recommendation.status,
      statusNotes: recommendation.statusNotes,
    } satisfies SectionBuildResult,
  ];
}

function sortFindingsForSummary(left: ResearchFinding, right: ResearchFinding) {
  if (left.inferenceLabel !== right.inferenceLabel) {
    return left.inferenceLabel === 'direct' ? -1 : 1;
  }

  if (left.confidence !== right.confidence) {
    return confidenceRank[left.confidence] - confidenceRank[right.confidence];
  }

  return sectionRank[left.sectionKey] - sectionRank[right.sectionKey];
}

function buildReadySectionTakeaways(
  findings: ResearchFinding[],
  readySectionKeys: Set<ResearchFinding['sectionKey']>,
) {
  return findings
    .filter(
      (finding) => finding.status === 'verified' && readySectionKeys.has(finding.sectionKey),
    )
    .sort(sortFindingsForSummary)
    .map((finding) => finding.claim)
    .filter((claim, index, claims) => claims.indexOf(claim) === index)
    .slice(0, 5);
}

function buildExecutiveSummary(
  findings: ResearchFinding[],
  readySectionKeys: Set<ResearchFinding['sectionKey']>,
) {
  const verifiedClaims = findings
    .filter((finding) => finding.status === 'verified' && readySectionKeys.has(finding.sectionKey))
    .sort(sortFindingsForSummary)
    .slice(0, 4);

  if (verifiedClaims.length === 0) {
    return 'No section met the ready threshold. Review the evidence ledger and insufficient sections before using this brief for decisions.';
  }

  return verifiedClaims.map((finding) => finding.claim).join(' ');
}

function buildFinalMarkdown(
  keyTakeaways: string[],
  sections: DraftReportSection[],
  evidenceIndex: Map<string, Citation>,
  executiveSummary: string,
) {
  const lines = ['# GTM Research Brief', '', '## Executive Summary', executiveSummary.trim()];

  if (keyTakeaways.length > 0) {
    lines.push('', '## Key Takeaways');
    for (const takeaway of keyTakeaways) {
      lines.push(`- ${takeaway}`);
    }
  }

  for (const section of sections) {
    lines.push('', `## ${section.title}`, section.contentMarkdown.trim());

    if (section.citations.length > 0) {
      lines.push('', '### Evidence');
      for (const citationId of section.citations) {
        const citation = evidenceIndex.get(citationId);
        if (!citation) {
          continue;
        }

        lines.push(
          citation.url
            ? `- [${citation.title}](${citation.url}) - ${citation.excerpt}`
            : `- ${citation.title} - ${citation.excerpt}`,
        );
      }
    }
  }

  return lines.join('\n');
}

export async function runFinalizeNode(state: ResearchGraphState) {
  console.info(`[research:${state.runId}] stage_start`, { stage: 'finalize' });

  if (await hasStageCompleted(state.runId, 'finalize')) {
    return {
      status: 'completed' as const,
      currentStage: 'finalize',
      finalReportMarkdown: state.finalReportMarkdown,
    };
  }

  const evidenceIndex = new Map(
    state.evidenceRecords.map((record) => [
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
  const sections = buildReportSections(
    state.findings,
    state.competitorMatrix,
    state.evidenceRecords,
    state.retrievalCandidates,
  );
  const readySectionKeys = new Set(
    sections
      .filter((section) => section.status === 'ready')
      .map((section) => section.sectionKey as ResearchFinding['sectionKey']),
  );
  const keyTakeaways = buildReadySectionTakeaways(state.findings, readySectionKeys);
  const executiveSummary = buildExecutiveSummary(state.findings, readySectionKeys);
  const finalReportMarkdown = buildFinalMarkdown(
    keyTakeaways,
    sections,
    evidenceIndex,
    executiveSummary,
  );

  await replaceResearchReportSections(state.runId, sections);
  await finalizeRun(state.runId, finalReportMarkdown);
  await appendResearchEvent(state.runId, 'finalize', 'stage_completed', 'Research run completed.', {
    reportReady: true,
    sectionCount: sections.length,
  });
  console.info(`[research:${state.runId}] stage_complete`, { stage: 'finalize' });

  return {
    status: 'completed' as const,
    currentStage: 'finalize',
    reportSections: sections,
    finalReportMarkdown,
  };
}

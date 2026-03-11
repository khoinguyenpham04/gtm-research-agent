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
import {
  compactClaimSentence,
  deriveTopicAudiencePhrase,
  deriveTopicSearchPhrase,
} from '@/lib/research/topic-utils';

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
    '| Vendor | ICP | Core features | Integrations / ecosystem | Pricing evidence | Target segment | Confidence |',
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

function buildIcpSummary(
  topic: string,
  objective: string | undefined,
  findings: ResearchFinding[],
  competitorMatrix: CompetitorMatrixEntry[],
) {
  const directBuyerClaim = findings.find((finding) => finding.claimType === 'buyer-pain')?.claim;
  if (directBuyerClaim) {
    return compactClaimSentence(directBuyerClaim);
  }

  const directAdoptionClaim = findings.find((finding) => finding.claimType === 'adoption-signal')?.claim;
  if (directAdoptionClaim) {
    return compactClaimSentence(directAdoptionClaim);
  }

  const audience = deriveTopicAudiencePhrase(topic, objective);
  if (audience) {
    return `${audience} appear to be the primary buyer segment for this topic.`;
  }

  const matrixAudience = competitorMatrix
    .map((entry) => entry.icp)
    .find((value) => !/^target segment not explicit$/i.test(value));
  if (matrixAudience) {
    return compactClaimSentence(matrixAudience);
  }

  return `Primary buyer segment for ${deriveTopicSearchPhrase(topic)} still needs sharper direct evidence.`;
}

function buildTriggerProblemSummary(findings: ResearchFinding[]) {
  const buyerPainClaim = findings.find((finding) => finding.claimType === 'buyer-pain')?.claim;
  if (buyerPainClaim) {
    return compactClaimSentence(buyerPainClaim);
  }

  const riskClaim = findings.find((finding) => finding.claimType === 'risk')?.claim;
  if (riskClaim) {
    return compactClaimSentence(riskClaim);
  }

  return 'The primary workflow pain or purchase trigger still needs direct evidence.';
}

function buildPricingThesis(
  pricingClaims: ResearchFinding[],
  competitorMatrix: CompetitorMatrixEntry[],
) {
  if (pricingClaims.length === 0 && competitorMatrix.length === 0) {
    return 'Pricing evidence is still limited; validate whether buyers expect transparent published pricing, installer quotes, or sales-assisted packaging.';
  }

  const pricingText = [
    ...pricingClaims.map((finding) => finding.claim.toLowerCase()),
    ...competitorMatrix.map((entry) => entry.pricingEvidence.toLowerCase()),
  ].join(' ');

  if (pricingText.includes('enterprise') || pricingText.includes('contact')) {
    return 'Use transparent published pricing where possible and keep a sales-assisted or quote-led path for larger or more customized deployments.';
  }

  if (pricingText.includes('installed') || pricingText.includes('configuration') || pricingText.includes('quote')) {
    return 'Treat pricing as configuration- and installation-dependent, with clear quote ranges and ROI framing rather than one flat list price.';
  }

  return 'Lead with the simplest pricing structure supported by evidence, then add heavier commercial packaging only where complexity or customization requires it.';
}

function buildGtmChannelSummary(
  readySectionKeys: Set<ResearchFinding['sectionKey']>,
  gtmClaims: ResearchFinding[],
) {
  if (!readySectionKeys.has('gtm-motion') || gtmClaims.length === 0) {
    return 'Insufficient direct GTM evidence to choose the dominant acquisition path yet; validate buying process, channel preference, and purchase friction before scaling spend.';
  }

  return compactClaimSentence(gtmClaims[0]?.claim ?? 'Validate the strongest direct and channel route from verified GTM evidence before scaling spend.');
}

function buildRecommendationSection(
  topic: string,
  objective: string | undefined,
  findings: ResearchFinding[],
  readySectionKeys: Set<ResearchFinding['sectionKey']>,
  baseSections: SectionBuildResult[],
  competitorMatrix: CompetitorMatrixEntry[],
) {
  const dependencies = getSectionPolicy('recommendation').recommendationDependencies ?? [];
  const requiredReadySections: ResearchFinding['sectionKey'][] = [
    'market-landscape',
    'icp-and-buyer',
    'pricing-and-packaging',
    'risks-and-unknowns',
  ];
  const missingRequiredSections = requiredReadySections.filter(
    (sectionKey) => !readySectionKeys.has(sectionKey),
  );
  const upstreamClaims = findings.filter(
    (finding) =>
      finding.status === 'verified' &&
      finding.inferenceLabel !== 'speculative' &&
      dependencies.includes(finding.sectionKey) &&
      readySectionKeys.has(finding.sectionKey),
  );

  if (missingRequiredSections.length > 0 || upstreamClaims.length < 3) {
    const blockingNotes = [
      ...missingRequiredSections.map((sectionKey) => `Recommendation requires ${sectionKey} to be ready.`),
      ...(upstreamClaims.length < 3
        ? ['Not enough verified upstream findings to derive a recommendation safely.']
        : []),
    ];

    return {
      contentMarkdown: ['### Insufficient evidence', ...blockingNotes.map((note) => `- ${note}`)].join('\n'),
      status: 'insufficient_evidence' as const,
      statusNotes: blockingNotes,
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
    icp: buildIcpSummary(topic, objective, buyerClaims, competitorMatrix),
    triggerProblem: buildTriggerProblemSummary(buyerClaims),
    positionAgainstIncumbentWorkflow:
      competitorCount > 0
        ? 'Position against incumbent approaches by emphasizing the clearest documented implementation, workflow, and ROI advantages surfaced in the verified competitor set.'
        : `Position against the current default workflow for ${deriveTopicSearchPhrase(topic)} rather than assuming a single incumbent vendor.`,
    pricingHypothesis: buildPricingThesis(pricingClaims, competitorMatrix),
    gtmChannelHypothesis: buildGtmChannelSummary(readySectionKeys, gtmClaims),
    implementationRisk:
      compactClaimSentence(riskClaims[0]?.claim ?? '') ||
      'Implementation risks still need direct evidence on adoption barriers, trust, rollout friction, and commercial viability.',
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
  topic: string,
  objective: string | undefined,
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
    topic,
    objective,
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
    state.topic,
    state.objective,
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

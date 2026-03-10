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

const sectionDefinitions = [
  { key: 'market-landscape', title: 'Market Landscape' },
  { key: 'icp-and-buyer', title: 'ICP and Buyer' },
  { key: 'competitor-landscape', title: 'Competitor Landscape' },
  { key: 'pricing-and-packaging', title: 'Pricing and Packaging' },
  { key: 'gtm-motion', title: 'GTM Motion' },
  { key: 'risks-and-unknowns', title: 'Risks and Unknowns' },
  { key: 'recommendation', title: 'Recommendation' },
] as const;

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

function buildRecommendationSection(findings: ResearchFinding[]) {
  const dependencies = getSectionPolicy('recommendation').recommendationDependencies ?? [];
  const upstreamClaims = findings.filter(
    (finding) => finding.status === 'verified' && dependencies.includes(finding.sectionKey),
  );

  if (upstreamClaims.length < 2) {
    return {
      contentMarkdown: '### Insufficient evidence\n- Not enough verified upstream findings to derive a recommendation safely.',
      status: 'insufficient_evidence' as const,
      statusNotes: ['Not enough verified upstream findings to derive a recommendation safely.'],
      citations: [],
    };
  }

  const lines = [
    '### Derived recommendation',
    `- Target the segment suggested by the strongest verified buyer and market evidence.`,
    `- Use the GTM motion and risk findings below as operating constraints rather than assumptions.`,
    `- Avoid pricing or competitor differentiation claims that remain in needs-review state.`,
    '',
    '### Verified inputs used',
    ...upstreamClaims.slice(0, 5).map((finding) => `- [${finding.sectionKey}] ${finding.claim}`),
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
  return sectionDefinitions.map((section) => {
    if (section.key === 'recommendation') {
      const recommendation = buildRecommendationSection(findings);
      return {
        sectionKey: section.key,
        title: section.title,
        contentMarkdown: recommendation.contentMarkdown,
        citations: recommendation.citations,
        status: recommendation.status,
        statusNotes: recommendation.statusNotes,
      } satisfies DraftReportSection;
    }

    const sectionFindings = findings.filter((finding) => finding.sectionKey === section.key);
    const sectionStatus = assessSectionStatus(section.key, evidenceRecords, findings);
    const selectedCandidates = filterCandidatesForSection(section.key, retrievalCandidates).filter(
      (candidate) => candidate.selected,
    );

    if (selectedCandidates.length === 0) {
      sectionStatus.notes.push('No selected retrieval candidates met the section policy.');
    }

    if (sectionStatus.status === 'insufficient_evidence') {
      return buildInsufficientEvidenceSection(
        { sectionKey: section.key, title: section.title },
        sectionStatus.notes,
      );
    }

    return {
      sectionKey: section.key,
      title: section.title,
      contentMarkdown: buildSectionMarkdown(section.key, sectionFindings, competitorMatrix),
      citations: uniqueCitations(sectionFindings).map((citation) => citation.evidenceId),
      status: sectionStatus.status,
      statusNotes: sectionStatus.notes,
    } satisfies DraftReportSection;
  });
}

function buildExecutiveSummary(findings: ResearchFinding[]) {
  const verifiedClaims = findings.filter((finding) => finding.status === 'verified').slice(0, 4);
  if (verifiedClaims.length === 0) {
    return 'No claims met the verification bar. Review the evidence ledger and needs-review findings before using this brief for decisions.';
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
  const executiveSummary = buildExecutiveSummary(state.findings);
  const finalReportMarkdown = buildFinalMarkdown(
    state.keyTakeaways,
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

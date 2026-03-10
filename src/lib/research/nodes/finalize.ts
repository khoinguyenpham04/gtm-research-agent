import {
  appendResearchEvent,
  finalizeRun,
  hasStageCompleted,
  replaceResearchReportSections,
} from '@/lib/research/repository';
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

function buildReportSections(findings: ResearchFinding[], competitorMatrix: CompetitorMatrixEntry[]) {
  return sectionDefinitions.map((section) => {
    const sectionFindings = findings.filter((finding) => finding.sectionKey === section.key);
    return {
      sectionKey: section.key,
      title: section.title,
      contentMarkdown: buildSectionMarkdown(section.key, sectionFindings, competitorMatrix),
      citations: uniqueCitations(sectionFindings).map((citation) => citation.evidenceId),
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
  const sections = buildReportSections(state.findings, state.competitorMatrix);
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

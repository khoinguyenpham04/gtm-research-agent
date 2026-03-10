import { generateStructuredOutput } from '@/lib/research/ai';
import {
  appendResearchEvent,
  hasStageCompleted,
  listResearchFindings,
  listResearchReportSections,
  listResearchSources,
  replaceResearchFindings,
  replaceResearchReportSections,
  setRunStage,
} from '@/lib/research/repository';
import {
  type DraftReportSection,
  type Citation,
  type CompetitorMatrixEntry,
  type ResearchFinding,
  type ResearchGraphState,
  type VerifiedReport,
  verifiedReportSchema,
} from '@/lib/research/schemas';
import {
  coerceSearchIntent,
  coerceSourceCategory,
  coerceSourceQualityLabel,
  coerceSourceRecency,
  gateSourcesForSynthesis,
  getEvidenceRuleAssessment,
  sortSourcesByQuality,
} from '@/lib/research/source-scoring';

const finalSectionDefinitions = [
  { key: 'market-landscape', objectKey: 'marketLandscape', title: 'Market Landscape' },
  { key: 'icp-and-buyer', objectKey: 'icpAndBuyer', title: 'ICP and Buyer' },
  { key: 'competitor-landscape', objectKey: 'competitorLandscape', title: 'Competitor Landscape' },
  { key: 'pricing-and-packaging', objectKey: 'pricingAndPackaging', title: 'Pricing and Packaging' },
  { key: 'gtm-motion', objectKey: 'gtmMotion', title: 'GTM Motion' },
  { key: 'risks-and-unknowns', objectKey: 'risksAndUnknowns', title: 'Risks and Unknowns' },
  { key: 'recommendation', objectKey: 'recommendation', title: 'Recommendation' },
] as const;

function buildCitationIndex(
  sources: Awaited<ReturnType<typeof listResearchSources>>,
) {
  return new Map(
    sources.map((source) => [
      source.id,
      {
        sourceId: source.id,
        title: source.title,
        url: source.url,
      },
    ]),
  );
}

function sanitizeEvidence(evidence: Citation[], citations: Map<string, Citation>) {
  return evidence.filter((citation) => citations.has(citation.sourceId));
}

function toReportSections(sections: VerifiedReport['sections']) {
  return finalSectionDefinitions.map((definition) => ({
    sectionKey: definition.key,
    title: sections[definition.objectKey].title,
    contentMarkdown: sections[definition.objectKey].contentMarkdown,
    citations: sections[definition.objectKey].citations,
  }));
}

function buildCompetitorMatrixMarkdown(entries: CompetitorMatrixEntry[]) {
  if (entries.length === 0) {
    return '';
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

function buildFinalMarkdown(
  executiveSummary: string,
  takeaways: string[],
  sections: DraftReportSection[],
  competitorMatrix: CompetitorMatrixEntry[],
  citations: Map<string, Citation>,
) {
  const lines = ['# GTM Research Brief', '', '## Executive Summary', executiveSummary.trim(), '', '## Key Takeaways'];

  for (const takeaway of takeaways) {
    lines.push(`- ${takeaway}`);
  }

  for (const section of sections) {
    lines.push('', `## ${section.title}`, section.contentMarkdown.trim());

    if (section.sectionKey === 'competitor-landscape') {
      const matrixMarkdown = buildCompetitorMatrixMarkdown(competitorMatrix);
      if (matrixMarkdown) {
        lines.push('', matrixMarkdown);
      }
    }

    if (section.citations.length > 0) {
      lines.push('', '### Evidence');
      for (const citationId of section.citations) {
        const citation = citations.get(citationId);
        if (!citation) {
          continue;
        }

        lines.push(citation.url ? `- [${citation.title}](${citation.url})` : `- ${citation.title}`);
      }
    }
  }

  return lines.join('\n');
}

export async function runVerificationNode(state: ResearchGraphState) {
  console.info(`[research:${state.runId}] stage_start`, { stage: 'verification' });

  if (await hasStageCompleted(state.runId, 'verification')) {
    const [findings, sections] = await Promise.all([
      listResearchFindings(state.runId),
      listResearchReportSections(state.runId),
    ]);

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
      })),
      reportSections: sections.map((section) => ({
        sectionKey: section.sectionKey,
        title: section.title,
        contentMarkdown: section.contentMarkdown,
        citations: section.citationsJson,
      })),
    };
  }

  await setRunStage(state.runId, 'verifying', 'verification');
  await appendResearchEvent(state.runId, 'verification', 'stage_started', 'Verifying claims and strengthening report structure.');

  const persistedSources = await listResearchSources(state.runId);
  const rankedSources = sortSourcesByQuality(
    persistedSources
      .filter((source) => source.sourceType === 'web')
      .map((source) => ({
        id: source.id,
        sourceType: 'web' as const,
        title: source.title,
        url: source.url,
        snippet: source.snippet ?? '',
        query: typeof source.metadataJson.query === 'string' ? source.metadataJson.query : 'n/a',
        queryIntent: coerceSearchIntent(source.metadataJson.queryIntent),
        qualityScore: typeof source.metadataJson.qualityScore === 'number' ? source.metadataJson.qualityScore : 0,
        qualityLabel: coerceSourceQualityLabel(source.metadataJson.qualityLabel),
        sourceCategory: coerceSourceCategory(source.metadataJson.sourceCategory),
        recency: coerceSourceRecency(source.metadataJson.recency),
        publishedYear:
          typeof source.metadataJson.publishedYear === 'number' ? source.metadataJson.publishedYear : null,
        rationale:
          typeof source.metadataJson.rationale === 'string' ? source.metadataJson.rationale : 'Unscored source.',
        domain: typeof source.metadataJson.domain === 'string' ? source.metadataJson.domain : null,
        isPrimary: Boolean(source.metadataJson.isPrimary),
      })),
  );
  const gatedSources = gateSourcesForSynthesis(rankedSources).slice(0, 14);
  const citationIndex = buildCitationIndex(
    persistedSources.filter((source) => gatedSources.some((candidate) => candidate.id === source.id)),
  );
  const sourceIndex = new Map(gatedSources.map((source) => [source.id, source]));

  const sourceSummary = gatedSources
    .map((source) =>
      [
        `Source ID: ${source.id}`,
        `Title: ${source.title}`,
        `URL: ${source.url ?? 'n/a'}`,
        `Quality: ${source.qualityLabel} (${source.qualityScore})`,
        `Category: ${source.sourceCategory}`,
        `Intent: ${source.queryIntent}`,
        `Recency: ${source.recency}${source.publishedYear ? ` (${source.publishedYear})` : ''}`,
        `Query: ${source.query}`,
        `Rationale: ${source.rationale}`,
        `Snippet: ${source.snippet}`,
      ].join('\n'),
    )
    .join('\n\n---\n\n');

  const draftFindingsSummary = state.findings
    .map((finding) => {
      const evidence = finding.evidence.map((citation) => citation.sourceId).join(', ');
      return `${finding.sectionKey}: ${finding.claim}\nConfidence: ${finding.confidence}\nEvidence IDs: ${evidence}`;
    })
    .join('\n\n');

  const draftSectionsSummary = state.reportSections
    .map((section) => `${section.sectionKey} (${section.title})\n${section.contentMarkdown}`)
    .join('\n\n---\n\n');

  const verified = await generateStructuredOutput<VerifiedReport>({
    schema: verifiedReportSchema,
    system:
      'You are a GTM research verifier. Improve the report into a decision-oriented GTM brief. Prefer high-quality sources, downgrade weak evidence, state unknowns explicitly, and cite only the provided source IDs.',
    prompt: [
      `Topic: ${state.topic}`,
      `Objective: ${state.objective ?? 'Not provided.'}`,
      'Required report sections: market-landscape, icp-and-buyer, competitor-landscape, pricing-and-packaging, gtm-motion, risks-and-unknowns, recommendation.',
      'Verification rules:',
      '- only gated sources are available here; do not invent citations outside the provided source IDs',
      '- claims should be verified only when they have one strong official/research source or two independent medium-quality sources',
      '- downgrade or flag claims supported mainly by vendor/blog/comparison sources',
      '- call out mixed-date evidence',
      '- pricing-and-packaging must say when hard pricing evidence is thin',
      '- produce a competitorMatrix with vendor, ICP, core features, CRM integrations, pricing evidence, target segment, and confidence',
      '- recommendation must specify target segment, wedge, differentiation, and first go-to-market motion',
      '- risks-and-unknowns must include unresolved evidence gaps',
      '- every finding object must include status, verificationNotes, and gaps; use an empty gaps array only when there are no explicit gaps',
      `Gated scored sources:\n${sourceSummary || 'No qualifying web sources available.'}`,
      `Draft findings:\n${draftFindingsSummary || 'No draft findings available.'}`,
      `Draft sections:\n${draftSectionsSummary || 'No draft sections available.'}`,
    ].join('\n\n'),
  });

  const findings: ResearchFinding[] = verified.findings
    .map((finding) => {
      const evidence = sanitizeEvidence(finding.evidence, citationIndex);
      const assessment = getEvidenceRuleAssessment(evidence, sourceIndex);
      const failsEvidenceRule = !assessment.passes;

      return {
        sectionKey: finding.sectionKey,
        claim: finding.claim,
        evidence,
        confidence: failsEvidenceRule ? 'low' : finding.confidence,
        status: failsEvidenceRule ? 'needs-review' : finding.status,
        verificationNotes: failsEvidenceRule
          ? [finding.verificationNotes, 'Evidence rule failed: requires one strong primary/research source or two independent medium-quality sources.']
              .filter(Boolean)
              .join(' ')
          : finding.verificationNotes,
        gaps: failsEvidenceRule
          ? [
              ...finding.gaps,
              'Add one strong official/research source or two independent medium-quality sources to verify this claim.',
            ]
          : finding.gaps,
      };
    })
    .filter((finding) => finding.evidence.length > 0);

  const reportSections = toReportSections(verified.sections).map((section) => ({
    ...section,
    citations: section.citations.filter((citationId) => citationIndex.has(citationId)),
  }));

  const finalReportMarkdown = buildFinalMarkdown(
    verified.executiveSummary,
    verified.keyTakeaways,
    reportSections,
    verified.competitorMatrix,
    citationIndex,
  );

  await replaceResearchFindings(state.runId, findings);
  await replaceResearchReportSections(state.runId, reportSections);
  await appendResearchEvent(state.runId, 'verification', 'stage_completed', 'Verification completed and final report strengthened.', {
    verifiedFindingCount: findings.length,
    sectionCount: reportSections.length,
    gatedSourceCount: gatedSources.length,
  });
  console.info(`[research:${state.runId}] stage_complete`, {
    stage: 'verification',
    verifiedFindingCount: findings.length,
    sectionCount: reportSections.length,
    gatedSourceCount: gatedSources.length,
  });

  return {
    status: 'verifying' as const,
    currentStage: 'verification',
    findings,
    reportSections,
    finalReportMarkdown,
  };
}

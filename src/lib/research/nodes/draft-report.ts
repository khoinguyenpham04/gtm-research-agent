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
  draftReportSchema,
  type Citation,
  type DraftReport,
  type DraftReportSection,
  type ResearchFinding,
  type ResearchGraphState,
} from '@/lib/research/schemas';
import {
  coerceSearchIntent,
  coerceSourceCategory,
  coerceSourceQualityLabel,
  coerceSourceRecency,
  gateSourcesForSynthesis,
  sortSourcesByQuality,
} from '@/lib/research/source-scoring';

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

function sanitizeFindings(findings: ResearchFinding[], citations: Map<string, Citation>) {
  return findings
    .map((finding) => ({
      ...finding,
      evidence: finding.evidence.filter((citation) => citations.has(citation.sourceId)),
      status: finding.status ?? 'draft',
      verificationNotes: finding.verificationNotes ?? '',
      gaps: finding.gaps ?? [],
    }))
    .filter((finding) => finding.evidence.length > 0);
}

function sanitizeSections(sections: DraftReportSection[], citations: Map<string, Citation>) {
  return sections.map((section) => ({
    ...section,
    citations: section.citations.filter((citationId) => citations.has(citationId)),
  }));
}

function buildFinalMarkdown(executiveSummary: string, sections: DraftReportSection[], citations: Map<string, Citation>) {
  const lines = ['# GTM Research Brief', '', '## Executive Summary', executiveSummary.trim()];

  for (const section of sections) {
    lines.push('', `## ${section.title}`, section.contentMarkdown.trim());

    if (section.citations.length > 0) {
      lines.push('', '### Evidence');
      for (const citationId of section.citations) {
        const citation = citations.get(citationId);
        if (!citation) {
          continue;
        }

        lines.push(
          citation.url ? `- [${citation.title}](${citation.url})` : `- ${citation.title}`,
        );
      }
    }
  }

  return lines.join('\n');
}

export async function runDraftReportNode(state: ResearchGraphState) {
  console.info(`[research:${state.runId}] stage_start`, { stage: 'draft_report' });

  if (!state.plan) {
    throw new Error('Cannot draft report without a research plan.');
  }

  if (await hasStageCompleted(state.runId, 'draft_report')) {
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

  await setRunStage(state.runId, 'drafting', 'draft_report');
  await appendResearchEvent(state.runId, 'draft_report', 'stage_started', 'Drafting findings and report.');

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
        domain: typeof source.metadataJson.domain === 'string' ? source.metadataJson.domain : null,
        qualityScore: typeof source.metadataJson.qualityScore === 'number' ? source.metadataJson.qualityScore : 0,
        qualityLabel: coerceSourceQualityLabel(source.metadataJson.qualityLabel),
        sourceCategory: coerceSourceCategory(source.metadataJson.sourceCategory),
        recency: coerceSourceRecency(source.metadataJson.recency),
        publishedYear:
          typeof source.metadataJson.publishedYear === 'number' ? source.metadataJson.publishedYear : null,
        rationale:
          typeof source.metadataJson.rationale === 'string' ? source.metadataJson.rationale : 'Unscored source.',
        isPrimary: Boolean(source.metadataJson.isPrimary),
      })),
  );
  const gatedSources = gateSourcesForSynthesis(rankedSources);
  const citationIndex = buildCitationIndex(
    persistedSources.filter((source) => gatedSources.some((candidate) => candidate.id === source.id)),
  );

  const sourceSummary = gatedSources
    .slice(0, 12)
    .map((source) => {
      return [
        `Source ID: ${source.id}`,
        `Type: ${source.sourceType}`,
        `Title: ${source.title}`,
        `URL: ${source.url ?? 'n/a'}`,
        `Quality: ${source.qualityLabel} (${source.qualityScore})`,
        `Category: ${source.sourceCategory}`,
        `Intent: ${source.queryIntent}`,
        `Recency: ${source.recency}${source.publishedYear ? ` (${source.publishedYear})` : ''}`,
        `Snippet: ${source.snippet ?? 'n/a'}`,
        `Query: ${source.query}`,
      ].join('\n');
    })
    .join('\n\n---\n\n');

  const documentContext = state.documentContext
    .map((document) => `${document.fileName ?? document.documentExternalId}: ${document.summary}`)
    .join('\n');

  const draft = await generateStructuredOutput<DraftReport>({
    schema: draftReportSchema,
    system:
      'You are a GTM research analyst. Produce a preliminary synthesis with evidence-backed findings. Prefer higher-quality official and research sources over vendor or blog sources.',
    prompt: [
      `Topic: ${state.topic}`,
      `Objective: ${state.objective ?? 'Not provided.'}`,
      `Research questions:\n- ${state.plan.researchQuestions.join('\n- ')}`,
      `Planned sections:\n- ${state.plan.sections.map((section) => `${section.key}: ${section.title} (${section.description})`).join('\n- ')}`,
      `Planned search intents:\n- ${state.plan.searchQueries.map((query) => `${query.intent}: ${query.query}`).join('\n- ')}`,
      `Linked document context:\n${documentContext || 'No linked documents.'}`,
      `Gated evidence for synthesis:\n${sourceSummary || 'No qualifying external sources were found.'}`,
      'For every section object, always include a citations array. Use an empty array when a section has no supporting citations.',
      'For every finding object, always include status, verificationNotes, and gaps. Use status "draft", an empty string for verificationNotes when needed, and an empty array for gaps when there are none.',
      'Use official and research sources first for factual claims. Vendor and blog sources should only support competitor or pricing context when stronger evidence is unavailable.',
      'Return a preliminary report with evidence-backed findings. If evidence is thin, say so, lower confidence, and include explicit gaps.',
    ].join('\n\n'),
  });

  const findings = sanitizeFindings(draft.findings, citationIndex);
  const sections = sanitizeSections(draft.sections, citationIndex);
  const finalReportMarkdown = buildFinalMarkdown(draft.executiveSummary, sections, citationIndex);

  await replaceResearchFindings(state.runId, findings);
  await replaceResearchReportSections(state.runId, sections);
  await appendResearchEvent(state.runId, 'draft_report', 'stage_completed', 'Draft report saved.', {
    findingCount: findings.length,
    sectionCount: sections.length,
    gatedSourceCount: gatedSources.length,
  });
  console.info(`[research:${state.runId}] stage_complete`, {
    stage: 'draft_report',
    findingCount: findings.length,
    sectionCount: sections.length,
    gatedSourceCount: gatedSources.length,
  });

  return {
    status: 'drafting' as const,
    currentStage: 'draft_report',
    findings,
    reportSections: sections,
    finalReportMarkdown,
  };
}

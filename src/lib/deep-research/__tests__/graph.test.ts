import assert from "node:assert/strict";
import test from "node:test";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";

import {
  buildDocumentAnchoredFacts,
  buildSectionEvidencePacksFromArtifacts,
  buildWebAnchoredFacts,
  createDeepResearchGraphs,
  normalizeGapFillQueries,
  recomputeCoverageBoard,
  selectGapFillCategories,
} from "@/lib/deep-research/graph";
import { getSourceTierRank } from "@/lib/deep-research/source-tier";
import type {
  DeepResearchModelFactory,
  DeepResearchModelRole,
} from "@/lib/deep-research/openai-model-factory";
import type {
  AnchoredFact,
  DeepResearchBudgets,
  DeepResearchModelConfig,
  EvidenceRow,
  ReportPlan,
  SectionEvidenceLink,
  SectionSupport,
} from "@/lib/deep-research/types";

class FakeModelFactory implements DeepResearchModelFactory {
  readonly structuredCalls: Array<{
    role: DeepResearchModelRole;
    messages: unknown[];
  }> = [];

  readonly textCalls: Array<{
    role: DeepResearchModelRole;
    messages: unknown[];
  }> = [];

  readonly toolCalls: Array<{
    role: DeepResearchModelRole;
    messages: unknown[];
  }> = [];

  constructor(
    private readonly structuredOutputs: unknown[],
    private readonly toolOutputs: AIMessage[],
    private readonly textOutputs: AIMessage[],
  ) {}

  async invokeStructured<T>(
    role: DeepResearchModelRole,
    schema: unknown,
    messages: unknown[],
  ) {
    this.structuredCalls.push({ role, messages });
    void schema;
    const next = this.structuredOutputs.shift();
    assert.ok(next, "Expected a queued structured response.");
    if (next instanceof Error) {
      throw next;
    }
    return next as T;
  }

  async invokeWithTools(
    role: DeepResearchModelRole,
    tools: unknown[],
    messages: unknown[],
  ) {
    this.toolCalls.push({ role, messages });
    void tools;
    const next = this.toolOutputs.shift();
    assert.ok(next, "Expected a queued tool-call response.");
    return next;
  }

  async invokeText(role: DeepResearchModelRole, messages: unknown[]) {
    this.textCalls.push({ role, messages });
    const next = this.textOutputs.shift();
    assert.ok(next, "Expected a queued text response.");
    return next;
  }
}

const modelConfig: DeepResearchModelConfig = {
  summarizationModel: "gpt-4.1-mini",
  summarizationModelMaxTokens: 2048,
  researchModel: "gpt-4.1",
  researchModelMaxTokens: 4096,
  compressionModel: "gpt-4.1",
  compressionModelMaxTokens: 4096,
  finalReportModel: "gpt-4.1",
  finalReportModelMaxTokens: 4096,
  maxStructuredOutputRetries: 2,
  maxContentLength: 20000,
};

const budgets: DeepResearchBudgets = {
  maxConcurrentResearchUnits: 2,
  maxResearcherIterations: 3,
  maxReactToolCalls: 4,
  maxTargetedWebGapFillAttemptsPerCategory: 1,
  maxTargetedWebGapFillAttemptsPerRun: 3,
};

function buildCompleteRunStructuredOutputs(overrides?: {
  reportPlan?: {
    mode: "gtm" | "general" | "other";
    sections: Array<{ key: string; title: string; objective: string }>;
  };
  sectionSupport?: Array<{
    key: string;
    support: "strong" | "weak" | "missing";
    reason?: string;
    evidenceCount?: number;
    topSourceTier?:
      | "selected_document"
      | "primary"
      | "analyst"
      | "trade_press"
      | "vendor"
      | "blog"
      | "unknown";
  }>;
  validationSectionSupport?: Array<{
    key: string;
    support: "strong" | "weak" | "missing";
    reason?: string;
    evidenceCount?: number;
    topSourceTier?:
      | "selected_document"
      | "primary"
      | "analyst"
      | "trade_press"
      | "vendor"
      | "blog"
      | "unknown";
  }>;
  allowedEvidenceRowIds?: string[];
}) {
  const reportPlan = overrides?.reportPlan ?? {
    mode: "gtm" as const,
    sections: [
      {
        key: "executive_summary",
        title: "Executive Summary",
        objective: "Summarize the most important commercial conclusion.",
      },
      {
        key: "market_opportunity",
        title: "Market Opportunity",
        objective: "Assess the market opportunity and demand signals.",
      },
      {
        key: "competitors",
        title: "Competitors",
        objective: "Compare the most relevant competitors.",
      },
    ],
  };

  return [
    {
      needClarification: false,
      question: "",
      verification: "Starting research.",
    },
    {
      researchBrief: "Analyse the uploaded documents and produce a report.",
    },
    {
      mode: reportPlan.mode,
      coreQuestions:
        reportPlan.mode === "gtm"
          ? [
              "What sourced market size inputs exist?",
              "What adoption evidence is present in the uploaded documents?",
              "Which buyer segments appear most relevant?",
              "What competitor or pricing evidence is available?",
              "Which compliance constraints matter?",
            ]
          : [
              "What is the direct answer to the question?",
              "Which uploaded-document findings matter most?",
              "What evidence gaps remain?",
            ],
      requiredEvidenceCategories:
        reportPlan.mode === "gtm"
          ? [
              "market size inputs",
              "adoption evidence",
              "buyer segment evidence",
              "competitor and pricing evidence",
              "compliance constraints",
            ]
          : [
              "uploaded-document evidence",
              "supporting validation evidence",
              "evidence gaps",
            ],
      gtmSubquestions:
        reportPlan.mode === "gtm"
          ? [
              "What sourced market size inputs exist for TAM, SAM, or SOM?",
              "What adoption evidence shows whether the segment is ready?",
              "What buyer segments appear most relevant?",
              "What competitor or pricing evidence is available?",
              "Which compliance constraints materially affect GTM?",
            ]
          : [],
      documentResearchPriorities: [
        "Use selected uploaded documents first for direct evidence.",
      ],
    },
    {
      ...reportPlan,
      fallbackRule: 'Write "insufficient evidence" when evidence is missing.',
      plannerType: "adaptive",
      reportPlanVersion: 1,
    },
    ...(reportPlan.mode === "gtm"
      ? [
          {
            queries: [
              {
                query: "market size inputs for the target segment",
                intendedCategories: ["market_size_inputs"],
              },
              {
                query: "competitors pricing for the target segment",
                intendedCategories: ["competitors_pricing"],
              },
              {
                query: "compliance requirements for the target segment",
                intendedCategories: ["compliance"],
              },
            ],
          },
        ]
      : []),
    {
      sectionSupport:
        overrides?.sectionSupport ??
        reportPlan.sections.map((section) => ({
          key: section.key,
          support: "strong" as const,
          reason: "Clear evidence coverage.",
          evidenceCount: 2,
          topSourceTier: "selected_document" as const,
        })),
    },
    {
      rows: [
        {
          claim: "The selected document supports the target market demand.",
          claimType: "market_stat" as const,
          value: "Demand is increasing",
          sourceType: "uploaded_document" as const,
          sourceTier: "selected_document" as const,
          sourceTitle: "Selected report",
          sourceUrl: "https://example.com/report",
          documentId: "doc-1",
          chunkIndex: 0,
          confidence: "high" as const,
          metadata: {},
        },
      ],
    },
    {
      allowedEvidenceRowIds: overrides?.allowedEvidenceRowIds ?? [],
      sectionSupport:
        overrides?.validationSectionSupport ??
        reportPlan.sections.map((section) => ({
          key: section.key,
          support: "missing" as const,
          reason: "Validation found that the available evidence is insufficient.",
          evidenceCount: 0,
          topSourceTier: "selected_document" as const,
        })),
      sectionEvidenceLinks: [],
    },
  ];
}

function buildToolOutputs() {
  return [
    new AIMessage({
      content: "",
      tool_calls: [
        {
          id: "supervisor-call-1",
          name: "ConductResearch",
          args: {
            researchTopic: "Review the uploaded GTM documents for market signals.",
          },
          type: "tool_call",
        },
      ],
    }),
    new AIMessage({
      content: "",
      tool_calls: [
        {
          id: "researcher-call-1",
          name: "thinkTool",
          args: {
            reflection: "The uploaded documents appear sufficient for an MVP answer.",
          },
          type: "tool_call",
        },
      ],
    }),
    new AIMessage({
      content: "",
      tool_calls: [
        {
          id: "researcher-call-2",
          name: "ResearchComplete",
          args: {},
          type: "tool_call",
        },
      ],
    }),
    new AIMessage({
      content: "",
      tool_calls: [
        {
          id: "researcher-call-3",
          name: "ResearchComplete",
          args: {},
          type: "tool_call",
        },
      ],
    }),
    new AIMessage({
      content: "",
      tool_calls: [
        {
          id: "supervisor-call-3",
          name: "ResearchComplete",
          args: {},
          type: "tool_call",
        },
      ],
    }),
  ];
}

test("section evidence packs prefer uploaded documents and keep gaps explicit", () => {
  const reportPlan: ReportPlan = {
    mode: "gtm",
    sections: [
      {
        key: "market_opportunity",
        title: "Market Opportunity",
        objective: "Assess the market opportunity.",
      },
      {
        key: "competition_and_pricing",
        title: "Competition and Pricing",
        objective: "Compare relevant competitors.",
      },
      {
        key: "compliance_constraints",
        title: "Compliance Constraints",
        objective: "Describe relevant constraints.",
      },
    ],
    fallbackRule: 'Write "insufficient evidence" when evidence is missing.',
    plannerType: "adaptive",
    reportPlanVersion: 1,
  };
  const sectionSupport: SectionSupport[] = [
    {
      key: "market_opportunity",
      support: "strong",
      reason: "Multiple validated rows support the market section.",
      evidenceCount: 3,
      topSourceTier: "selected_document",
    },
    {
      key: "competition_and_pricing",
      support: "weak",
      reason: "Only partial competitor evidence is available.",
      evidenceCount: 1,
      topSourceTier: "vendor",
    },
    {
      key: "compliance_constraints",
      support: "missing",
      reason: "No validated compliance evidence was linked.",
      evidenceCount: 0,
      topSourceTier: "unknown",
    },
  ];
  const evidenceRows: EvidenceRow[] = [
    {
      id: "vendor-row",
      claim: "A vendor pricing page lists a starting plan.",
      claimType: "pricing_signal",
      value: "GBP 25 per seat",
      unit: "monthly",
      sourceType: "web",
      sourceTier: "vendor",
      sourceTitle: "Vendor pricing",
      sourceUrl: "https://example.com/vendor",
      confidence: "medium",
      allowedForFinal: true,
      metadata: {},
    },
    {
      id: "document-row",
      claim: "The uploaded sales report shows growing demand for AI sales tools.",
      claimType: "market_stat",
      value: "Demand is rising",
      sourceType: "uploaded_document",
      sourceTier: "selected_document",
      sourceTitle: "Selected report",
      sourceUrl: "https://example.com/report",
      documentId: "doc-1",
      chunkIndex: 3,
      confidence: "high",
      allowedForFinal: true,
      metadata: {},
    },
    {
      id: "primary-row",
      claim: "An official source reports growth in UK SMB digital adoption.",
      claimType: "market_stat",
      value: "Growth continued in 2025",
      timeframe: "2025",
      sourceType: "web",
      sourceTier: "primary",
      sourceTitle: "Official source",
      sourceUrl: "https://example.com/official",
      confidence: "high",
      allowedForFinal: true,
      metadata: {},
    },
  ];
  const sectionEvidenceLinks: SectionEvidenceLink[] = [
    {
      sectionKey: "market_opportunity",
      evidenceRowId: "vendor-row",
      role: "supporting",
    },
    {
      sectionKey: "market_opportunity",
      evidenceRowId: "document-row",
      role: "primary",
    },
    {
      sectionKey: "market_opportunity",
      evidenceRowId: "primary-row",
      role: "supporting",
    },
    {
      sectionKey: "competition_and_pricing",
      evidenceRowId: "vendor-row",
      role: "primary",
    },
  ];

  const packs = buildSectionEvidencePacksFromArtifacts(
    reportPlan,
    sectionSupport,
    evidenceRows,
    sectionEvidenceLinks,
  );

  assert.equal(getSourceTierRank("selected_document"), 0);
  assert.equal(getSourceTierRank("vendor"), 4);
  assert.deepEqual(
    packs[0].facts.map((fact) => fact.evidenceRowIds[0]),
    ["document-row", "primary-row", "vendor-row"],
  );
  assert.equal(packs[0].facts[0].sourceType, "uploaded_document");
  assert.equal(packs[0].facts[0].factOrigin, "validated_evidence");
  assert.match(packs[0].facts[1].statement, /2025/);
  assert.equal(packs[1].support, "weak");
  assert.ok(packs[1].facts.length > 0);
  assert.ok(packs[1].gaps.length > 0);
  assert.equal(packs[2].support, "missing");
  assert.equal(packs[2].facts.length, 0);
  assert.ok(packs[2].gaps.length > 0);
});

test("deterministic anchored facts drive GTM coverage and bounded gap fill", () => {
  const documentFacts = buildDocumentAnchoredFacts(
    ["UK SMB AI meeting assistant adoption evidence"],
    [
      {
        id: 1,
        excerpt:
          "UK SMB sales teams are increasing their use of AI assistants for call notes and follow-up workflows in 2025.",
        similarity: 0.52,
        documentId: "doc-1",
        chunkIndex: 0,
        fileName: "salesforce-state-of-sales-report-2026.pdf",
        fileUrl: "https://example.com/doc-1.pdf",
      },
    ],
  );
  const webFacts = buildWebAnchoredFacts(
    ["UK GDPR meeting recording transcription AI compliance"],
    [
      {
        title: "UK GDPR guidance for AI systems",
        url: "https://ico.org.uk/guidance",
        excerpt:
          "ICO guidance highlights transparency, lawful basis, and data minimisation for AI systems processing personal data.",
        sourceTier: "primary",
      },
    ],
  );

  const coverage = recomputeCoverageBoard(
    [...documentFacts, ...webFacts],
    {
      totalAttempts: 0,
      attemptsByCategory: {
        market_size_inputs: 0,
        adoption: 0,
        buyers: 0,
        competitors_pricing: 0,
        compliance: 0,
        recommendations: 0,
      },
    },
    budgets,
  );

  const adoption = coverage.find((entry) => entry.key === "adoption");
  const compliance = coverage.find((entry) => entry.key === "compliance");
  const marketSize = coverage.find((entry) => entry.key === "market_size_inputs");

  assert.ok(documentFacts.length > 0);
  assert.ok(webFacts.length > 0);
  assert.ok(documentFacts[0]?.targetCategoryKeys.includes("adoption"));
  assert.ok(documentFacts[0]?.evidenceCategoryKeys.includes("adoption"));
  assert.ok(documentFacts[0]?.evidenceCategoryKeys.includes("buyers"));
  assert.equal(adoption?.status, "anchored");
  assert.equal(compliance?.status, "anchored");
  assert.equal(marketSize?.status, "missing");

  const gapFillCategories = selectGapFillCategories(
    coverage,
    {
      totalAttempts: 0,
      attemptsByCategory: {
        market_size_inputs: 0,
        adoption: 0,
        buyers: 0,
        competitors_pricing: 0,
        compliance: 0,
        recommendations: 0,
      },
    },
    budgets,
  );

  assert.deepEqual(gapFillCategories, [
    "market_size_inputs",
    "competitors_pricing",
  ]);
});

test("weak text similarity stays in target categories and does not become evidence coverage", () => {
  const weakSimilarityFacts = buildWebAnchoredFacts(
    ["UK GDPR compliance for AI meeting assistants"],
    [
      {
        title: "AI adoption trends for UK SMBs",
        url: "https://example.com/adoption",
        excerpt:
          "UK SMB teams are increasing their use of AI assistants for note taking and meeting follow-up.",
        sourceTier: "trade_press",
      },
    ],
  );

  assert.ok(weakSimilarityFacts.length > 0);
  assert.ok(weakSimilarityFacts[0]?.targetCategoryKeys.includes("compliance"));
  assert.ok(!weakSimilarityFacts[0]?.evidenceCategoryKeys.includes("compliance"));
  assert.ok(weakSimilarityFacts[0]?.evidenceCategoryKeys.includes("adoption"));

  const coverage = recomputeCoverageBoard(
    weakSimilarityFacts,
    {
      totalAttempts: 0,
      attemptsByCategory: {
        market_size_inputs: 0,
        adoption: 0,
        buyers: 0,
        competitors_pricing: 0,
        compliance: 0,
        recommendations: 0,
      },
    },
    budgets,
  );

  assert.equal(
    coverage.find((entry) => entry.key === "compliance")?.status,
    "missing",
  );
});

test("anchored facts can prevent empty GTM section packs when validated evidence is sparse", () => {
  const reportPlan: ReportPlan = {
    mode: "gtm",
    sections: [
      {
        key: "executive_summary",
        title: "Executive Summary",
        objective: "Summarize the GTM opportunity.",
      },
      {
        key: "competition_and_pricing",
        title: "Competition and Pricing",
        objective: "Describe the competition and pricing signals.",
      },
      {
        key: "compliance_constraints",
        title: "Compliance Constraints",
        objective: "Describe the compliance constraints.",
      },
    ],
    fallbackRule: 'Write "insufficient evidence" when evidence is missing.',
    plannerType: "adaptive",
    reportPlanVersion: 1,
  };

  const anchoredFacts: AnchoredFact[] = [
    {
      id: "doc:doc-1:0",
      statement: "The uploaded analyst report indicates that UK SMB sales teams are adopting AI note-taking tools.",
      claimType: "market_stat",
      sourceType: "uploaded_document",
      sourceTier: "selected_document",
      sourceTitle: "salesforce-state-of-sales-report-2026.pdf",
      sourceUrl: "https://example.com/doc-1.pdf",
      documentId: "doc-1",
      chunkIndex: 0,
      targetCategoryKeys: ["adoption", "buyers"],
      evidenceCategoryKeys: ["adoption", "buyers"],
      strength: "strong",
    },
    {
      id: "web:https://example.com/pricing",
      statement: "Fireflies.ai pricing pages list paid plans for collaborative note-taking and transcription.",
      claimType: "pricing_signal",
      sourceType: "web",
      sourceTier: "vendor",
      sourceTitle: "Fireflies pricing",
      sourceUrl: "https://example.com/pricing",
      targetCategoryKeys: ["competitors_pricing"],
      evidenceCategoryKeys: ["competitors_pricing"],
      strength: "moderate",
    },
    {
      id: "web:https://ico.org.uk/guidance",
      statement: "ICO guidance highlights transparency and lawful basis requirements for AI systems processing meeting data.",
      claimType: "compliance",
      sourceType: "web",
      sourceTier: "primary",
      sourceTitle: "ICO guidance",
      sourceUrl: "https://ico.org.uk/guidance",
      targetCategoryKeys: ["compliance"],
      evidenceCategoryKeys: ["compliance"],
      strength: "strong",
    },
  ];

  const coverageBoard = recomputeCoverageBoard(
    anchoredFacts,
    {
      totalAttempts: 1,
      attemptsByCategory: {
        market_size_inputs: 1,
        adoption: 0,
        buyers: 0,
        competitors_pricing: 0,
        compliance: 0,
        recommendations: 0,
      },
    },
    budgets,
  );

  const packs = buildSectionEvidencePacksFromArtifacts(
    reportPlan,
    [
      {
        key: "executive_summary",
        support: "weak",
        reason: "Validated evidence is sparse.",
      },
      {
        key: "competition_and_pricing",
        support: "missing",
        reason: "No validated competitor evidence was linked.",
      },
      {
        key: "compliance_constraints",
        support: "missing",
        reason: "No validated compliance evidence was linked.",
      },
    ],
    [],
    [],
    {
      anchoredFacts,
      coverageBoard,
    },
  );

  assert.ok(packs[0].facts.length > 0);
  assert.ok(
    packs[1].facts.some((fact) => fact.factOrigin === "anchored_fact"),
  );
  assert.ok(
    packs[2].facts.some((fact) => fact.sourceTitle === "ICO guidance"),
  );
});

test("deep research graph pauses for clarification", async () => {
  const fakeModels = new FakeModelFactory(
    [
      {
        needClarification: true,
        question: "Which geography should the research prioritize?",
        verification: "",
      },
    ],
    [],
    [],
  );

  const { deepResearchGraph } = createDeepResearchGraphs({
    models: fakeModels,
    parentCheckpointer: new MemorySaver(),
    openAiApiKey: "test-key",
  });

  await deepResearchGraph.invoke(
    {
      runId: "run-clarify",
      topic: "Research the market opportunity",
      selectedDocumentIds: ["doc-1"],
      modelConfig,
      budgets,
      messages: [new HumanMessage({ content: "Research the market opportunity" })],
    },
    {
      configurable: {
        thread_id: "run-clarify",
      },
    },
  );

  const snapshot = await deepResearchGraph.getState({
    configurable: {
      thread_id: "run-clarify",
    },
  });

  const interruptQuestion = snapshot.tasks
    .flatMap((task) => task.interrupts)
    .map((interrupt) => interrupt.value as { question?: string } | undefined)
    .find(Boolean)?.question;

  assert.equal(
    interruptQuestion,
    "Which geography should the research prioritize?",
  );
});

test("deep research graph delegates to a researcher and returns a report", async () => {
  const fakeModels = new FakeModelFactory(
    buildCompleteRunStructuredOutputs({
      reportPlan: {
        mode: "gtm",
        sections: [
          {
            key: "executive_summary",
            title: "Executive Summary",
            objective: "Summarize the commercial conclusion.",
          },
          {
            key: "market_opportunity",
            title: "Market Opportunity",
            objective: "Assess the market opportunity.",
          },
          {
            key: "competitors",
            title: "Competitors",
            objective: "Compare the most relevant competitors.",
          },
        ],
      },
      validationSectionSupport: [
        {
          key: "executive_summary",
          support: "strong",
          reason: "Multiple document-backed findings support the conclusion.",
          evidenceCount: 3,
          topSourceTier: "selected_document",
        },
        {
          key: "market_opportunity",
          support: "strong",
          reason: "The uploaded report contains directly relevant demand evidence.",
          evidenceCount: 2,
          topSourceTier: "selected_document",
        },
        {
          key: "competitors",
          support: "weak",
          reason: "Competitive evidence is partial and should be written cautiously.",
          evidenceCount: 1,
          topSourceTier: "vendor",
        },
      ],
    }),
    buildToolOutputs(),
    [
      new AIMessage({
        content:
          "Compressed findings with [Selected report](https://example.com/report).",
      }),
      new AIMessage({
        content:
          "# Final report\n\nEvidence-backed recommendation.\n\n## Sources\n- [Selected report](https://example.com/report)",
      }),
    ],
  );

  const { deepResearchGraph } = createDeepResearchGraphs({
    models: fakeModels,
    parentCheckpointer: new MemorySaver(),
    openAiApiKey: "test-key",
  });

  const result = await deepResearchGraph.invoke(
    {
      runId: "run-complete",
      topic: "Produce a GTM research synthesis",
      selectedDocumentIds: ["doc-1"],
      modelConfig,
      budgets,
      messages: [new HumanMessage({ content: "Produce a GTM research synthesis" })],
    },
    {
      configurable: {
        thread_id: "run-complete",
      },
    },
  );

  assert.match(
    String(result.finalReportMarkdown),
    /Final report/,
  );

  const finalPrompt = String(
    (
      fakeModels.textCalls.at(-1)?.messages[0] as {
        content?: string;
      }
    )?.content ?? "",
  );
  assert.match(finalPrompt, /"mode": "gtm"/);
  assert.match(finalPrompt, /"key": "competitors"/);
  assert.match(finalPrompt, /<SectionEvidencePacks>/);
  assert.match(finalPrompt, /deduplicated set of sources/i);
  assert.doesNotMatch(finalPrompt, /<Messages>/);
  assert.doesNotMatch(finalPrompt, /<ValidatedEvidenceRows>/);
  assert.doesNotMatch(finalPrompt, /<SectionEvidenceLinks>/);
  assert.doesNotMatch(finalPrompt, /<SectionSupport>/);

  const supervisorPrompt = String(
    (
      fakeModels.toolCalls[0]?.messages[1] as {
        content?: string;
      }
    )?.content ?? "",
  );
  assert.match(supervisorPrompt, /Core Questions:/);
  assert.match(supervisorPrompt, /market size inputs/i);
  assert.match(supervisorPrompt, /competitor or pricing evidence/i);

  const researcherPrompt = String(
    (
      fakeModels.toolCalls[1]?.messages[1] as {
        content?: string;
      }
    )?.content ?? "",
  );
  assert.match(researcherPrompt, /Focused research task:/);
  assert.match(researcherPrompt, /selectedDocumentsSearch/i);
  assert.match(researcherPrompt, /uploaded documents first/i);
});

test("general research runs do not force GTM-only sections into the final prompt", async () => {
  const fakeModels = new FakeModelFactory(
    buildCompleteRunStructuredOutputs({
      reportPlan: {
        mode: "general",
        sections: [
          {
            key: "summary",
            title: "Summary",
            objective: "Summarize the main answer.",
          },
          {
            key: "key_findings",
            title: "Key Findings",
            objective: "Describe the most important findings.",
          },
          {
            key: "recommendations",
            title: "Recommendations",
            objective: "Recommend next steps based on the evidence.",
          },
        ],
      },
      validationSectionSupport: [
        {
          key: "summary",
          support: "strong",
          reason: "The findings directly answer the question.",
          evidenceCount: 2,
          topSourceTier: "selected_document",
        },
        {
          key: "key_findings",
          support: "strong",
          reason: "The findings are directly supported by the uploaded sources.",
          evidenceCount: 2,
          topSourceTier: "selected_document",
        },
        {
          key: "recommendations",
          support: "weak",
          reason: "Recommendations require cautious interpretation.",
          evidenceCount: 1,
          topSourceTier: "selected_document",
        },
      ],
    }),
    buildToolOutputs(),
    [
      new AIMessage({
        content:
          "Compressed findings with [Selected report](https://example.com/report).",
      }),
      new AIMessage({
        content:
          "# Final report\n\n## Summary\nEvidence-backed answer.\n\n## Sources\n- [Selected report](https://example.com/report)",
      }),
    ],
  );

  const { deepResearchGraph } = createDeepResearchGraphs({
    models: fakeModels,
    parentCheckpointer: new MemorySaver(),
    openAiApiKey: "test-key",
  });

  await deepResearchGraph.invoke(
    {
      runId: "run-general",
      topic: "Summarize the uploaded policy documents",
      selectedDocumentIds: ["doc-1"],
      modelConfig,
      budgets,
      messages: [new HumanMessage({ content: "Summarize the uploaded policy documents" })],
    },
    {
      configurable: {
        thread_id: "run-general",
      },
    },
  );

  const finalPrompt = String(
    (
      fakeModels.textCalls.at(-1)?.messages[0] as {
        content?: string;
      }
    )?.content ?? "",
  );

  assert.match(finalPrompt, /"mode": "general"/);
  assert.doesNotMatch(finalPrompt, /"key": "tam_sam_som"|"key": "90_day_plan"|"key": "icp"/i);
  assert.match(finalPrompt, /<SectionEvidencePacks>/);
  assert.doesNotMatch(finalPrompt, /<Messages>/);
});

test('missing evidence leads the final writer prompt to require "insufficient evidence"', async () => {
  const fakeModels = new FakeModelFactory(
    buildCompleteRunStructuredOutputs({
      reportPlan: {
        mode: "general",
        sections: [
          {
            key: "summary",
            title: "Summary",
            objective: "Summarize the answer.",
          },
          {
            key: "evidence_gaps",
            title: "Evidence Gaps",
            objective: "Describe missing evidence.",
          },
        ],
      },
      validationSectionSupport: [
        {
          key: "summary",
          support: "missing",
          reason: "The uploaded documents do not support a full answer.",
          evidenceCount: 0,
          topSourceTier: "unknown",
        },
        {
          key: "evidence_gaps",
          support: "strong",
          reason: "The absence of evidence is itself well established.",
          evidenceCount: 1,
          topSourceTier: "selected_document",
        },
      ],
    }),
    buildToolOutputs(),
    [
      new AIMessage({
        content:
          "Compressed findings with [Selected report](https://example.com/report).",
      }),
      new AIMessage({
        content:
          '# Final report\n\n## Summary\ninsufficient evidence\n\n## Evidence Gaps\nThe source set is incomplete.\n\n## Sources\n- [Selected report](https://example.com/report)',
      }),
    ],
  );

  const { deepResearchGraph } = createDeepResearchGraphs({
    models: fakeModels,
    parentCheckpointer: new MemorySaver(),
    openAiApiKey: "test-key",
  });

  const result = await deepResearchGraph.invoke(
    {
      runId: "run-missing",
      topic: "Assess an unsupported topic from the uploaded documents",
      selectedDocumentIds: ["doc-1"],
      modelConfig,
      budgets,
      messages: [
        new HumanMessage({
          content: "Assess an unsupported topic from the uploaded documents",
        }),
      ],
    },
    {
      configurable: {
        thread_id: "run-missing",
      },
    },
  );

  assert.match(String(result.finalReportMarkdown), /insufficient evidence/i);

  const finalPrompt = String(
    (
      fakeModels.textCalls.at(-1)?.messages[0] as {
        content?: string;
      }
    )?.content ?? "",
  );
  assert.match(finalPrompt, /"support": "missing"/);
  assert.match(finalPrompt, /"facts": \[\]/);
  assert.match(finalPrompt, /insufficient evidence/i);
});

function createEmptyGapFillStats() {
  return {
    totalAttempts: 0,
    attemptsByCategory: {
      market_size_inputs: 0,
      adoption: 0,
      buyers: 0,
      competitors_pricing: 0,
      compliance: 0,
      recommendations: 0,
    },
  };
}

function createGtmPreResearchPlan() {
  return {
    mode: "gtm" as const,
    coreQuestions: [
      "What market-size inputs exist?",
      "What adoption evidence exists?",
      "What buyer evidence exists?",
      "What competitor evidence exists?",
      "What compliance evidence exists?",
    ],
    requiredEvidenceCategories: [
      "market size inputs",
      "adoption evidence",
      "buyer evidence",
      "competitor evidence",
      "compliance evidence",
    ],
    gtmSubquestions: [
      "What sourced market-size inputs exist?",
      "What adoption evidence exists?",
      "What buyer evidence exists?",
      "What competitor or pricing evidence exists?",
      "What compliance evidence exists?",
    ],
    documentResearchPriorities: [
      "Use selected uploaded documents first for direct evidence.",
    ],
  };
}

test("normalizeGapFillQueries strips instruction noise and clamps long queries", () => {
  const longQuery = `Assess the Brazil go-to-market opportunity for an AI meeting assistant for SMB sales teams. Use uploaded documents first, then fill gaps with current web research. Reconcile conflicting statistics, prefer the most recent authoritative source, state assumptions explicitly, produce a cited executive brief plus a 90-day GTM plan, and identify compliance risks for AI meeting recording and transcription tooling.`;

  const result = normalizeGapFillQueries([
    longQuery,
    "   ",
    "Brazil AI meeting assistant market size",
    "brazil ai meeting assistant market size",
  ]);

  assert.equal(result.queries.length, 2);
  assert.ok(result.queries[0]);
  assert.ok(result.queries[0]!.length <= 350);
  assert.ok(!/use uploaded documents first/i.test(result.queries[0]!));
  assert.ok(!/fill gaps with current web research/i.test(result.queries[0]!));
  assert.ok(/Brazil/i.test(result.queries[0]!));
  assert.equal(
    result.skippedQueries.some((entry) => entry.reason === "empty_after_normalization"),
    true,
  );
  assert.equal(
    result.skippedQueries.some((entry) => entry.reason === "duplicate"),
    true,
  );
});

test("gtm researcher imperatively runs Tavily gap fill when the model returns no tool calls", async () => {
  const fakeModels = new FakeModelFactory(
    [
      {
        queries: [
          {
            query:
              "UK AI meeting assistant SMB sales teams market size and adoption",
            intendedCategories: ["market_size_inputs", "adoption"],
          },
          {
            query:
              "UK AI meeting assistant competitors pricing SMB sales teams",
            intendedCategories: ["competitors_pricing"],
          },
          {
            query: "UK AI meeting assistant GDPR recording transcription compliance",
            intendedCategories: ["compliance"],
          },
        ],
      },
    ],
    [
      new AIMessage({ content: "I need to think about this more." }),
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "researcher-complete-after-gap-fill",
            name: "ResearchComplete",
            args: {},
            type: "tool_call",
          },
        ],
      }),
    ],
    [
      new AIMessage({
        content:
          "Compressed findings with [UK SMB Statistics](https://example.com/market-size) and [ICO guidance](https://ico.org.uk/guidance).",
      }),
    ],
  );

  const events: Array<{
    stage: string;
    eventType: string;
    message: string;
    payload?: Record<string, unknown>;
  }> = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        results: [
          {
            title: "UK SMB Statistics",
            url: "https://example.com/market-size",
            content:
              "UK business population figures and employee bands for SMBs.",
          },
          {
            title: "Meeting Assistant Pricing",
            url: "https://example.com/pricing",
            content:
              "Competitor pricing tiers for AI meeting assistants used by sales teams.",
          },
          {
            title: "ICO Guidance",
            url: "https://ico.org.uk/guidance",
            content:
              "UK ICO guidance covers transparency, lawful basis, and data minimisation for AI systems processing meeting data.",
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );

  try {
    const { researcherSubgraph } = createDeepResearchGraphs({
      models: fakeModels,
      openAiApiKey: "test-key",
      tavilyApiKey: "test-tavily-key",
      logEvent: async (_runId, stage, eventType, message, payload) => {
        events.push({ stage, eventType, message, payload });
      },
    });

    const result = await researcherSubgraph.invoke({
      runId: "run-gap-fill-no-tools",
      selectedDocumentIds: ["doc-1"],
      modelConfig,
      budgets,
      researchTopic:
        "Assess the UK go-to-market opportunity for an AI meeting assistant for SMB sales teams.",
      preResearchPlan: createGtmPreResearchPlan(),
      reportPlan: {
        mode: "gtm",
        sections: [
          {
            key: "executive_summary",
            title: "Executive Summary",
            objective: "Summarize the commercial conclusion.",
          },
        ],
        fallbackRule: 'Write "insufficient evidence" when evidence is missing.',
        plannerType: "adaptive",
        reportPlanVersion: 1,
      },
      coverageBoard: [],
      anchoredFacts: [],
      researcherMessages: [
        new HumanMessage({
          content:
            "Focused research task:\nAssess the UK go-to-market opportunity for an AI meeting assistant for SMB sales teams.",
        }),
      ],
      toolCallIterations: 0,
      gapFillStats: createEmptyGapFillStats(),
      pendingGapFillCategories: [],
    });

    assert.match(String(result.compressedResearch), /Compressed findings/i);
    assert.ok(
      events.some((event) => event.eventType === "gap_fill_started"),
      "Expected imperative gap fill to start when the model returned no tool calls.",
    );
    assert.ok(
      events.some((event) => event.eventType === "web_search_started"),
      "Expected Tavily search to run imperatively.",
    );
    assert.ok(
      events.some((event) => event.eventType === "gap_fill_completed"),
      "Expected imperative gap fill to complete.",
    );

    const secondResearchCallMessages = fakeModels.toolCalls[1]?.messages ?? [];
    const syntheticGapFillAiMessage = secondResearchCallMessages.find(
      (message) =>
        message instanceof AIMessage &&
        message.tool_calls?.some((toolCall) => toolCall.name === "tavilySearch"),
    );
    assert.ok(
      syntheticGapFillAiMessage,
      "Expected the imperative gap-fill path to append a matching AI tool-call message before the Tavily tool result.",
    );

    const gapFillStarted = events.find(
      (event) => event.eventType === "gap_fill_started",
    );
    assert.deepEqual(gapFillStarted?.payload?.selectedCategories, [
      "market_size_inputs",
      "competitors_pricing",
      "compliance",
    ]);
    assert.deepEqual(gapFillStarted?.payload?.skippedCategories, [
      "buyers",
      "adoption",
    ]);
    assert.deepEqual(gapFillStarted?.payload?.rawProposedQueries, [
      "UK AI meeting assistant SMB sales teams market size and adoption",
      "UK AI meeting assistant competitors pricing SMB sales teams",
      "UK AI meeting assistant GDPR recording transcription compliance",
    ]);
    assert.deepEqual(gapFillStarted?.payload?.normalizedQueries, [
      "UK AI meeting assistant SMB sales teams market size and adoption",
      "UK AI meeting assistant competitors pricing SMB sales teams",
      "UK AI meeting assistant GDPR recording transcription compliance",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gtm researcher uses the same imperative gap-fill path after an early ResearchComplete", async () => {
  const fakeModels = new FakeModelFactory(
    [
      {
        queries: [
          {
            query: "UK AI meeting assistant SMB sales teams market size",
            intendedCategories: ["market_size_inputs"],
          },
          {
            query: "UK AI meeting assistant competitors pricing",
            intendedCategories: ["competitors_pricing"],
          },
          {
            query: "UK AI meeting assistant GDPR compliance",
            intendedCategories: ["compliance"],
          },
        ],
      },
    ],
    [
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "researcher-complete-too-early",
            name: "ResearchComplete",
            args: {},
            type: "tool_call",
          },
        ],
      }),
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "researcher-complete-after-gap-fill",
            name: "ResearchComplete",
            args: {},
            type: "tool_call",
          },
        ],
      }),
    ],
    [
      new AIMessage({
        content:
          "Compressed findings with [UK SMB Statistics](https://example.com/market-size).",
      }),
    ],
  );

  const events: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        results: [
          {
            title: "UK SMB Statistics",
            url: "https://example.com/market-size",
            content:
              "UK business population figures and employee bands for SMBs.",
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );

  try {
    const { researcherSubgraph } = createDeepResearchGraphs({
      models: fakeModels,
      openAiApiKey: "test-key",
      tavilyApiKey: "test-tavily-key",
      logEvent: async (_runId, _stage, eventType) => {
        events.push(eventType);
      },
    });

    await researcherSubgraph.invoke({
      runId: "run-gap-fill-early-complete",
      selectedDocumentIds: ["doc-1"],
      modelConfig,
      budgets,
      researchTopic:
        "Assess the UK go-to-market opportunity for an AI meeting assistant for SMB sales teams.",
      preResearchPlan: createGtmPreResearchPlan(),
      reportPlan: {
        mode: "gtm",
        sections: [
          {
            key: "executive_summary",
            title: "Executive Summary",
            objective: "Summarize the commercial conclusion.",
          },
        ],
        fallbackRule: 'Write "insufficient evidence" when evidence is missing.',
        plannerType: "adaptive",
        reportPlanVersion: 1,
      },
      coverageBoard: [],
      anchoredFacts: [],
      researcherMessages: [
        new HumanMessage({
          content:
            "Focused research task:\nAssess the UK go-to-market opportunity for an AI meeting assistant for SMB sales teams.",
        }),
      ],
      toolCallIterations: 0,
      gapFillStats: createEmptyGapFillStats(),
      pendingGapFillCategories: [],
    });

    assert.ok(events.includes("gap_fill_started"));
    assert.ok(events.includes("web_search_started"));
    assert.ok(events.includes("gap_fill_completed"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gap-fill fallback does not inject UK when the topic is non-UK", async () => {
  const fakeModels = new FakeModelFactory(
    [new Error("proposal failed")],
    [
      new AIMessage({ content: "I need to think about this more." }),
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "researcher-complete-after-gap-fill",
            name: "ResearchComplete",
            args: {},
            type: "tool_call",
          },
        ],
      }),
    ],
    [
      new AIMessage({
        content:
          "Compressed findings with [Brazil SMB statistics](https://example.com/br-market).",
      }),
    ],
  );

  const events: Array<{
    eventType: string;
    payload?: Record<string, unknown>;
  }> = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        results: [
          {
            title: "Brazil SMB statistics",
            url: "https://example.com/br-market",
            content: "Brazil business population and employee-band data.",
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );

  try {
    const { researcherSubgraph } = createDeepResearchGraphs({
      models: fakeModels,
      openAiApiKey: "test-key",
      tavilyApiKey: "test-tavily-key",
      logEvent: async (_runId, _stage, eventType, _message, payload) => {
        events.push({ eventType, payload });
      },
    });

    await researcherSubgraph.invoke({
      runId: "run-gap-fill-brazil-fallback",
      selectedDocumentIds: ["doc-1"],
      modelConfig,
      budgets,
      researchTopic:
        "Assess the Brazil go-to-market opportunity for an AI meeting assistant for SMB sales teams. Use uploaded documents first, then fill gaps with current web research.",
      preResearchPlan: createGtmPreResearchPlan(),
      reportPlan: {
        mode: "gtm",
        sections: [
          {
            key: "executive_summary",
            title: "Executive Summary",
            objective: "Summarize the commercial conclusion.",
          },
        ],
        fallbackRule: 'Write "insufficient evidence" when evidence is missing.',
        plannerType: "adaptive",
        reportPlanVersion: 1,
      },
      coverageBoard: [],
      anchoredFacts: [],
      researcherMessages: [
        new HumanMessage({
          content:
            "Focused research task:\nAssess the Brazil go-to-market opportunity for an AI meeting assistant for SMB sales teams.",
        }),
      ],
      toolCallIterations: 0,
      gapFillStats: createEmptyGapFillStats(),
      pendingGapFillCategories: [],
    });

    const gapFillStarted = events.find(
      (event) => event.eventType === "gap_fill_started",
    );
    const normalizedQueries = (gapFillStarted?.payload?.normalizedQueries ??
      []) as string[];
    assert.ok(normalizedQueries.length > 0);
    assert.equal(
      normalizedQueries.some((query) => /\buk\b/i.test(query)),
      false,
    );
    assert.equal(
      normalizedQueries.every((query) => /brazil/i.test(query)),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

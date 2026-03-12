import assert from "node:assert/strict";
import test from "node:test";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";

import { createDeepResearchGraphs } from "@/lib/deep-research/graph";
import type {
  DeepResearchModelFactory,
  DeepResearchModelRole,
} from "@/lib/deep-research/openai-model-factory";
import type {
  DeepResearchBudgets,
  DeepResearchModelConfig,
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
          id: "supervisor-call-2",
          name: "ResearchComplete",
          args: {},
          type: "tool_call",
        },
      ],
    }),
  ];
}

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
  assert.match(finalPrompt, /Sourced Facts/);
  assert.match(finalPrompt, /Assumptions/);
  assert.match(finalPrompt, /Inferred Estimates/);
  assert.match(finalPrompt, /low, base, and high scenarios/i);

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
  assert.match(finalPrompt, /insufficient evidence/i);
});

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
    void role;
    void schema;
    void messages;
    const next = this.structuredOutputs.shift();
    assert.ok(next, "Expected a queued structured response.");
    return next as T;
  }

  async invokeWithTools(
    role: DeepResearchModelRole,
    tools: unknown[],
    messages: unknown[],
  ) {
    void role;
    void tools;
    void messages;
    const next = this.toolOutputs.shift();
    assert.ok(next, "Expected a queued tool-call response.");
    return next;
  }

  async invokeText(role: DeepResearchModelRole, messages: unknown[]) {
    void role;
    void messages;
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
    [
      {
        needClarification: false,
        question: "",
        verification: "Starting research.",
      },
      {
        researchBrief: "Analyse the uploaded GTM documents and produce a report.",
      },
    ],
    [
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
    ],
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
});

import assert from "node:assert/strict";
import test from "node:test";

import { AIMessage } from "@langchain/core/messages";

import type {
  DeepResearchModelFactory,
  DeepResearchModelRole,
} from "@/lib/deep-research/openai-model-factory";
import {
  createResearcherTools,
  parseSearchToolEnvelope,
  runTavilySearch,
  type ResearchToolContext,
} from "@/lib/deep-research/tools";
import type { DeepResearchModelConfig } from "@/lib/deep-research/types";

class FakeModelFactory implements DeepResearchModelFactory {
  constructor(
    private readonly structuredHandler: (
      role: DeepResearchModelRole,
    ) => Promise<unknown>,
  ) {}

  async invokeStructured<T>(role: DeepResearchModelRole) {
    return (await this.structuredHandler(role)) as T;
  }

  async invokeWithTools() {
    return new AIMessage({ content: "" });
  }

  async invokeText() {
    return new AIMessage({ content: "" });
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
  maxContentLength: 20_000,
};

function createToolContext(
  models: DeepResearchModelFactory,
  events: Array<{ eventType: string; payload?: Record<string, unknown> }> = [],
): ResearchToolContext {
  return {
    runId: "test-run",
    selectedDocumentIds: ["doc-1"],
    openAiApiKey: "test-key",
    tavilyApiKey: "test-tavily-key",
    modelConfig,
    models,
    logEvent: async (_runId, _stage, eventType, _message, payload) => {
      events.push({ eventType, payload });
    },
  };
}

test("runTavilySearch returns partial successful results when one query fails", async () => {
  const events: Array<{ eventType: string; payload?: Record<string, unknown> }> =
    [];
  const models = new FakeModelFactory(async () => {
    throw new Error("Summarization should not run for this test.");
  });
  const context = createToolContext(models, events);
  const originalFetch = globalThis.fetch;
  const seenBodies: string[] = [];

  globalThis.fetch = async (input, init) => {
    void input;
    const body = String(init?.body ?? "");
    seenBodies.push(body);
    if (body.includes("competitor pricing")) {
      return new Response("upstream failure", { status: 500 });
    }

    return new Response(
      JSON.stringify({
        results: [
          {
            title: "UK SME AI adoption overview",
            url: "https://example.com/adoption",
            content:
              "UK SMEs are increasing their adoption of AI productivity software.",
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  try {
    const encoded = await runTavilySearch(
      context,
      ["uk smb ai adoption", "competitor pricing"],
      5,
      {
        searchDepth: "basic",
        includeRawContent: false,
        summarizeRawContent: false,
      },
    );

    const envelope = parseSearchToolEnvelope(encoded);
    assert.ok(envelope);
    assert.equal(envelope?.toolName, "tavilySearch");
    assert.equal(envelope?.artifact.results.length, 1);
    assert.ok(events.some((event) => event.eventType === "web_search_started"));
    assert.ok(
      events.some((event) => event.eventType === "web_search_completed"),
    );
    assert.ok(
      seenBodies.every(
        (body) =>
          body.includes('"search_depth":"basic"') &&
          body.includes('"include_raw_content":false'),
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tavilySearch falls back to page content when summarization fails", async () => {
  const models = new FakeModelFactory(async () => {
    throw new Error("summarizer failed");
  });
  const context = createToolContext(models);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        results: [
          {
            title: "AI assistant compliance overview",
            url: "https://example.com/compliance",
            content: "Fallback summary content from the search result.",
            raw_content:
              "Full raw content that would normally be summarized into a shorter note.",
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );

  try {
    const { toolsByName } = createResearcherTools(context);
    const tavilySearchTool = toolsByName.get("tavilySearch");
    assert.ok(tavilySearchTool);

    const encoded = await tavilySearchTool?.invoke({
      queries: ["uk ai assistant compliance"],
      matchCount: 5,
    });
    const envelope = parseSearchToolEnvelope(String(encoded));
    assert.ok(envelope);
    assert.equal(envelope?.toolName, "tavilySearch");
    assert.match(
      envelope?.renderedText ?? "",
      /Fallback summary content from the search result/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

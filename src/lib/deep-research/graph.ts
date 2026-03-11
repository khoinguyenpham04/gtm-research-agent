import {
  AIMessage,
  BaseMessage,
  getBufferString,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import {
  Annotation,
  Command,
  END,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";

import {
  clarifyWithUserInstructions,
  compressResearchSimpleHumanMessage,
  compressResearchSystemPrompt,
  finalReportGenerationPrompt,
  leadResearcherPrompt,
  researchSystemPrompt,
  transformMessagesIntoResearchTopicPrompt,
} from "@/lib/deep-research/prompts";
import {
  createResearcherTools,
  createSupervisorTools,
} from "@/lib/deep-research/tools";
import type {
  ClarificationInterrupt,
  ClarifyWithUserResult,
  DeepResearchBudgets,
  DeepResearchModelConfig,
  ResearchQuestionResult,
} from "@/lib/deep-research/types";
import {
  clarifyWithUserSchema,
  researchQuestionSchema,
} from "@/lib/deep-research/types";
import type {
  DeepResearchModelFactory,
} from "@/lib/deep-research/openai-model-factory";

interface GraphDependencies {
  models: DeepResearchModelFactory;
  logEvent?: (
    runId: string,
    stage: string,
    eventType: string,
    message: string,
    payload?: Record<string, unknown>,
  ) => Promise<void>;
  openAiApiKey: string;
  tavilyApiKey?: string;
  parentCheckpointer?: unknown;
}

const messageList = Annotation<BaseMessage[]>({
  reducer: (current, update) =>
    current.concat(Array.isArray(update) ? update : [update]),
  default: () => [],
});

const stringList = Annotation<string[]>({
  reducer: (current, update) =>
    current.concat(Array.isArray(update) ? update : [update]),
  default: () => [],
});

const DeepResearchState = Annotation.Root({
  runId: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  topic: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  objective: Annotation<string | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined,
  }),
  selectedDocumentIds: Annotation<string[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  modelConfig: Annotation<DeepResearchModelConfig>({
    reducer: (_current, update) => update,
  }),
  budgets: Annotation<DeepResearchBudgets>({
    reducer: (_current, update) => update,
  }),
  messages: messageList,
  supervisorMessages: messageList,
  researchBrief: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  notes: stringList,
  rawNotes: stringList,
  finalReportMarkdown: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  clarificationQuestion: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
});

const SupervisorState = Annotation.Root({
  runId: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  selectedDocumentIds: Annotation<string[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  modelConfig: Annotation<DeepResearchModelConfig>({
    reducer: (_current, update) => update,
  }),
  budgets: Annotation<DeepResearchBudgets>({
    reducer: (_current, update) => update,
  }),
  supervisorMessages: messageList,
  researchBrief: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  notes: stringList,
  rawNotes: stringList,
  researchIterations: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
});

const ResearcherState = Annotation.Root({
  runId: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  selectedDocumentIds: Annotation<string[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  modelConfig: Annotation<DeepResearchModelConfig>({
    reducer: (_current, update) => update,
  }),
  budgets: Annotation<DeepResearchBudgets>({
    reducer: (_current, update) => update,
  }),
  researcherMessages: messageList,
  toolCallIterations: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  researchTopic: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  compressedResearch: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  rawNotes: stringList,
});

type DeepResearchStateType = typeof DeepResearchState.State;
type SupervisorStateType = typeof SupervisorState.State;
type ResearcherStateType = typeof ResearcherState.State;

function getTodayString() {
  const date = new Date();
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((value) => stringifyContent(value))
      .filter(Boolean)
      .join("\n");
  }

  if (content && typeof content === "object") {
    return JSON.stringify(content);
  }

  return String(content ?? "");
}

function extractToolCalls(message: BaseMessage) {
  if (message instanceof AIMessage) {
    return message.tool_calls ?? [];
  }

  return [];
}

function extractToolMessageContents(messages: BaseMessage[]) {
  return messages
    .filter((message): message is ToolMessage => message instanceof ToolMessage)
    .map((message) => stringifyContent(message.content));
}

function extractRawNoteContent(messages: BaseMessage[]) {
  return messages
    .filter(
      (message) => message instanceof AIMessage || message instanceof ToolMessage,
    )
    .map((message) => stringifyContent(message.content))
    .join("\n\n");
}

function trimUpToLastAiMessage(messages: BaseMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index] instanceof AIMessage) {
      return messages.slice(0, index);
    }
  }

  return messages;
}

function isTokenLimitError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("context length") ||
    message.includes("maximum context") ||
    message.includes("too many tokens") ||
    message.includes("token limit")
  );
}

export function createDeepResearchGraphs(dependencies: GraphDependencies) {
  const { think, conductResearch, researchComplete } = createSupervisorTools();

  const logEvent = async (
    runId: string,
    stage: string,
    eventType: string,
    message: string,
    payload?: Record<string, unknown>,
  ) => {
    await dependencies.logEvent?.(runId, stage, eventType, message, payload);
  };

  const clarifyWithUser = async (state: DeepResearchStateType) => {
    await logEvent(
      state.runId,
      "clarify",
      "clarification_started",
      "Assessing whether clarification is required.",
    );

    const response = await dependencies.models.invokeStructured<ClarifyWithUserResult>(
      "research",
      clarifyWithUserSchema,
      [
        new HumanMessage({
          content: clarifyWithUserInstructions
            .replace("{messages}", getBufferString(state.messages))
            .replace("{date}", getTodayString()),
        }),
      ],
    );

    if (response.needClarification) {
      await logEvent(
        state.runId,
        "clarify",
        "clarification_requested",
        "The graph requested clarification from the user.",
        { question: response.question },
      );

      const userAnswer = interrupt<ClarificationInterrupt, string>({
        type: "clarification",
        question: response.question,
      });

      await logEvent(
        state.runId,
        "clarify",
        "clarification_resumed",
        "Clarification response received.",
      );

      return new Command({
        goto: "writeResearchBrief",
        update: {
          clarificationQuestion: response.question,
          messages: [
            new AIMessage({ content: response.question }),
            new HumanMessage({ content: userAnswer }),
            new AIMessage({
              content:
                "Thanks. I have what I need and I’m starting the research now.",
            }),
          ],
        },
      });
    }

    await logEvent(
      state.runId,
      "clarify",
      "clarification_skipped",
      "Clarification was not required.",
    );

    return new Command({
      goto: "writeResearchBrief",
      update: {
        clarificationQuestion: "",
        messages: [
          new AIMessage({
            content:
              response.verification ||
              "I have enough context and I’m starting the research now.",
          }),
        ],
      },
    });
  };

  const writeResearchBrief = async (state: DeepResearchStateType) => {
    await logEvent(
      state.runId,
      "planning",
      "brief_started",
      "Writing the research brief.",
    );

    const response = await dependencies.models.invokeStructured<ResearchQuestionResult>(
      "research",
      researchQuestionSchema,
      [
        new HumanMessage({
          content: transformMessagesIntoResearchTopicPrompt
            .replace("{messages}", getBufferString(state.messages))
            .replace("{date}", getTodayString()),
        }),
      ],
    );

    await logEvent(
      state.runId,
      "planning",
      "brief_completed",
      "Research brief created.",
      { researchBrief: response.researchBrief },
    );

    return new Command({
      goto: "researchSupervisor",
      update: {
        researchBrief: response.researchBrief,
        supervisorMessages: [
          new SystemMessage({
            content: leadResearcherPrompt
              .replace("{date}", getTodayString())
              .replace(
                "{maxConcurrentResearchUnits}",
                String(state.budgets.maxConcurrentResearchUnits),
              )
              .replace(
                "{maxResearcherIterations}",
                String(state.budgets.maxResearcherIterations),
              ),
          }),
          new HumanMessage({ content: response.researchBrief }),
        ],
      },
    });
  };

  const supervisor = async (state: SupervisorStateType) => {
    const response = await dependencies.models.invokeWithTools(
      "research",
      [conductResearch, researchComplete, think],
      state.supervisorMessages,
    );

    return new Command({
      goto: "supervisorTools",
      update: {
        supervisorMessages: [response],
        researchIterations: state.researchIterations + 1,
      },
    });
  };

  const supervisorTools = async (state: SupervisorStateType) => {
    const mostRecentMessage = state.supervisorMessages.at(-1);
    if (!mostRecentMessage) {
      return new Command({
        goto: END,
        update: {
          notes: extractToolMessageContents(state.supervisorMessages),
        },
      });
    }

    const toolCalls = extractToolCalls(mostRecentMessage);
    const exceededIterations =
      state.researchIterations > state.budgets.maxResearcherIterations;
    const researchCompleteCalled = toolCalls.some(
      (toolCall) => toolCall.name === "ResearchComplete",
    );

    if (
      exceededIterations ||
      toolCalls.length === 0 ||
      researchCompleteCalled
    ) {
      await logEvent(
        state.runId,
        "planning",
        "supervisor_completed",
        "Supervisor ended the research phase.",
        {
          researchIterations: state.researchIterations,
          reason: researchCompleteCalled
            ? "research_complete"
            : toolCalls.length === 0
              ? "no_tool_calls"
              : "iteration_limit",
        },
      );

      return new Command({
        goto: END,
        update: {
          notes: extractToolMessageContents(state.supervisorMessages),
        },
      });
    }

    const toolMessages: ToolMessage[] = [];
    const rawNotes: string[] = [];

    for (const toolCall of toolCalls.filter(
      (call) => call.name === "thinkTool",
    )) {
      toolMessages.push(
        new ToolMessage({
          content: `Reflection recorded: ${String(toolCall.args?.reflection ?? "")}`,
          tool_call_id: toolCall.id ?? crypto.randomUUID(),
          name: "thinkTool",
        }),
      );
    }

    const researchCalls = toolCalls.filter(
      (toolCall) => toolCall.name === "ConductResearch",
    );

    if (researchCalls.length > 0) {
      await logEvent(
        state.runId,
        "planning",
        "delegation_started",
        "Supervisor delegated research to sub-agents.",
        { requestedResearchUnits: researchCalls.length },
      );

      const permittedCalls = researchCalls.slice(
        0,
        state.budgets.maxConcurrentResearchUnits,
      );
      const overflowCalls = researchCalls.slice(
        state.budgets.maxConcurrentResearchUnits,
      );

      const results = await Promise.all(
        permittedCalls.map(async (toolCall) => {
          const topic = String(toolCall.args?.researchTopic ?? "");
          return researcherSubgraph.invoke({
            runId: state.runId,
            selectedDocumentIds: state.selectedDocumentIds,
            modelConfig: state.modelConfig,
            budgets: state.budgets,
            researchTopic: topic,
            researcherMessages: [new HumanMessage({ content: topic })],
            toolCallIterations: 0,
          });
        }),
      );

      results.forEach((result, index) => {
        const toolCall = permittedCalls[index];
        if (!result) {
          return;
        }

        toolMessages.push(
          new ToolMessage({
            content:
              result.compressedResearch ||
              "Error synthesizing research report.",
            tool_call_id: toolCall.id ?? crypto.randomUUID(),
            name: "ConductResearch",
          }),
        );

        rawNotes.push(...(result.rawNotes ?? []));
      });

      overflowCalls.forEach((toolCall) => {
        toolMessages.push(
          new ToolMessage({
            content: `Error: exceeded the maximum of ${state.budgets.maxConcurrentResearchUnits} parallel research units.`,
            tool_call_id: toolCall.id ?? crypto.randomUUID(),
            name: "ConductResearch",
          }),
        );
      });

      await logEvent(
        state.runId,
        "planning",
        "delegation_completed",
        "Supervisor collected sub-agent research.",
        { completedResearchUnits: permittedCalls.length },
      );
    }

    return new Command({
      goto: "supervisor",
      update: {
        supervisorMessages: toolMessages,
        rawNotes,
      },
    });
  };

  const researcher = async (state: ResearcherStateType) => {
    const { tools } = createResearcherTools({
      runId: state.runId,
      selectedDocumentIds: state.selectedDocumentIds,
      openAiApiKey: dependencies.openAiApiKey,
      tavilyApiKey: dependencies.tavilyApiKey,
      modelConfig: state.modelConfig,
      models: dependencies.models,
      logEvent: dependencies.logEvent,
    });

    const response = await dependencies.models.invokeWithTools(
      "research",
      tools,
      [
        new SystemMessage({
          content: researchSystemPrompt.replace("{date}", getTodayString()),
        }),
        ...state.researcherMessages,
      ],
    );

    return new Command({
      goto: "researcherTools",
      update: {
        researcherMessages: [response],
        toolCallIterations: state.toolCallIterations + 1,
      },
    });
  };

  const researcherTools = async (state: ResearcherStateType) => {
    const mostRecentMessage = state.researcherMessages.at(-1);
    if (!mostRecentMessage) {
      return new Command({ goto: "compressResearch" });
    }

    const toolCalls = extractToolCalls(mostRecentMessage);
    if (toolCalls.length === 0) {
      return new Command({ goto: "compressResearch" });
    }

    const { toolsByName } = createResearcherTools({
      runId: state.runId,
      selectedDocumentIds: state.selectedDocumentIds,
      openAiApiKey: dependencies.openAiApiKey,
      tavilyApiKey: dependencies.tavilyApiKey,
      modelConfig: state.modelConfig,
      models: dependencies.models,
      logEvent: dependencies.logEvent,
    });

    const observations = await Promise.all(
      toolCalls.map(async (toolCall) => {
        const namedTool = toolsByName.get(toolCall.name);
        if (!namedTool) {
          return `Error: tool "${toolCall.name}" is not available.`;
        }

        try {
          return await namedTool.invoke(toolCall.args ?? {});
        } catch (error) {
          return `Error executing ${toolCall.name}: ${
            error instanceof Error ? error.message : String(error)
          }`;
        }
      }),
    );

    const toolMessages = observations.map((observation, index) => {
      const toolCall = toolCalls[index];
      return new ToolMessage({
        content: observation,
        tool_call_id: toolCall.id ?? crypto.randomUUID(),
        name: toolCall.name,
      });
    });

    const researchCompleteCalled = toolCalls.some(
      (toolCall) => toolCall.name === "ResearchComplete",
    );
    const exceededIterations =
      state.toolCallIterations >= state.budgets.maxReactToolCalls;

    if (researchCompleteCalled || exceededIterations) {
      return new Command({
        goto: "compressResearch",
        update: {
          researcherMessages: toolMessages,
        },
      });
    }

    return new Command({
      goto: "researcher",
      update: {
        researcherMessages: toolMessages,
      },
    });
  };

  const compressResearch = async (state: ResearcherStateType) => {
    await logEvent(
      state.runId,
      "drafting",
      "compression_started",
      "Compressing sub-agent findings.",
      { researchTopic: state.researchTopic },
    );

    let researcherMessages = [
      ...state.researcherMessages,
      new HumanMessage({ content: compressResearchSimpleHumanMessage }),
    ];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await dependencies.models.invokeText("compression", [
          new SystemMessage({
            content: compressResearchSystemPrompt,
          }),
          ...researcherMessages,
        ]);

        const rawNotes = extractRawNoteContent(researcherMessages);
        await logEvent(
          state.runId,
          "drafting",
          "compression_completed",
          "Compressed sub-agent findings.",
          { researchTopic: state.researchTopic },
        );

        return {
          compressedResearch: stringifyContent(response.content),
          rawNotes: rawNotes ? [rawNotes] : [],
        };
      } catch (error) {
        if (!isTokenLimitError(error)) {
          break;
        }

        researcherMessages = trimUpToLastAiMessage(researcherMessages);
      }
    }

    return {
      compressedResearch: "Error synthesizing research report: Maximum retries exceeded.",
      rawNotes: [extractRawNoteContent(researcherMessages)],
    };
  };

  const finalReportGeneration = async (state: DeepResearchStateType) => {
    await logEvent(
      state.runId,
      "drafting",
      "final_report_started",
      "Generating the final report.",
    );

    let findings = state.notes.join("\n\n");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await dependencies.models.invokeText("finalReport", [
          new HumanMessage({
            content: finalReportGenerationPrompt
              .replace("{researchBrief}", state.researchBrief)
              .replace("{messages}", getBufferString(state.messages))
              .replace("{date}", getTodayString())
              .replace("{findings}", findings),
          }),
        ]);

        await logEvent(
          state.runId,
          "completed",
          "final_report_completed",
          "Final report generated.",
        );

        return {
          finalReportMarkdown: stringifyContent(response.content),
          messages: [response],
        };
      } catch (error) {
        if (!isTokenLimitError(error)) {
          throw error;
        }

        findings = findings.slice(0, Math.floor(findings.length * 0.85));
      }
    }

    throw new Error("Failed to generate the final report after retries.");
  };

  const researcherBuilder = new StateGraph(ResearcherState)
    .addNode("researcher", researcher, {
      ends: ["researcherTools"],
    })
    .addNode("researcherTools", researcherTools, {
      ends: ["researcher", "compressResearch"],
    })
    .addNode("compressResearch", compressResearch)
    .addEdge(START, "researcher")
    .addEdge("compressResearch", END);

  const researcherSubgraph = researcherBuilder.compile({
    checkpointer: false,
    name: "deepResearchResearcher",
  });

  const supervisorSubgraph = new StateGraph(SupervisorState)
    .addNode("supervisor", supervisor, {
      ends: ["supervisorTools"],
    })
    .addNode("supervisorTools", supervisorTools, {
      ends: ["supervisor", END],
    })
    .addEdge(START, "supervisor")
    .compile({
      checkpointer: false,
      name: "deepResearchSupervisor",
    });

  const deepResearchGraph = new StateGraph(DeepResearchState)
    .addNode("clarifyWithUser", clarifyWithUser, {
      ends: ["writeResearchBrief", END],
    })
    .addNode("writeResearchBrief", writeResearchBrief, {
      ends: ["researchSupervisor"],
    })
    .addNode("researchSupervisor", supervisorSubgraph)
    .addNode("finalReportGeneration", finalReportGeneration)
    .addEdge(START, "clarifyWithUser")
    .addEdge("researchSupervisor", "finalReportGeneration")
    .addEdge("finalReportGeneration", END)
    .compile({
      checkpointer: dependencies.parentCheckpointer as never,
      name: "deepResearchGraph",
    });

  return {
    researcherSubgraph,
    supervisorSubgraph,
    deepResearchGraph,
  };
}

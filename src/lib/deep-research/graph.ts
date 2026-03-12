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
  buildReportPlanPrompt,
  clarifyWithUserInstructions,
  compressResearchSimpleHumanMessage,
  compressResearchSystemPrompt,
  extractEvidenceLedgerPrompt,
  finalReportGenerationPrompt,
  leadResearcherPrompt,
  preResearchPlanningPrompt,
  researchSystemPrompt,
  resolveEvidenceConflictsPrompt,
  scoreSectionSupportPrompt,
  transformMessagesIntoResearchTopicPrompt,
  validateEvidenceForFinalPrompt,
} from "@/lib/deep-research/prompts";
import {
  createResearcherTools,
  createSupervisorTools,
} from "@/lib/deep-research/tools";
import type {
  CandidateEvidenceRow,
  ClarificationInterrupt,
  ClarifyWithUserResult,
  DeepResearchBudgets,
  DeepResearchModelConfig,
  EvidenceConflictResolutionResult,
  EvidenceExtractionResult,
  EvidenceResolution,
  EvidenceRow,
  EvidenceValidationResult,
  PreResearchPlan,
  ReportPlan,
  ResearchQuestionResult,
  SectionEvidenceLink,
  SectionSupport,
  SectionSupportResult,
} from "@/lib/deep-research/types";
import {
  clarifyWithUserSchema,
  evidenceConflictResolutionSchema,
  evidenceExtractionSchema,
  evidenceValidationSchema,
  preResearchPlanSchema,
  reportPlanSchema,
  researchQuestionSchema,
  sectionSupportResultSchema,
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

function createReplaceListAnnotation<T>() {
  return Annotation<T[]>({
    reducer: (_current, update) =>
      Array.isArray(update) ? [...update] : [update],
    default: () => [],
  });
}

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
  preResearchPlan: Annotation<PreResearchPlan | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined,
  }),
  notes: stringList,
  rawNotes: stringList,
  reportPlan: Annotation<ReportPlan | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined,
  }),
  sectionSupport: createReplaceListAnnotation<SectionSupport>(),
  evidenceRows: createReplaceListAnnotation<EvidenceRow>(),
  evidenceResolutions: createReplaceListAnnotation<EvidenceResolution>(),
  sectionEvidenceLinks: createReplaceListAnnotation<SectionEvidenceLink>(),
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
  preResearchPlan: Annotation<PreResearchPlan | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined,
  }),
  reportPlan: Annotation<ReportPlan | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined,
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
  preResearchPlan: Annotation<PreResearchPlan | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined,
  }),
  reportPlan: Annotation<ReportPlan | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined,
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

function truncateForPrompt(content: string, maxLength: number) {
  if (content.length <= maxLength) {
    return content;
  }

  return `${content.slice(0, maxLength)}\n\n...[truncated]`;
}

function stringifyForPrompt(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function buildRawFindingsSummary(state: DeepResearchStateType) {
  const content = state.rawNotes.join("\n\n---\n\n").trim();
  return content || "No raw findings were recorded.";
}

function buildCompressedFindingsSummary(state: DeepResearchStateType) {
  const content = state.notes.join("\n\n---\n\n").trim();
  return content || "No compressed findings were recorded.";
}

function extractSourceTier(content: string): SectionSupport["topSourceTier"] {
  const normalized = content.toLowerCase();

  if (
    normalized.includes("document id:") ||
    normalized.includes("selected uploaded documents") ||
    normalized.includes("sourceType\":\"uploaded_document")
  ) {
    return "selected_document";
  }

  if (
    normalized.includes(".gov") ||
    normalized.includes("office for national statistics") ||
    normalized.includes("fca") ||
    normalized.includes("gov.uk") ||
    normalized.includes("regulator")
  ) {
    return "primary";
  }

  if (
    normalized.includes("gartner") ||
    normalized.includes("forrester") ||
    normalized.includes("mckinsey") ||
    normalized.includes("analyst")
  ) {
    return "analyst";
  }

  if (
    normalized.includes("techcrunch") ||
    normalized.includes("computerweekly") ||
    normalized.includes("ft.com") ||
    normalized.includes("reuters")
  ) {
    return "trade_press";
  }

  if (
    normalized.includes("salesforce") ||
    normalized.includes("hubspot") ||
    normalized.includes("vendor")
  ) {
    return "vendor";
  }

  if (normalized.includes("blog")) {
    return "blog";
  }

  return "unknown";
}

function tokenizeForMatching(input: string) {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 4);
}

function pickRelevantItems(topic: string, items: string[], limit: number) {
  if (items.length <= limit) {
    return items;
  }

  const topicTokens = new Set(tokenizeForMatching(topic));
  const scored = items.map((item, index) => {
    const itemTokens = tokenizeForMatching(item);
    const overlap = itemTokens.reduce(
      (count, token) => count + (topicTokens.has(token) ? 1 : 0),
      0,
    );
    return { item, index, overlap };
  });

  const prioritized = scored
    .sort((left, right) => {
      if (right.overlap !== left.overlap) {
        return right.overlap - left.overlap;
      }
      return left.index - right.index;
    })
    .slice(0, limit)
    .map((entry) => entry.item);

  return prioritized;
}

function createFallbackPreResearchPlan(
  state: DeepResearchStateType,
): PreResearchPlan {
  const combinedContext = [
    state.topic,
    state.objective ?? "",
    state.researchBrief,
    getBufferString(state.messages),
  ]
    .join("\n")
    .toLowerCase();

  const isGtm = /(go-to-market|go to market|gtm|market entry|icp|tam|sam|som|competitor|pricing|launch)/.test(
    combinedContext,
  );
  const mode: PreResearchPlan["mode"] = isGtm ? "gtm" : "general";

  if (mode === "gtm") {
    return {
      mode,
      coreQuestions: [
        "Which market demand signals in the uploaded documents support or weaken the opportunity?",
        "What sourced inputs exist for market size, adoption, and segment sizing?",
        "Which buyer segments or ICPs appear most relevant and why?",
        "What competitor, pricing, and positioning evidence is available?",
        "Which compliance or operational constraints could block market entry?",
      ],
      requiredEvidenceCategories: [
        "uploaded-document demand and adoption evidence",
        "market sizing inputs rather than neat final totals",
        "buyer segment evidence",
        "competitor and pricing signals",
        "compliance and regulatory constraints",
      ],
      gtmSubquestions: [
        "What sourced market size inputs exist for TAM, SAM, or SOM?",
        "What adoption evidence shows whether the target segment is ready now?",
        "Which buyer segments or use cases are directly supported by the selected documents?",
        "What competitor or pricing evidence is available from the selected documents and validated web sources?",
        "What compliance constraints materially affect the GTM motion?",
      ],
      documentResearchPriorities: [
        "Extract the strongest adoption, buyer, workflow, and pricing signals from the selected uploaded documents first.",
        "Use the uploaded documents to anchor sourced market-sizing inputs before looking to the web for validation or gap filling.",
      ],
    };
  }

  return {
    mode,
    coreQuestions: [
      "What is the most direct answer to the user's question?",
      "Which uploaded-document findings most strongly support the answer?",
      "What gaps remain after reviewing the selected uploaded documents?",
    ],
    requiredEvidenceCategories: [
      "uploaded-document evidence",
      "supporting validation evidence",
      "evidence gaps or uncertainties",
    ],
    gtmSubquestions: [],
    documentResearchPriorities: [
      "Use the selected uploaded documents as the first source of evidence before web validation.",
    ],
  };
}

function createFallbackReportPlan(state: DeepResearchStateType): ReportPlan {
  const preResearchPlan = state.preResearchPlan ?? createFallbackPreResearchPlan(state);
  const combinedContext = [
    state.topic,
    state.objective ?? "",
    state.researchBrief,
    getBufferString(state.messages),
  ]
    .join("\n")
    .toLowerCase();

  const includeMarketSizing =
    preResearchPlan.mode === "gtm" &&
    /(tam|sam|som|market size|market sizing|market opportunity|size\b)/.test(
      combinedContext,
    );
  const includeBuyers =
    preResearchPlan.mode === "gtm" &&
    /(buyer|segment|icp|persona|customer|adoption)/.test(combinedContext);
  const includeCompetitors =
    preResearchPlan.mode === "gtm" &&
    /(competitor|pricing|positioning|battlecard)/.test(combinedContext);
  const includeCompliance =
    preResearchPlan.mode === "gtm" &&
    /(compliance|regulat|privacy|gdpr|risk)/.test(combinedContext);

  const sections = preResearchPlan.mode === "gtm"
    ? [
        {
          key: "executive_summary",
          title: "Executive Summary",
          objective: "Summarize the main market opportunity, risks, and recommendation.",
        },
        ...(includeMarketSizing
          ? [
              {
                key: "market_sizing_scenarios",
                title: "Market Sizing Scenarios",
                objective:
                  "Show sourced market-sizing inputs, explicit assumptions, and low/base/high inferred ranges.",
              },
            ]
          : [
              {
                key: "market_opportunity",
                title: "Market Opportunity",
                objective:
                  "Assess the market context, demand signals, and growth dynamics.",
              },
            ]),
        ...(includeBuyers
          ? [
              {
                key: "buyers_and_adoption",
                title: "Buyer Segments and Adoption",
                objective:
                  "Describe the most relevant buyers, segments, and adoption signals.",
              },
            ]
          : []),
        ...(includeCompetitors
          ? [
              {
                key: "competition_and_pricing",
                title: "Competition and Pricing",
                objective:
                  "Summarize the key competitor and pricing evidence that shapes differentiation.",
              },
            ]
          : []),
        ...(includeCompliance
          ? [
              {
                key: "compliance_constraints",
                title: "Compliance Constraints",
                objective:
                  "Highlight the most material compliance or regulatory constraints.",
              },
            ]
          : []),
        {
          key: "recommendations",
          title: "Recommendations",
          objective: "Highlight material risks and recommended next actions.",
        },
      ]
    : [
        {
          key: "summary",
          title: "Summary",
          objective: "Summarize the most important answer to the research brief.",
        },
        {
          key: "key_findings",
          title: "Key Findings",
          objective: "Present the strongest evidence-backed findings from the research.",
        },
        {
          key: "evidence_gaps",
          title: "Evidence Gaps",
          objective: "Call out missing or weakly supported parts of the research.",
        },
        {
          key: "recommendations",
          title: "Recommendations",
          objective: "Provide cautious next steps based on the available evidence.",
        },
      ];

  return {
    mode: preResearchPlan.mode,
    sections,
    fallbackRule:
      'If evidence is missing, explicitly write "insufficient evidence" instead of inferring an answer.',
    plannerType: "adaptive",
    reportPlanVersion: 1,
  };
}

function formatPreResearchPlan(
  plan: PreResearchPlan,
  topic?: string,
) {
  const relevantCoreQuestions = topic
    ? pickRelevantItems(topic, plan.coreQuestions, 4)
    : plan.coreQuestions;
  const relevantEvidenceCategories = topic
    ? pickRelevantItems(topic, plan.requiredEvidenceCategories, 4)
    : plan.requiredEvidenceCategories;
  const relevantGtmSubquestions = topic
    ? pickRelevantItems(topic, plan.gtmSubquestions, 5)
    : plan.gtmSubquestions;
  const documentPriorities = topic
    ? pickRelevantItems(topic, plan.documentResearchPriorities, 3)
    : plan.documentResearchPriorities;

  return [
    `Mode: ${plan.mode}`,
    "",
    "Core Questions:",
    ...relevantCoreQuestions.map((item, index) => `${index + 1}. ${item}`),
    "",
    "Required Evidence Categories:",
    ...relevantEvidenceCategories.map(
      (item, index) => `${index + 1}. ${item}`,
    ),
    ...(documentPriorities.length > 0
      ? [
          "",
          "Selected Document Priorities:",
          ...documentPriorities.map((item, index) => `${index + 1}. ${item}`),
        ]
      : []),
    ...(plan.mode === "gtm" && relevantGtmSubquestions.length > 0
      ? [
          "",
          "GTM Sub-Questions:",
          ...relevantGtmSubquestions.map(
            (item, index) => `${index + 1}. ${item}`,
          ),
        ]
      : []),
  ].join("\n");
}

function buildSupervisorResearchInstruction(
  state: DeepResearchStateType,
  reportPlan: ReportPlan,
) {
  const preResearchPlan =
    state.preResearchPlan ?? createFallbackPreResearchPlan(state);

  return [
    `Research brief: ${state.researchBrief}`,
    "",
    "<Pre-Research Plan>",
    formatPreResearchPlan(preResearchPlan),
    "</Pre-Research Plan>",
    "",
    "<Report Sections>",
    ...reportPlan.sections.map(
      (section, index) =>
        `${index + 1}. ${section.title} (${section.key}): ${section.objective}`,
    ),
    "</Report Sections>",
    "",
    "Research rules:",
    "1. Use the selected uploaded documents first and try to answer the core questions from them before web search.",
    "2. Delegate focused research tasks tied to evidence gaps, not broad restatements of the brief.",
    "3. For GTM work, prioritize market size inputs, adoption evidence, buyer segments, competitor or pricing evidence, and compliance constraints.",
    "4. For market sizing, collect sourced inputs and explicit assumptions instead of inventing a single neat number.",
  ].join("\n");
}

function buildResearchTaskInstruction(
  topic: string,
  preResearchPlan: PreResearchPlan | undefined,
  reportPlan: ReportPlan | undefined,
) {
  const effectivePreResearchPlan = preResearchPlan ?? {
    mode: "general" as const,
    coreQuestions: [],
    requiredEvidenceCategories: [],
    gtmSubquestions: [],
    documentResearchPriorities: [],
  };

  const lines = [
    `Focused research task: ${topic}`,
    "",
    "<Relevant Planning Context>",
    formatPreResearchPlan(effectivePreResearchPlan, topic),
    "</Relevant Planning Context>",
  ];

  if (reportPlan) {
    const relevantSections = pickRelevantItems(
      topic,
      reportPlan.sections.map(
        (section) =>
          `${section.title} (${section.key}): ${section.objective}`,
      ),
      3,
    );

    if (relevantSections.length > 0) {
      lines.push(
        "",
        "<Relevant Report Sections>",
        ...relevantSections.map((section, index) => `${index + 1}. ${section}`),
        "</Relevant Report Sections>",
      );
    }
  }

  lines.push(
    "",
    "Execution rules:",
    "1. Start with selectedDocumentsSearch and answer the relevant core questions from uploaded documents before web search.",
    "2. Extract direct evidence, citations, and market-sizing inputs from uploaded documents whenever possible.",
    "3. For GTM sizing work, capture sourced inputs and explicit assumptions instead of presenting one precise TAM, SAM, or SOM too early.",
    "4. Use Tavily only to fill evidence gaps or validate claims after reviewing uploaded-document evidence.",
  );

  return lines.join("\n");
}

function normalizeSectionSupport(
  plan: ReportPlan,
  sectionSupport: SectionSupport[],
): SectionSupport[] {
  const byKey = new Map(sectionSupport.map((item) => [item.key, item]));

  return plan.sections.map((section) => {
    const existing = byKey.get(section.key);
    if (existing) {
      return existing;
    }

    return {
      key: section.key,
      support: "missing",
      reason: "No support assessment was generated for this section.",
      evidenceCount: 0,
      topSourceTier: "unknown",
    };
  });
}

function enrichSectionSupportFromFindings(
  sectionSupport: SectionSupport[],
  rawFindings: string,
): SectionSupport[] {
  return sectionSupport.map((section) => {
    const evidenceCount =
      section.evidenceCount ??
      (section.support === "strong"
        ? 3
        : section.support === "weak"
          ? 1
          : 0);

    return {
      ...section,
      evidenceCount,
      topSourceTier:
        section.topSourceTier ??
        extractSourceTier(rawFindings),
    };
  });
}

function applyResolutionIds(
  evidenceRows: EvidenceRow[],
  evidenceResolutions: EvidenceResolution[],
) {
  if (evidenceResolutions.length === 0) {
    return evidenceRows;
  }

  const resolutionByGroup = new Map(
    evidenceResolutions.map((resolution) => [
      resolution.conflictGroup,
      resolution.id,
    ]),
  );

  return evidenceRows.map((row) => ({
    ...row,
    resolutionId:
      row.conflictGroup && resolutionByGroup.has(row.conflictGroup)
        ? resolutionByGroup.get(row.conflictGroup)
        : row.resolutionId,
  }));
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
      goto: "planResearch",
      update: {
        researchBrief: response.researchBrief,
      },
    });
  };

  const planResearch = async (state: DeepResearchStateType) => {
    await logEvent(
      state.runId,
      "planning",
      "pre_research_plan_started",
      "Creating the pre-research planning guide.",
    );

    let preResearchPlan: PreResearchPlan;
    try {
      preResearchPlan = await dependencies.models.invokeStructured<PreResearchPlan>(
        "research",
        preResearchPlanSchema,
        [
          new HumanMessage({
            content: preResearchPlanningPrompt
              .replace("{researchBrief}", state.researchBrief)
              .replace("{messages}", getBufferString(state.messages))
              .replace("{date}", getTodayString()),
          }),
        ],
      );
    } catch {
      preResearchPlan = createFallbackPreResearchPlan(state);
    }

    await logEvent(
      state.runId,
      "planning",
      "pre_research_plan_completed",
      "Pre-research planning completed.",
      {
        preResearchPlan,
      },
    );

    return {
      preResearchPlan,
    };
  };

  const buildReportPlan = async (state: DeepResearchStateType) => {
    await logEvent(
      state.runId,
      "planning",
      "report_plan_started",
      "Building the adaptive report plan.",
    );

    let reportPlan: ReportPlan;
    try {
      reportPlan = await dependencies.models.invokeStructured<ReportPlan>(
        "research",
        reportPlanSchema,
        [
          new HumanMessage({
            content: buildReportPlanPrompt
              .replace("{researchBrief}", state.researchBrief)
              .replace(
                "{preResearchPlan}",
                stringifyForPrompt(
                  state.preResearchPlan ?? createFallbackPreResearchPlan(state),
                ),
              )
              .replace("{messages}", getBufferString(state.messages))
              .replace("{date}", getTodayString()),
          }),
        ],
      );
    } catch {
      reportPlan = createFallbackReportPlan(state);
    }

    await logEvent(
      state.runId,
      "planning",
      "report_plan_completed",
      "Adaptive report plan created.",
      {
        mode: reportPlan.mode,
        sectionKeys: reportPlan.sections.map((section) => section.key),
        plannerType: reportPlan.plannerType,
        reportPlanVersion: reportPlan.reportPlanVersion,
      },
    );

    return {
      reportPlan,
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
        new HumanMessage({
          content: buildSupervisorResearchInstruction(
            {
              ...state,
              reportPlan,
            },
            reportPlan,
          ),
        }),
      ],
    };
  };

  const scoreSectionSupport = async (state: DeepResearchStateType) => {
    const reportPlan = state.reportPlan ?? createFallbackReportPlan(state);
    const rawFindings = truncateForPrompt(
      buildRawFindingsSummary(state),
      state.modelConfig.maxContentLength,
    );
    const compressedFindings = truncateForPrompt(
      buildCompressedFindingsSummary(state),
      Math.max(4000, Math.floor(state.modelConfig.maxContentLength * 0.6)),
    );

    await logEvent(
      state.runId,
      "validation",
      "section_support_started",
      "Scoring section support from the collected evidence.",
      { sectionKeys: reportPlan.sections.map((section) => section.key) },
    );

    let sectionSupport: SectionSupport[];
    try {
      const response =
        await dependencies.models.invokeStructured<SectionSupportResult>(
          "research",
          sectionSupportResultSchema,
          [
            new HumanMessage({
              content: scoreSectionSupportPrompt
                .replace("{researchBrief}", state.researchBrief)
                .replace(
                  "{preResearchPlan}",
                  stringifyForPrompt(
                    state.preResearchPlan ?? createFallbackPreResearchPlan(state),
                  ),
                )
                .replace("{reportPlan}", stringifyForPrompt(reportPlan))
                .replace("{rawFindings}", rawFindings)
                .replace("{compressedFindings}", compressedFindings)
                .replace("{date}", getTodayString()),
            }),
          ],
        );

      sectionSupport = response.sectionSupport;
    } catch {
      sectionSupport = reportPlan.sections.map((section) => ({
        key: section.key,
        support: state.notes.length > 0 ? "weak" : "missing",
        reason:
          state.notes.length > 0
            ? "Using fallback section scoring because the planner did not return structured support."
            : "No research findings were available for this section.",
        evidenceCount: state.notes.length > 0 ? 1 : 0,
        topSourceTier: extractSourceTier(rawFindings),
      }));
    }

    const normalizedSupport = enrichSectionSupportFromFindings(
      normalizeSectionSupport(reportPlan, sectionSupport),
      rawFindings,
    );

    await logEvent(
      state.runId,
      "validation",
      "section_support_completed",
      "Section support scoring completed.",
      {
        support: normalizedSupport.map((section) => ({
          key: section.key,
          support: section.support,
          evidenceCount: section.evidenceCount ?? 0,
          topSourceTier: section.topSourceTier ?? "unknown",
        })),
      },
    );

    return {
      sectionSupport: normalizedSupport,
    };
  };

  const extractEvidenceLedger = async (state: DeepResearchStateType) => {
    const reportPlan = state.reportPlan ?? createFallbackReportPlan(state);
    const rawFindings = truncateForPrompt(
      buildRawFindingsSummary(state),
      state.modelConfig.maxContentLength,
    );
    const compressedFindings = truncateForPrompt(
      buildCompressedFindingsSummary(state),
      Math.max(4000, Math.floor(state.modelConfig.maxContentLength * 0.6)),
    );

    await logEvent(
      state.runId,
      "validation",
      "evidence_extraction_started",
      "Extracting candidate evidence rows from research findings.",
    );

    let candidateRows: CandidateEvidenceRow[] = [];
    try {
      const response =
        await dependencies.models.invokeStructured<EvidenceExtractionResult>(
          "research",
          evidenceExtractionSchema,
          [
            new HumanMessage({
              content: extractEvidenceLedgerPrompt
                .replace("{researchBrief}", state.researchBrief)
                .replace(
                  "{preResearchPlan}",
                  stringifyForPrompt(
                    state.preResearchPlan ?? createFallbackPreResearchPlan(state),
                  ),
                )
                .replace("{reportPlan}", stringifyForPrompt(reportPlan))
                .replace("{rawFindings}", rawFindings)
                .replace("{compressedFindings}", compressedFindings)
                .replace("{date}", getTodayString()),
            }),
          ],
        );
      candidateRows = response.rows;
    } catch {
      candidateRows = [];
    }

    const evidenceRows: EvidenceRow[] = candidateRows.map((row) => ({
      ...row,
      id: crypto.randomUUID(),
    }));

    await logEvent(
      state.runId,
      "validation",
      "evidence_extraction_completed",
      "Candidate evidence rows extracted.",
      { evidenceRowCount: evidenceRows.length },
    );

    return {
      evidenceRows,
    };
  };

  const resolveEvidenceConflicts = async (state: DeepResearchStateType) => {
    const conflictingRows = state.evidenceRows.filter((row) => row.conflictGroup);
    if (conflictingRows.length === 0) {
      await logEvent(
        state.runId,
        "validation",
        "evidence_resolution_skipped",
        "No evidence conflicts required resolution.",
      );
      return {
        evidenceRows: state.evidenceRows,
        evidenceResolutions: [],
      };
    }

    await logEvent(
      state.runId,
      "validation",
      "evidence_resolution_started",
      "Resolving conflicts between candidate evidence rows.",
      { conflictGroupCount: new Set(conflictingRows.map((row) => row.conflictGroup)).size },
    );

    let evidenceResolutions: EvidenceResolution[] = [];
    try {
      const response =
        await dependencies.models.invokeStructured<EvidenceConflictResolutionResult>(
          "research",
          evidenceConflictResolutionSchema,
          [
            new HumanMessage({
              content: resolveEvidenceConflictsPrompt
                .replace("{evidenceRows}", stringifyForPrompt(state.evidenceRows))
                .replace("{date}", getTodayString()),
            }),
          ],
        );

      evidenceResolutions = response.resolutions.map((resolution) => ({
        id: crypto.randomUUID(),
        runId: state.runId,
        conflictGroup: resolution.conflictGroup,
        winningEvidenceRowIds: resolution.winningEvidenceRowIds,
        discardedEvidenceRowIds: resolution.discardedEvidenceRowIds,
        resolutionNote: resolution.resolutionNote,
        resolvedBy: resolution.resolvedBy,
        createdAt: new Date().toISOString(),
      }));
    } catch {
      evidenceResolutions = [];
    }

    await logEvent(
      state.runId,
      "validation",
      "evidence_resolution_completed",
      "Evidence conflict resolution completed.",
      { resolutionCount: evidenceResolutions.length },
    );

    return {
      evidenceRows: applyResolutionIds(state.evidenceRows, evidenceResolutions),
      evidenceResolutions,
    };
  };

  const validateEvidenceForFinal = async (state: DeepResearchStateType) => {
    const reportPlan = state.reportPlan ?? createFallbackReportPlan(state);

    await logEvent(
      state.runId,
      "validation",
      "evidence_validation_started",
      "Validating evidence rows for final report use.",
    );

    let validation: EvidenceValidationResult;
    try {
      validation =
        await dependencies.models.invokeStructured<EvidenceValidationResult>(
          "research",
          evidenceValidationSchema,
          [
            new HumanMessage({
              content: validateEvidenceForFinalPrompt
                .replace("{researchBrief}", state.researchBrief)
                .replace(
                  "{preResearchPlan}",
                  stringifyForPrompt(
                    state.preResearchPlan ?? createFallbackPreResearchPlan(state),
                  ),
                )
                .replace("{reportPlan}", stringifyForPrompt(reportPlan))
                .replace(
                  "{sectionSupport}",
                  stringifyForPrompt(state.sectionSupport),
                )
                .replace(
                  "{evidenceRows}",
                  stringifyForPrompt(state.evidenceRows),
                )
                .replace(
                  "{evidenceResolutions}",
                  stringifyForPrompt(state.evidenceResolutions),
                )
                .replace("{date}", getTodayString()),
            }),
          ],
        );
    } catch {
      validation = {
        allowedEvidenceRowIds: [],
        sectionSupport: state.sectionSupport,
        sectionEvidenceLinks: [],
      };
    }

    const validSectionKeys = new Set(
      reportPlan.sections.map((section) => section.key),
    );
    const validEvidenceIds = new Set(
      state.evidenceRows.map((row) => row.id),
    );
    const discardedEvidenceRowIds = new Set(
      state.evidenceResolutions.flatMap(
        (resolution) => resolution.discardedEvidenceRowIds,
      ),
    );
    const resolvedConflictGroups = new Set(
      state.evidenceResolutions.map((resolution) => resolution.conflictGroup),
    );
    const allowedEvidenceRowIds = new Set(
      validation.allowedEvidenceRowIds.filter((rowId) => !discardedEvidenceRowIds.has(rowId)),
    );
    const sectionSupport = enrichSectionSupportFromFindings(
      normalizeSectionSupport(reportPlan, validation.sectionSupport),
      buildRawFindingsSummary(state),
    );
    const sectionEvidenceLinks = validation.sectionEvidenceLinks.filter(
      (link) =>
        validSectionKeys.has(link.sectionKey) &&
        validEvidenceIds.has(link.evidenceRowId),
    );
    const evidenceRows = state.evidenceRows.map((row) => ({
      ...row,
      allowedForFinal:
        allowedEvidenceRowIds.has(row.id) &&
        (!row.conflictGroup || resolvedConflictGroups.has(row.conflictGroup)),
    }));

    await logEvent(
      state.runId,
      "validation",
      "evidence_validation_completed",
      "Evidence validation completed.",
      {
        allowedEvidenceRowCount: evidenceRows.filter((row) => row.allowedForFinal)
          .length,
        linkedSectionCount: new Set(
          sectionEvidenceLinks.map((link) => link.sectionKey),
        ).size,
      },
    );

    return {
      evidenceRows,
      sectionSupport,
      sectionEvidenceLinks,
    };
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
            preResearchPlan: state.preResearchPlan,
            reportPlan: state.reportPlan,
            researcherMessages: [
              new HumanMessage({
                content: buildResearchTaskInstruction(
                  topic,
                  state.preResearchPlan,
                  state.reportPlan,
                ),
              }),
            ],
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

    const reportPlan = state.reportPlan ?? createFallbackReportPlan(state);
    const sectionSupport = normalizeSectionSupport(
      reportPlan,
      state.sectionSupport,
    );
    const validatedEvidence = state.evidenceRows.filter(
      (row) => row.allowedForFinal,
    );
    let promptContent = finalReportGenerationPrompt
      .replace("{researchBrief}", state.researchBrief)
      .replace("{messages}", getBufferString(state.messages))
      .replace("{date}", getTodayString())
      .replace(
        "{preResearchPlan}",
        stringifyForPrompt(
          state.preResearchPlan ?? createFallbackPreResearchPlan(state),
        ),
      )
      .replace("{reportPlan}", stringifyForPrompt(reportPlan))
      .replace("{sectionSupport}", stringifyForPrompt(sectionSupport))
      .replace(
        "{validatedEvidence}",
        stringifyForPrompt(validatedEvidence),
      )
      .replace(
        "{sectionEvidenceLinks}",
        stringifyForPrompt(state.sectionEvidenceLinks),
      );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await dependencies.models.invokeText("finalReport", [
          new HumanMessage({
            content: promptContent,
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

        promptContent = promptContent.slice(
          0,
          Math.floor(promptContent.length * 0.85),
        );
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
      ends: ["planResearch"],
    })
    .addNode("planResearch", planResearch)
    .addNode("buildReportPlan", buildReportPlan)
    .addNode("researchSupervisor", supervisorSubgraph)
    .addNode("scoreSectionSupport", scoreSectionSupport)
    .addNode("extractEvidenceLedger", extractEvidenceLedger)
    .addNode("resolveEvidenceConflicts", resolveEvidenceConflicts)
    .addNode("validateEvidenceForFinal", validateEvidenceForFinal)
    .addNode("finalReportGeneration", finalReportGeneration)
    .addEdge(START, "clarifyWithUser")
    .addEdge("planResearch", "buildReportPlan")
    .addEdge("buildReportPlan", "researchSupervisor")
    .addEdge("researchSupervisor", "scoreSectionSupport")
    .addEdge("scoreSectionSupport", "extractEvidenceLedger")
    .addEdge("extractEvidenceLedger", "resolveEvidenceConflicts")
    .addEdge("resolveEvidenceConflicts", "validateEvidenceForFinal")
    .addEdge("validateEvidenceForFinal", "finalReportGeneration")
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

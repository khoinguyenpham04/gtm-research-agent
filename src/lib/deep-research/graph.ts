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
  parseSearchToolEnvelope,
} from "@/lib/deep-research/tools";
import {
  getSourceTierRank,
  inferSourceTierFromText,
} from "@/lib/deep-research/source-tier";
import type {
  AnchoredFact,
  CandidateEvidenceRow,
  ClarificationInterrupt,
  ClarifyWithUserResult,
  CoverageBoardEntry,
  GapFillStats,
  GtmCoverageCategoryKey,
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
  SectionEvidencePack,
  SectionEvidenceLink,
  SectionPackFact,
  SectionSupport,
  SectionSupportResult,
} from "@/lib/deep-research/types";
import {
  anchoredFactSchema,
  clarifyWithUserSchema,
  coverageBoardEntrySchema,
  evidenceConflictResolutionSchema,
  evidenceExtractionSchema,
  evidenceValidationSchema,
  gapFillStatsSchema,
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
  coverageBoard: createReplaceListAnnotation<CoverageBoardEntry>(),
  anchoredFacts: createReplaceListAnnotation<AnchoredFact>(),
  sectionSupport: createReplaceListAnnotation<SectionSupport>(),
  evidenceRows: createReplaceListAnnotation<EvidenceRow>(),
  evidenceResolutions: createReplaceListAnnotation<EvidenceResolution>(),
  sectionEvidenceLinks: createReplaceListAnnotation<SectionEvidenceLink>(),
  sectionEvidencePacks: createReplaceListAnnotation<SectionEvidencePack>(),
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
  coverageBoard: createReplaceListAnnotation<CoverageBoardEntry>(),
  anchoredFacts: createReplaceListAnnotation<AnchoredFact>(),
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
  coverageBoard: createReplaceListAnnotation<CoverageBoardEntry>(),
  anchoredFacts: createReplaceListAnnotation<AnchoredFact>(),
  gapFillStats: Annotation<GapFillStats>({
    reducer: (_current, update) => update,
    default: () =>
      gapFillStatsSchema.parse({
        totalAttempts: 0,
        attemptsByCategory: {
          market_size_inputs: 0,
          adoption: 0,
          buyers: 0,
          competitors_pricing: 0,
          compliance: 0,
          recommendations: 0,
        },
      }),
  }),
  pendingGapFillCategories: Annotation<GtmCoverageCategoryKey[]>({
    reducer: (_current, update) => update,
    default: () => [],
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
  return inferSourceTierFromText(content);
}

export function isUploadedDocument(
  row: Pick<AnchoredFact | EvidenceRow, "sourceType" | "documentId">,
) {
  return row.sourceType === "uploaded_document" || Boolean(row.documentId);
}

const GTM_COVERAGE_CATEGORIES: GtmCoverageCategoryKey[] = [
  "market_size_inputs",
  "adoption",
  "buyers",
  "competitors_pricing",
  "compliance",
  "recommendations",
];

const GAP_FILL_ELIGIBLE_GTM_CATEGORIES: GtmCoverageCategoryKey[] =
  GTM_COVERAGE_CATEGORIES.filter((category) => category !== "recommendations");

const RECOMMENDATION_SUPPORT_CATEGORIES: GtmCoverageCategoryKey[] = [
  "market_size_inputs",
  "adoption",
  "buyers",
  "competitors_pricing",
  "compliance",
];

const GTM_SECTION_CATEGORY_MAP: Partial<
  Record<string, GtmCoverageCategoryKey[]>
> = {
  executive_summary: GTM_COVERAGE_CATEGORIES,
  market_sizing_scenarios: ["market_size_inputs"],
  market_opportunity: ["market_size_inputs"],
  buyers_and_adoption: ["adoption", "buyers"],
  competition_and_pricing: ["competitors_pricing"],
  competitors: ["competitors_pricing"],
  compliance_constraints: ["compliance"],
  recommendations: ["recommendations"],
};

const GENERAL_SECTION_CATEGORY_MAP: Partial<
  Record<string, GtmCoverageCategoryKey[]>
> = {
  summary: GTM_COVERAGE_CATEGORIES,
  key_findings: GTM_COVERAGE_CATEGORIES,
};

const ANCHORED_FACT_STRENGTH_RANK: Record<AnchoredFact["strength"], number> = {
  weak: 0,
  moderate: 1,
  strong: 2,
};

const GTM_CATEGORY_KEYWORDS: Record<GtmCoverageCategoryKey, string[]> = {
  market_size_inputs: [
    "tam",
    "sam",
    "som",
    "market size",
    "market sizing",
    "market opportunity",
    "business population",
    "size band",
    "smb count",
    "number of businesses",
  ],
  adoption: [
    "adoption",
    "uptake",
    "usage",
    "demand",
    "buyer intent",
    "readiness",
    "ai adoption",
  ],
  buyers: [
    "buyer",
    "buyers",
    "segment",
    "segments",
    "icp",
    "persona",
    "customer profile",
    "sales leader",
    "revops",
    "pain point",
    "pain points",
  ],
  competitors_pricing: [
    "competitor",
    "competitors",
    "pricing",
    "price",
    "cost",
    "vendor",
    "alternative",
    "feature",
    "positioning",
    "otter",
    "fireflies",
    "avoma",
    "fathom",
    "copilot",
  ],
  compliance: [
    "gdpr",
    "data protection",
    "privacy",
    "compliance",
    "regulation",
    "regulatory",
    "ico",
    "lawful basis",
    "consent",
    "dpa",
    "recording",
    "dpa 2018",
    "dpia",
  ],
  recommendations: [
    "recommendation",
    "recommendations",
    "go-to-market",
    "go to market",
    "gtm",
    "channel",
    "launch",
    "pilot",
    "next step",
    "strategy",
  ],
};

function isGtmMode(mode: string | undefined) {
  return mode === "gtm";
}

function createInitialGapFillStats(): GapFillStats {
  return gapFillStatsSchema.parse({
    totalAttempts: 0,
    attemptsByCategory: {
      market_size_inputs: 0,
      adoption: 0,
      buyers: 0,
      competitors_pricing: 0,
      compliance: 0,
      recommendations: 0,
    },
  });
}

export function createInitialCoverageBoard(): CoverageBoardEntry[] {
  return GTM_COVERAGE_CATEGORIES.map((key) =>
    coverageBoardEntrySchema.parse({
      key,
      status: "missing",
      documentHits: 0,
      webHits: 0,
      sourceTiersSeen: [],
      notes: [],
      gapFillAttempts: 0,
    }),
  );
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractFirstSentence(text: string, maxLength = 240) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return "";
  }

  const firstSentence = normalized.split(/(?<=[.!?])\s+/)[0] ?? normalized;
  const trimmed = firstSentence.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength).trim()}...`;
}

function parseNumericValue(text: string) {
  const match = text.match(/(?:£|\$|€)?\s?(\d+(?:\.\d+)?)(?:\s?(%|percent|million|billion|m|bn|k))?/i);
  if (!match) {
    return {};
  }

  return {
    numericValue: Number(match[1]),
    unit: match[2]?.toLowerCase(),
  };
}

function parseTimeframe(text: string) {
  const match = text.match(/\b(20\d{2}|19\d{2})\b/);
  return match?.[1];
}

const MARKET_SIZE_INPUT_KEYWORDS = [
  "market size",
  "market sizing",
  "business population",
  "number of businesses",
  "private sector businesses",
  "business count",
  "population estimates",
  "sme employers",
  "size band",
  "employee band",
  "employees",
  "employers",
  "employment",
  "market opportunity",
] as const;

const MARKET_SIZE_CONTEXT_KEYWORDS = [
  "microbusiness",
  "microbusinesses",
  "small business",
  "medium business",
  "employee band",
  "size band",
  "employment",
  "business population",
  "number of businesses",
] as const;

const ADOPTION_KEYWORDS = [
  "adoption",
  "adopted",
  "using",
  "use of ai",
  "use ai",
  "uptake",
  "usage",
  "readiness",
  "buyer intent",
  "demand",
  "demand signals",
  "pilot",
  "implemented ai",
] as const;

const BUYER_KEYWORDS = [
  "buyer",
  "buyers",
  "persona",
  "segment",
  "segments",
  "icp",
  "ideal customer",
  "sales manager",
  "sales leader",
  "revops",
  "revenue operations",
  "business owner",
  "workflow",
  "pain point",
  "pain points",
  "digital maturity",
] as const;

const COMPETITOR_PRICING_KEYWORDS = [
  "competitor",
  "competitors",
  "pricing",
  "price",
  "per seat",
  "tier",
  "plan",
  "plans",
  "feature comparison",
  "compare",
  "comparison",
  "alternative",
  "alternatives",
  "positioning",
  "feature set",
] as const;

const COMPLIANCE_KEYWORDS = [
  "gdpr",
  "privacy",
  "data protection",
  "consent",
  "lawful basis",
  "ico",
  "regulation",
  "regulatory",
  "compliance",
  "data residency",
  "recording",
  "transcription",
  "ai act",
  "dpia",
  "dpa 2018",
] as const;

const RECOMMENDATION_KEYWORDS = [
  "recommendation",
  "recommendations",
  "should",
  "focus on",
  "go-to-market",
  "go to market",
  "gtm",
  "launch",
  "pilot",
  "next step",
  "strategy",
  "channel",
  "partner",
  "prioritize",
] as const;

function normalizeEvidenceSignal(...values: Array<string | undefined>) {
  return normalizeWhitespace(values.filter(Boolean).join(" ").toLowerCase());
}

function hasKeywordMatch(content: string, keywords: readonly string[]) {
  return keywords.some((keyword) => content.includes(keyword));
}

function inferTargetCategoriesFromText(
  input: string,
): GtmCoverageCategoryKey[] {
  const normalized = input.toLowerCase();
  const categories = GTM_COVERAGE_CATEGORIES.filter((category) =>
    GTM_CATEGORY_KEYWORDS[category].some((keyword) =>
      normalized.includes(keyword),
    ),
  );

  if (categories.length > 0) {
    return categories;
  }

  if (normalized.includes("sales") || normalized.includes("meeting")) {
    return ["buyers", "adoption"];
  }

  return [];
}

function inferClaimTypeFromEvidence(
  normalizedEvidence: string,
  targetCategoryKeys: GtmCoverageCategoryKey[],
): AnchoredFact["claimType"] {
  if (hasKeywordMatch(normalizedEvidence, COMPLIANCE_KEYWORDS)) {
    return "compliance";
  }
  if (hasKeywordMatch(normalizedEvidence, COMPETITOR_PRICING_KEYWORDS)) {
    return /\b(price|pricing|cost|plan|tier|seat)\b/i.test(normalizedEvidence)
      ? "pricing_signal"
      : "competitor_fact";
  }
  if (hasKeywordMatch(normalizedEvidence, RECOMMENDATION_KEYWORDS)) {
    return "recommendation";
  }
  if (/\brisk|constraint|blocker\b/i.test(normalizedEvidence)) {
    return "risk";
  }
  if (
    hasKeywordMatch(normalizedEvidence, MARKET_SIZE_INPUT_KEYWORDS) ||
    hasKeywordMatch(normalizedEvidence, ADOPTION_KEYWORDS) ||
    targetCategoryKeys.includes("market_size_inputs") ||
    targetCategoryKeys.includes("adoption")
  ) {
    return "market_stat";
  }

  return "qualitative_insight";
}

function inferEvidenceCategoriesFromFact(
  normalizedEvidence: string,
  claimType: AnchoredFact["claimType"],
  numericValue?: number,
): GtmCoverageCategoryKey[] {
  const evidenceCategories: GtmCoverageCategoryKey[] = [];
  const hasExplicitMarketSizingSignal = hasKeywordMatch(
    normalizedEvidence,
    MARKET_SIZE_INPUT_KEYWORDS,
  );
  const hasMarketSizingContext =
    hasExplicitMarketSizingSignal ||
    hasKeywordMatch(normalizedEvidence, MARKET_SIZE_CONTEXT_KEYWORDS);
  const hasAdoptionContext = hasKeywordMatch(normalizedEvidence, ADOPTION_KEYWORDS);
  const hasBuyerContext = hasKeywordMatch(normalizedEvidence, BUYER_KEYWORDS);
  const hasCompetitorPricingContext = hasKeywordMatch(
    normalizedEvidence,
    COMPETITOR_PRICING_KEYWORDS,
  );
  const hasComplianceContext = hasKeywordMatch(
    normalizedEvidence,
    COMPLIANCE_KEYWORDS,
  );
  const hasRecommendationContext = hasKeywordMatch(
    normalizedEvidence,
    RECOMMENDATION_KEYWORDS,
  );
  const hasSizingInput =
    hasExplicitMarketSizingSignal &&
    (typeof numericValue === "number" ||
      normalizedEvidence.includes("prevalence") ||
      normalizedEvidence.includes("share") ||
      normalizedEvidence.includes("rate"));

  if (
    hasSizingInput ||
    (claimType === "market_stat" &&
      hasMarketSizingContext &&
      !hasAdoptionContext)
  ) {
    evidenceCategories.push("market_size_inputs");
  } else if (hasMarketSizingContext) {
    evidenceCategories.push("market_size_inputs");
  }

  if (hasAdoptionContext) {
    evidenceCategories.push("adoption");
  }

  if (hasBuyerContext) {
    evidenceCategories.push("buyers");
  }

  if (
    hasCompetitorPricingContext &&
    (claimType === "pricing_signal" || claimType === "competitor_fact")
  ) {
    evidenceCategories.push("competitors_pricing");
  }

  if (
    hasComplianceContext &&
    (claimType === "compliance" || claimType === "risk")
  ) {
    evidenceCategories.push("compliance");
  }

  if (hasRecommendationContext && claimType === "recommendation") {
    evidenceCategories.push("recommendations");
  }

  return [...new Set(evidenceCategories)];
}

function inferAnchoredFactStrength(
  sourceTier: AnchoredFact["sourceTier"],
  similarity?: number,
): AnchoredFact["strength"] {
  if (typeof similarity === "number") {
    if (similarity >= 0.4) {
      return "strong";
    }
    if (similarity >= 0.2) {
      return "moderate";
    }
    return "weak";
  }

  if (sourceTier === "selected_document" || sourceTier === "primary") {
    return "strong";
  }
  if (sourceTier === "analyst" || sourceTier === "trade_press") {
    return "moderate";
  }

  return "weak";
}

function mergeCategoryKeys(
  current: GtmCoverageCategoryKey[],
  incoming: GtmCoverageCategoryKey[],
) {
  return [...new Set([...current, ...incoming])];
}

function mergeAnchoredFacts(
  existingFacts: AnchoredFact[],
  incomingFacts: AnchoredFact[],
) {
  const merged = new Map(existingFacts.map((fact) => [fact.id, fact]));

  incomingFacts.forEach((fact) => {
    const existing = merged.get(fact.id);
    if (!existing) {
      merged.set(fact.id, fact);
      return;
    }

    const keepIncoming =
      ANCHORED_FACT_STRENGTH_RANK[fact.strength] >
      ANCHORED_FACT_STRENGTH_RANK[existing.strength];

    merged.set(fact.id, {
      ...(keepIncoming ? existing : fact),
      ...(keepIncoming ? fact : existing),
      targetCategoryKeys: mergeCategoryKeys(
        existing.targetCategoryKeys,
        fact.targetCategoryKeys,
      ),
      evidenceCategoryKeys: mergeCategoryKeys(
        existing.evidenceCategoryKeys,
        fact.evidenceCategoryKeys,
      ),
      strength:
        ANCHORED_FACT_STRENGTH_RANK[fact.strength] >=
        ANCHORED_FACT_STRENGTH_RANK[existing.strength]
          ? fact.strength
          : existing.strength,
      sourceTitle: existing.sourceTitle ?? fact.sourceTitle,
      sourceUrl: existing.sourceUrl ?? fact.sourceUrl,
      documentId: existing.documentId ?? fact.documentId,
      chunkIndex: existing.chunkIndex ?? fact.chunkIndex,
      statement:
        keepIncoming && fact.statement.length >= existing.statement.length
          ? fact.statement
          : existing.statement,
      numericValue: existing.numericValue ?? fact.numericValue,
      unit: existing.unit ?? fact.unit,
      timeframe: existing.timeframe ?? fact.timeframe,
      entity: existing.entity ?? fact.entity,
    });
  });

  return Array.from(merged.values());
}

export function buildDocumentAnchoredFacts(
  queries: string[],
  matches: Array<{
    id: number;
    excerpt: string;
    similarity: number;
    documentId?: string;
    chunkIndex?: number;
    fileName?: string;
    fileUrl?: string;
  }>,
): AnchoredFact[] {
  return matches
    .map((match) => {
      const statement = extractFirstSentence(match.excerpt);
      if (!statement) {
        return null;
      }

      const targetCategoryKeys = inferTargetCategoriesFromText(queries.join(" "));
      const key =
        match.documentId && typeof match.chunkIndex === "number"
          ? `doc:${match.documentId}:${match.chunkIndex}`
          : `doc:unknown:${match.id}`;
      const numeric = parseNumericValue(statement);
      const normalizedEvidence = normalizeEvidenceSignal(
        statement,
        match.fileName,
      );
      const claimType = inferClaimTypeFromEvidence(
        normalizedEvidence,
        targetCategoryKeys,
      );
      const evidenceCategoryKeys = inferEvidenceCategoriesFromFact(
        normalizedEvidence,
        claimType,
        numeric.numericValue,
      );

      return anchoredFactSchema.parse({
        id: key,
        statement,
        claimType,
        sourceType: "uploaded_document",
        sourceTier: "selected_document",
        sourceTitle: match.fileName,
        sourceUrl: match.fileUrl,
        documentId: match.documentId,
        chunkIndex: match.chunkIndex,
        targetCategoryKeys,
        evidenceCategoryKeys,
        ...numeric,
        timeframe: parseTimeframe(statement),
        entity: match.fileName,
        strength: inferAnchoredFactStrength(
          "selected_document",
          match.similarity,
        ),
      });
    })
    .filter((fact): fact is AnchoredFact => Boolean(fact));
}

export function buildWebAnchoredFacts(
  queries: string[],
  results: Array<{
    title: string;
    url: string;
    excerpt: string;
    sourceTier: AnchoredFact["sourceTier"];
  }>,
): AnchoredFact[] {
  return results
    .map((result) => {
      const statement = extractFirstSentence(
        [result.title, result.excerpt].filter(Boolean).join(": "),
      );
      if (!statement) {
        return null;
      }

      const targetCategoryKeys = inferTargetCategoriesFromText(queries.join(" "));
      const numeric = parseNumericValue(statement);
      const normalizedEvidence = normalizeEvidenceSignal(
        statement,
        result.title,
        result.url,
      );
      const claimType = inferClaimTypeFromEvidence(
        normalizedEvidence,
        targetCategoryKeys,
      );
      const evidenceCategoryKeys = inferEvidenceCategoriesFromFact(
        normalizedEvidence,
        claimType,
        numeric.numericValue,
      );

      return anchoredFactSchema.parse({
        id: `web:${result.url}`,
        statement,
        claimType,
        sourceType: "web",
        sourceTier: result.sourceTier,
        sourceTitle: result.title,
        sourceUrl: result.url,
        targetCategoryKeys,
        evidenceCategoryKeys,
        ...numeric,
        timeframe: parseTimeframe(statement),
        entity: result.title,
        strength: inferAnchoredFactStrength(result.sourceTier),
      });
    })
    .filter((fact): fact is AnchoredFact => Boolean(fact));
}

export function recomputeCoverageBoard(
  anchoredFacts: AnchoredFact[],
  gapFillStats: GapFillStats,
  budgets: DeepResearchBudgets,
  pendingGapFillCategories: GtmCoverageCategoryKey[] = [],
): CoverageBoardEntry[] {
  const nonRecommendationFacts = anchoredFacts.filter(
    (fact) => !fact.evidenceCategoryKeys.includes("recommendations"),
  );

  return GTM_COVERAGE_CATEGORIES.map((key) => {
    const matchingFacts = anchoredFacts.filter((fact) =>
      fact.evidenceCategoryKeys.includes(key),
    );
    const documentHits = matchingFacts.filter((fact) =>
      isUploadedDocument(fact),
    ).length;
    const webHits = matchingFacts.length - documentHits;
    const sourceTiersSeen = [...new Set(matchingFacts.map((fact) => fact.sourceTier))]
      .sort((left, right) => getSourceTierRank(left) - getSourceTierRank(right));
    const notes: string[] = [];
    const gapFillAttempts = gapFillStats.attemptsByCategory[key];
    const hasHighQuality = matchingFacts.some(
      (fact) =>
        fact.sourceTier === "selected_document" ||
        fact.sourceTier === "primary",
    );
    const hasUsableMarketSizingInput = matchingFacts.some(
      (fact) =>
        fact.claimType === "market_stat" &&
        (typeof fact.numericValue === "number" ||
          normalizeEvidenceSignal(fact.statement, fact.sourceTitle).includes(
            "prevalence",
          ) ||
          normalizeEvidenceSignal(fact.statement, fact.sourceTitle).includes(
            "share",
          ) ||
          normalizeEvidenceSignal(fact.statement, fact.sourceTitle).includes(
            "rate",
          )),
    );
    const hasCompetitorOrPricingFact = matchingFacts.some(
      (fact) =>
        fact.claimType === "competitor_fact" ||
        fact.claimType === "pricing_signal",
    );
    const hasComplianceFact = matchingFacts.some(
      (fact) =>
        fact.claimType === "compliance" || fact.claimType === "risk",
    );
    const isPending = pendingGapFillCategories.includes(key);
    let status: CoverageBoardEntry["status"] = "missing";

    if (key === "recommendations") {
      if (matchingFacts.length > 0) {
        status = "anchored";
      } else if (nonRecommendationFacts.length > 0) {
        status = "partial";
        notes.push(
          "Recommendations are currently derived indirectly from other covered categories.",
        );
      } else {
        status = "missing";
      }
    } else if (key === "market_size_inputs") {
      if (hasUsableMarketSizingInput) {
        status = "anchored";
      } else if (matchingFacts.length >= 1) {
        status = "partial";
        notes.push(
          "Market context exists, but there are not yet enough usable sizing inputs for this category.",
        );
      }
    } else if (key === "adoption") {
      if (
        matchingFacts.length >= 2 ||
        (matchingFacts.length >= 1 && hasHighQuality)
      ) {
        status = "anchored";
      } else if (matchingFacts.length >= 1) {
        status = "partial";
        notes.push("Only limited adoption evidence has been gathered so far.");
      }
    } else if (key === "buyers") {
      if (
        matchingFacts.length >= 2 ||
        (matchingFacts.length >= 1 && hasHighQuality)
      ) {
        status = "anchored";
      } else if (matchingFacts.length >= 1) {
        status = "partial";
        notes.push("Buyer or segment evidence exists, but it remains limited.");
      }
    } else if (key === "competitors_pricing") {
      if (
        hasCompetitorOrPricingFact &&
        (matchingFacts.length >= 2 || hasHighQuality)
      ) {
        status = "anchored";
      } else if (hasCompetitorOrPricingFact) {
        status = "partial";
        notes.push(
          "Some competitor or pricing evidence exists, but not enough to treat the category as covered.",
        );
      }
    } else if (key === "compliance") {
      if (hasComplianceFact && hasHighQuality) {
        status = "anchored";
      } else if (hasComplianceFact) {
        status = "partial";
        notes.push(
          "Compliance evidence exists, but it needs stronger regulator or document-backed support.",
        );
      }
    } else if (
      !isPending &&
      gapFillAttempts >= budgets.maxTargetedWebGapFillAttemptsPerCategory
    ) {
      status = "exhausted";
      notes.push(
        "A targeted web gap-fill attempt was already used for this category without finding enough evidence.",
      );
    } else {
      status = "missing";
    }

    if (isPending) {
      notes.push("A targeted web gap-fill attempt is in progress for this category.");
    }

    return coverageBoardEntrySchema.parse({
      key,
      status,
      documentHits,
      webHits,
      sourceTiersSeen,
      notes,
      gapFillAttempts,
    });
  });
}

function createCoverageBoardSnapshot(board: CoverageBoardEntry[]) {
  return board.map((entry) => ({
    key: entry.key,
    status: entry.status,
    documentHits: entry.documentHits,
    webHits: entry.webHits,
    gapFillAttempts: entry.gapFillAttempts,
  }));
}

export function selectGapFillCategories(
  coverageBoard: CoverageBoardEntry[],
  gapFillStats: GapFillStats,
  budgets: DeepResearchBudgets,
) {
  const remainingRunBudget =
    budgets.maxTargetedWebGapFillAttemptsPerRun - gapFillStats.totalAttempts;
  if (remainingRunBudget <= 0) {
    return [] as GtmCoverageCategoryKey[];
  }

  const categories = coverageBoard
    .filter((entry) => GAP_FILL_ELIGIBLE_GTM_CATEGORIES.includes(entry.key))
    .filter(
      (entry) =>
        (entry.status === "missing" || entry.status === "partial") &&
        entry.gapFillAttempts < budgets.maxTargetedWebGapFillAttemptsPerCategory,
    )
    .sort((left, right) => {
      if (left.status !== right.status) {
        return left.status === "missing" ? -1 : 1;
      }
      return left.key.localeCompare(right.key);
    })
    .slice(0, remainingRunBudget)
    .map((entry) => entry.key);

  return categories;
}

function incrementGapFillStats(
  current: GapFillStats,
  categories: GtmCoverageCategoryKey[],
) {
  const next: GapFillStats = {
    totalAttempts: current.totalAttempts,
    attemptsByCategory: {
      ...current.attemptsByCategory,
    },
  };

  categories.forEach((category) => {
    next.attemptsByCategory[category] += 1;
    next.totalAttempts += 1;
  });

  return gapFillStatsSchema.parse(next);
}

function buildGapFillQueries(
  topic: string,
  categories: GtmCoverageCategoryKey[],
) {
  const normalizedTopic = normalizeWhitespace(topic);
  const queries = categories.flatMap((category) => {
    switch (category) {
      case "market_size_inputs":
        return [
          `${normalizedTopic} UK SMB market size inputs business population sales teams`,
        ];
      case "adoption":
        return [
          `${normalizedTopic} UK adoption demand AI meeting assistant SMB sales teams`,
        ];
      case "buyers":
        return [
          `${normalizedTopic} UK SMB sales teams buyer segments personas pain points`,
        ];
      case "competitors_pricing":
        return [
          `${normalizedTopic} UK AI meeting assistant competitors pricing SMB sales`,
        ];
      case "compliance":
        return [
          `${normalizedTopic} UK GDPR meeting recording transcription AI compliance`,
        ];
      case "recommendations":
        return [];
      default:
        return [];
    }
  });

  return [...new Set(queries)];
}

function buildGapFillControlMessage(
  topic: string,
  categories: GtmCoverageCategoryKey[],
) {
  const queries = buildGapFillQueries(topic, categories);
  return new HumanMessage({
    content: [
      "Coverage is still incomplete for this GTM research task.",
      `Missing or weak categories: ${categories.join(", ")}.`,
      "Run one targeted tavilySearch next using the following focused queries before calling ResearchComplete again:",
      ...queries.map((query, index) => `${index + 1}. ${query}`),
      "After the Tavily search, record a reflection with thinkTool and only then decide whether research is complete.",
    ].join("\n"),
  });
}

function shouldLogCoverageUpdate(
  previous: CoverageBoardEntry[],
  next: CoverageBoardEntry[],
) {
  return (
    JSON.stringify(createCoverageBoardSnapshot(previous)) !==
    JSON.stringify(createCoverageBoardSnapshot(next))
  );
}

function summarizeAnchoredFacts(anchoredFacts: AnchoredFact[]) {
  const bySourceType = anchoredFacts.reduce<Record<string, number>>(
    (accumulator, fact) => {
      accumulator[fact.sourceType] = (accumulator[fact.sourceType] ?? 0) + 1;
      return accumulator;
    },
    {},
  );

  const byCategory = GTM_COVERAGE_CATEGORIES.reduce<Record<string, number>>(
    (accumulator, category) => {
      accumulator[category] = anchoredFacts.filter((fact) =>
        fact.evidenceCategoryKeys.includes(category),
      ).length;
      return accumulator;
    },
    {},
  );

  const byTargetCategory = GTM_COVERAGE_CATEGORIES.reduce<Record<string, number>>(
    (accumulator, category) => {
      accumulator[category] = anchoredFacts.filter((fact) =>
        fact.targetCategoryKeys.includes(category),
      ).length;
      return accumulator;
    },
    {},
  );

  return {
    total: anchoredFacts.length,
    bySourceType,
    byCategory,
    byTargetCategory,
  };
}

function includesNormalizedValue(base: string, value: string) {
  return base.toLowerCase().includes(value.toLowerCase());
}

function buildFactStatement(row: EvidenceRow) {
  const details: string[] = [];
  const valueWithUnit = row.unit ? `${row.value} ${row.unit}`.trim() : row.value;

  if (valueWithUnit && !includesNormalizedValue(row.claim, valueWithUnit)) {
    details.push(valueWithUnit);
  }

  if (row.entity && !includesNormalizedValue(row.claim, row.entity)) {
    details.push(`Entity: ${row.entity}`);
  }

  if (row.timeframe && !includesNormalizedValue(row.claim, row.timeframe)) {
    details.push(`Timeframe: ${row.timeframe}`);
  }

  return details.length > 0
    ? `${row.claim} (${details.join("; ")})`
    : row.claim;
}

function buildSectionPackFact(row: EvidenceRow): SectionPackFact {
  return {
    statement: buildFactStatement(row),
    factOrigin: "validated_evidence",
    evidenceRowIds: [row.id],
    anchoredFactIds: [],
    sourceTier: row.sourceTier,
    sourceType: row.sourceType,
    sourceTitle: row.sourceTitle,
    sourceUrl: row.sourceUrl,
    documentId: row.documentId,
    chunkIndex: row.chunkIndex,
  };
}

function buildAnchoredFactStatement(fact: AnchoredFact) {
  const details: string[] = [];
  const valueWithUnit =
    typeof fact.numericValue === "number"
      ? fact.unit
        ? `${fact.numericValue} ${fact.unit}`.trim()
        : String(fact.numericValue)
      : undefined;

  if (valueWithUnit && !includesNormalizedValue(fact.statement, valueWithUnit)) {
    details.push(valueWithUnit);
  }

  if (fact.timeframe && !includesNormalizedValue(fact.statement, fact.timeframe)) {
    details.push(`Timeframe: ${fact.timeframe}`);
  }

  if (fact.entity && !includesNormalizedValue(fact.statement, fact.entity)) {
    details.push(`Entity: ${fact.entity}`);
  }

  return details.length > 0
    ? `${fact.statement} (${details.join("; ")})`
    : fact.statement;
}

function buildSectionPackFactFromAnchoredFact(
  fact: AnchoredFact,
): SectionPackFact {
  return {
    statement: buildAnchoredFactStatement(fact),
    factOrigin: "anchored_fact",
    evidenceRowIds: [],
    anchoredFactIds: [fact.id],
    sourceTier: fact.sourceTier,
    sourceType: fact.sourceType,
    sourceTitle: fact.sourceTitle,
    sourceUrl: fact.sourceUrl,
    documentId: fact.documentId,
    chunkIndex: fact.chunkIndex,
  };
}

function createDefaultSectionGap(sectionKey: string) {
  return `No validated evidence was linked to the "${sectionKey}" section.`;
}

function getAnchoredFactsForSection(
  sectionKey: string,
  reportMode: ReportPlan["mode"],
  anchoredFacts: AnchoredFact[],
) {
  if (anchoredFacts.length === 0) {
    return [] as AnchoredFact[];
  }

  const categories: GtmCoverageCategoryKey[] =
    reportMode === "gtm"
      ? GTM_SECTION_CATEGORY_MAP[sectionKey] ?? []
      : GENERAL_SECTION_CATEGORY_MAP[sectionKey] ?? [];

  const rankedFacts = anchoredFacts
    .filter((fact) =>
      categories.length === 0
        ? false
        : fact.evidenceCategoryKeys.some((category) =>
            categories.includes(category),
          ),
    )
    .sort((left, right) => {
      const tierDelta =
        getSourceTierRank(left.sourceTier) - getSourceTierRank(right.sourceTier);
      if (tierDelta !== 0) {
        return tierDelta;
      }

      const uploadedDelta =
        Number(isUploadedDocument(right)) - Number(isUploadedDocument(left));
      if (uploadedDelta !== 0) {
        return uploadedDelta;
      }

      const strengthDelta =
        ANCHORED_FACT_STRENGTH_RANK[right.strength] -
        ANCHORED_FACT_STRENGTH_RANK[left.strength];
      if (strengthDelta !== 0) {
        return strengthDelta;
      }

      return left.id.localeCompare(right.id);
    });

  if (sectionKey === "recommendations" && rankedFacts.length === 0) {
    return anchoredFacts
      .filter((fact) =>
        fact.evidenceCategoryKeys.some((category) =>
          RECOMMENDATION_SUPPORT_CATEGORIES.includes(category),
        ),
      )
      .slice(0, 2);
  }

  return rankedFacts;
}

export function buildSectionEvidencePacksFromArtifacts(
  reportPlan: ReportPlan,
  sectionSupport: SectionSupport[],
  evidenceRows: EvidenceRow[],
  sectionEvidenceLinks: SectionEvidenceLink[],
  options?: {
    anchoredFacts?: AnchoredFact[];
    coverageBoard?: CoverageBoardEntry[];
  },
): SectionEvidencePack[] {
  const normalizedSupport = normalizeSectionSupport(reportPlan, sectionSupport);
  const supportByKey = new Map(
    normalizedSupport.map((section) => [section.key, section]),
  );
  const allowedRowById = new Map(
    evidenceRows
      .filter((row) => row.allowedForFinal)
      .map((row) => [row.id, row]),
  );
  const firstLinkIndexBySectionAndRow = new Map<string, number>();

  sectionEvidenceLinks.forEach((link, index) => {
    const key = `${link.sectionKey}::${link.evidenceRowId}`;
    if (!firstLinkIndexBySectionAndRow.has(key)) {
      firstLinkIndexBySectionAndRow.set(key, index);
    }
  });

  return reportPlan.sections.map((section) => {
    const support = supportByKey.get(section.key) ?? {
      key: section.key,
      support: "missing" as const,
      reason: "No support assessment was generated for this section.",
    };

    const candidateRows = sectionEvidenceLinks
      .filter((link) => link.sectionKey === section.key)
      .map((link) => ({
        row: allowedRowById.get(link.evidenceRowId),
        originalIndex:
          firstLinkIndexBySectionAndRow.get(
            `${link.sectionKey}::${link.evidenceRowId}`,
          ) ?? Number.MAX_SAFE_INTEGER,
      }))
      .filter(
        (
          item,
        ): item is {
          row: EvidenceRow;
          originalIndex: number;
        } => Boolean(item.row),
      );

    const dedupedRows = new Map<
      string,
      {
        row: EvidenceRow;
        originalIndex: number;
      }
    >();

    candidateRows.forEach((item) => {
      if (!dedupedRows.has(item.row.id)) {
        dedupedRows.set(item.row.id, item);
      }
    });

    const rankedRows = [...dedupedRows.values()]
      .sort((left, right) => {
        const tierDelta =
          getSourceTierRank(left.row.sourceTier) -
          getSourceTierRank(right.row.sourceTier);
        if (tierDelta !== 0) {
          return tierDelta;
        }

        const uploadedDelta =
          Number(isUploadedDocument(right.row)) -
          Number(isUploadedDocument(left.row));
        if (uploadedDelta !== 0) {
          return uploadedDelta;
        }

        if (left.originalIndex !== right.originalIndex) {
          return left.originalIndex - right.originalIndex;
        }

        return left.row.id.localeCompare(right.row.id);
      })
      .slice(0, 5)
      .map((item) => item.row);

    const validatedFacts = rankedRows.map(buildSectionPackFact);
    const gaps: string[] = [];
    if (support.support === "missing") {
      gaps.push(support.reason ?? createDefaultSectionGap(section.key));
    } else if (support.support === "weak") {
      gaps.push(
        support.reason ??
          `The "${section.title}" section is only weakly supported by validated evidence.`,
      );
      gaps.push(
        "Write this section cautiously and avoid turning partial evidence into firm conclusions.",
      );
    }

    let facts = validatedFacts;
    const shouldSupplementWithAnchoredFacts =
      (validatedFacts.length === 0 ||
        (validatedFacts.length < 2 && support.support !== "strong")) &&
      (options?.anchoredFacts?.length ?? 0) > 0;

    if (shouldSupplementWithAnchoredFacts) {
      const existingAnchoredIds = new Set(
        validatedFacts.flatMap((fact) => fact.anchoredFactIds),
      );
      const anchoredFacts = getAnchoredFactsForSection(
        section.key,
        reportPlan.mode,
        options?.anchoredFacts ?? [],
      )
        .filter((fact) => !existingAnchoredIds.has(fact.id))
        .slice(0, Math.max(0, 5 - validatedFacts.length))
        .map(buildSectionPackFactFromAnchoredFact);

      facts = [...validatedFacts, ...anchoredFacts];

      if (validatedFacts.length === 0 && anchoredFacts.length > 0) {
        gaps.push(
          "This section is grounded by deterministic anchored facts because validated evidence rows were sparse.",
        );
      }
    }

    if (
      section.key === "recommendations" &&
      facts.length === 0 &&
      (options?.coverageBoard?.length ?? 0) > 0
    ) {
      const weakCategories = (options?.coverageBoard ?? [])
        .filter(
          (entry) =>
            entry.key !== "recommendations" && entry.status !== "anchored",
        )
        .map((entry) => entry.key);
      if (weakCategories.length > 0) {
        gaps.push(
          `Recommendation quality is limited because these GTM categories remain weak or incomplete: ${weakCategories.join(
            ", ",
          )}.`,
        );
      }
    }

    return {
      sectionKey: section.key,
      title: section.title,
      support: support.support,
      facts,
      assumptions: [],
      estimates: [],
      gaps: [...new Set(gaps)],
    };
  });
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
    let mergedAnchoredFacts = state.anchoredFacts;
    let mergedCoverageBoard = state.coverageBoard;

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
            coverageBoard: state.coverageBoard,
            anchoredFacts: state.anchoredFacts,
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
            gapFillStats: createInitialGapFillStats(),
            pendingGapFillCategories: [],
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
        mergedAnchoredFacts = mergeAnchoredFacts(
          mergedAnchoredFacts,
          result.anchoredFacts ?? [],
        );
        if ((result.coverageBoard?.length ?? 0) > 0) {
          mergedCoverageBoard = result.coverageBoard ?? mergedCoverageBoard;
        }
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
        anchoredFacts: mergedAnchoredFacts,
        coverageBoard: mergedCoverageBoard,
      },
    });
  };

  const researcher = async (state: ResearcherStateType) => {
    const isGtmResearch = isGtmMode(
      state.preResearchPlan?.mode ?? state.reportPlan?.mode,
    );
    let coverageBoard = state.coverageBoard;
    let gapFillStats = state.gapFillStats;

    if (isGtmResearch && coverageBoard.length === 0) {
      coverageBoard = createInitialCoverageBoard();
      gapFillStats =
        state.gapFillStats && state.gapFillStats.totalAttempts >= 0
          ? state.gapFillStats
          : createInitialGapFillStats();

      await logEvent(
        state.runId,
        "researching",
        "coverage_initialized",
        "Initialized GTM coverage tracking for the researcher.",
        {
          coverage: createCoverageBoardSnapshot(coverageBoard),
          gapFillStats,
        },
      );
    }

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
        coverageBoard,
        gapFillStats,
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

    const isGtmResearch = isGtmMode(
      state.preResearchPlan?.mode ?? state.reportPlan?.mode,
    );
    let nextAnchoredFacts = state.anchoredFacts;
    let nextCoverageBoard =
      state.coverageBoard.length > 0
        ? state.coverageBoard
        : isGtmResearch
          ? createInitialCoverageBoard()
          : state.coverageBoard;
    let nextGapFillStats = state.gapFillStats;
    let nextPendingGapFillCategories = state.pendingGapFillCategories;
    const completedGapFillCategories =
      state.pendingGapFillCategories.length > 0 &&
      toolCalls.some((toolCall) => toolCall.name === "tavilySearch")
        ? state.pendingGapFillCategories
        : [];
    const newlyBuiltAnchoredFacts: AnchoredFact[] = [];

    const toolMessages = observations.map((observation, index) => {
      const toolCall = toolCalls[index];
      const observationText =
        typeof observation === "string"
          ? observation
          : stringifyContent(observation);
      const envelope = parseSearchToolEnvelope(observationText);

      if (envelope?.toolName === "selectedDocumentsSearch") {
        newlyBuiltAnchoredFacts.push(
          ...buildDocumentAnchoredFacts(
            envelope.artifact.queries,
            envelope.artifact.matches,
          ),
        );
      } else if (envelope?.toolName === "tavilySearch") {
        newlyBuiltAnchoredFacts.push(
          ...buildWebAnchoredFacts(
            envelope.artifact.queries,
            envelope.artifact.results,
          ),
        );
      }

      return new ToolMessage({
        content: envelope?.renderedText ?? observationText,
        tool_call_id: toolCall.id ?? crypto.randomUUID(),
        name: toolCall.name,
      });
    });

    if (newlyBuiltAnchoredFacts.length > 0) {
      nextAnchoredFacts = mergeAnchoredFacts(
        state.anchoredFacts,
        newlyBuiltAnchoredFacts,
      );

      await logEvent(
        state.runId,
        "researching",
        "anchored_facts_built",
        "Built deterministic anchored facts from search results.",
        summarizeAnchoredFacts(newlyBuiltAnchoredFacts),
      );
    }

    if (isGtmResearch) {
      if (completedGapFillCategories.length > 0) {
        nextPendingGapFillCategories = [];
      }

      const recomputedCoverageBoard = recomputeCoverageBoard(
        nextAnchoredFacts,
        nextGapFillStats,
        state.budgets,
        nextPendingGapFillCategories,
      );

      if (completedGapFillCategories.length > 0) {
        await logEvent(
          state.runId,
          "searching",
          "gap_fill_completed",
          "Completed targeted web gap fill for uncovered GTM categories.",
          {
            categories: completedGapFillCategories,
            coverage: createCoverageBoardSnapshot(recomputedCoverageBoard),
            gapFillStats: nextGapFillStats,
          },
        );
      }

      if (shouldLogCoverageUpdate(nextCoverageBoard, recomputedCoverageBoard)) {
        await logEvent(
          state.runId,
          "researching",
          "coverage_updated",
          "Updated GTM coverage tracking from the latest research results.",
          {
            coverage: createCoverageBoardSnapshot(recomputedCoverageBoard),
            gapFillStats: nextGapFillStats,
          },
        );
      }

      nextCoverageBoard = recomputedCoverageBoard;
    }

    const researchCompleteCalled = toolCalls.some(
      (toolCall) => toolCall.name === "ResearchComplete",
    );
    const exceededIterations =
      state.toolCallIterations >= state.budgets.maxReactToolCalls;

    if (
      researchCompleteCalled &&
      isGtmResearch &&
      nextAnchoredFacts.length > 0
    ) {
      const categoriesToGapFill = selectGapFillCategories(
        nextCoverageBoard,
        nextGapFillStats,
        state.budgets,
      );

      if (categoriesToGapFill.length > 0) {
        const nextTopic = state.researchTopic || "the active GTM topic";
        const queries = buildGapFillQueries(nextTopic, categoriesToGapFill);
        nextGapFillStats = incrementGapFillStats(
          nextGapFillStats,
          categoriesToGapFill,
        );
        nextPendingGapFillCategories = categoriesToGapFill;
        nextCoverageBoard = recomputeCoverageBoard(
          nextAnchoredFacts,
          nextGapFillStats,
          state.budgets,
          nextPendingGapFillCategories,
        );

        await logEvent(
          state.runId,
          "searching",
          "gap_fill_started",
          "Targeted web gap fill was scheduled before allowing research completion.",
          {
            categories: categoriesToGapFill,
            queries,
            coverage: createCoverageBoardSnapshot(nextCoverageBoard),
            gapFillStats: nextGapFillStats,
          },
        );

        return new Command({
          goto: "researcher",
          update: {
            researcherMessages: [
              ...toolMessages,
              buildGapFillControlMessage(nextTopic, categoriesToGapFill),
            ],
            anchoredFacts: nextAnchoredFacts,
            coverageBoard: nextCoverageBoard,
            gapFillStats: nextGapFillStats,
            pendingGapFillCategories: nextPendingGapFillCategories,
          },
        });
      }
    }

    if (researchCompleteCalled || exceededIterations) {
      return new Command({
        goto: "compressResearch",
        update: {
          researcherMessages: toolMessages,
          anchoredFacts: nextAnchoredFacts,
          coverageBoard: nextCoverageBoard,
          gapFillStats: nextGapFillStats,
          pendingGapFillCategories: nextPendingGapFillCategories,
        },
      });
    }

    return new Command({
      goto: "researcher",
      update: {
        researcherMessages: toolMessages,
        anchoredFacts: nextAnchoredFacts,
        coverageBoard: nextCoverageBoard,
        gapFillStats: nextGapFillStats,
        pendingGapFillCategories: nextPendingGapFillCategories,
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
    const sectionEvidencePacks =
      state.sectionEvidencePacks.length > 0
        ? state.sectionEvidencePacks
        : buildSectionEvidencePacksFromArtifacts(
            reportPlan,
            state.sectionSupport,
            state.evidenceRows,
            state.sectionEvidenceLinks,
            {
              anchoredFacts: state.anchoredFacts,
              coverageBoard: state.coverageBoard,
            },
          );
    let promptContent = finalReportGenerationPrompt
      .replace("{researchBrief}", state.researchBrief)
      .replace("{date}", getTodayString())
      .replace(
        "{preResearchPlan}",
        stringifyForPrompt(
          state.preResearchPlan ?? createFallbackPreResearchPlan(state),
        ),
      )
      .replace("{reportPlan}", stringifyForPrompt(reportPlan))
      .replace(
        "{sectionEvidencePacks}",
        stringifyForPrompt(sectionEvidencePacks),
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

  const buildSectionEvidencePacks = async (state: DeepResearchStateType) => {
    const reportPlan = state.reportPlan ?? createFallbackReportPlan(state);
    const sectionSupport = normalizeSectionSupport(
      reportPlan,
      state.sectionSupport,
    );
    await logEvent(
      state.runId,
      "validation",
      "section_packaging_started",
      "Packaging validated evidence into section-focused writing inputs.",
    );

    const sectionEvidencePacks = buildSectionEvidencePacksFromArtifacts(
      reportPlan,
      sectionSupport,
      state.evidenceRows,
      state.sectionEvidenceLinks,
      {
        anchoredFacts: state.anchoredFacts,
        coverageBoard: state.coverageBoard,
      },
    );

    await logEvent(
      state.runId,
      "validation",
      "section_packaging_completed",
      "Section evidence packs are ready for final report generation.",
      {
        sectionCount: sectionEvidencePacks.length,
        factCount: sectionEvidencePacks.reduce(
          (count, pack) => count + pack.facts.length,
          0,
        ),
      },
    );

    return {
      sectionEvidencePacks,
    };
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
    .addNode("buildSectionEvidencePacks", buildSectionEvidencePacks)
    .addNode("finalReportGeneration", finalReportGeneration)
    .addEdge(START, "clarifyWithUser")
    .addEdge("planResearch", "buildReportPlan")
    .addEdge("buildReportPlan", "researchSupervisor")
    .addEdge("researchSupervisor", "scoreSectionSupport")
    .addEdge("scoreSectionSupport", "extractEvidenceLedger")
    .addEdge("extractEvidenceLedger", "resolveEvidenceConflicts")
    .addEdge("resolveEvidenceConflicts", "validateEvidenceForFinal")
    .addEdge("validateEvidenceForFinal", "buildSectionEvidencePacks")
    .addEdge("buildSectionEvidencePacks", "finalReportGeneration")
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

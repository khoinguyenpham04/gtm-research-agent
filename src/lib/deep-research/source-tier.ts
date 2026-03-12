import type { SourceTier } from "@/lib/deep-research/types";

const SOURCE_TIER_RANK: Record<SourceTier, number> = {
  selected_document: 0,
  primary: 1,
  analyst: 2,
  trade_press: 3,
  vendor: 4,
  blog: 5,
  unknown: 6,
};

const SOURCE_TIER_DOMAIN_MATCHERS: Array<{
  tier: SourceTier;
  matchers: string[];
}> = [
  {
    tier: "primary",
    matchers: [
      ".gov",
      "gov.uk",
      "ico.org.uk",
      "ons.gov.uk",
      "fca",
      "regulator",
      "office for national statistics",
    ],
  },
  {
    tier: "analyst",
    matchers: ["gartner", "forrester", "mckinsey", "statista", "analyst"],
  },
  {
    tier: "trade_press",
    matchers: ["reuters", "computerweekly", "ft.com", "techcrunch"],
  },
  {
    tier: "vendor",
    matchers: [
      "salesforce",
      "hubspot",
      "otter.ai",
      "fireflies.ai",
      "avoma",
      "microsoft",
      "vendor",
    ],
  },
  {
    tier: "blog",
    matchers: ["blog"],
  },
];

function normalizeSourceSignal(...values: Array<string | undefined>) {
  return values
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .toLowerCase();
}

export function getSourceTierRank(sourceTier: SourceTier | undefined) {
  return SOURCE_TIER_RANK[sourceTier ?? "unknown"];
}

export function inferSourceTierFromUrl(url: string, title?: string): SourceTier {
  const normalized = normalizeSourceSignal(url, title);

  for (const matcherGroup of SOURCE_TIER_DOMAIN_MATCHERS) {
    if (matcherGroup.matchers.some((matcher) => normalized.includes(matcher))) {
      return matcherGroup.tier;
    }
  }

  return "unknown";
}

export function inferSourceTierFromText(content: string): SourceTier {
  const normalized = normalizeSourceSignal(content);

  if (
    normalized.includes("document id:") ||
    normalized.includes("selected uploaded documents") ||
    normalized.includes('sourcetype":"uploaded_document')
  ) {
    return "selected_document";
  }

  for (const matcherGroup of SOURCE_TIER_DOMAIN_MATCHERS) {
    if (matcherGroup.matchers.some((matcher) => normalized.includes(matcher))) {
      return matcherGroup.tier;
    }
  }

  return "unknown";
}

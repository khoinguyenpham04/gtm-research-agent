const RESEARCH_NOISE_TOKENS = new Set([
  'a',
  'an',
  'and',
  'are',
  'assistant',
  'by',
  'filetype',
  'for',
  'forecast',
  'from',
  'general',
  'go',
  'growth',
  'gtm',
  'in',
  'intent',
  'is',
  'market',
  'months',
  'next',
  'objective',
  'of',
  'or',
  'over',
  'pdf',
  'plans',
  'pricing',
  'queries',
  'query',
  'report',
  'reports',
  'research',
  'search',
  'site',
  'size',
  'stage',
  'statistics',
  'strategy',
  'survey',
  'targeting',
  'the',
  'to',
  'topic',
  'uk',
  'united',
  'kingdom',
]);

const GENERIC_ECOSYSTEM_TERMS = [
  'salesforce',
  'hubspot',
  'pipedrive',
  'zoho',
  'freshsales',
  'dynamics',
  'slack',
  'teams',
  'zoom',
  'google meet',
  'solar',
  'solar pv',
  'heat pump',
  'ev charger',
  'gateway',
  'economy 7',
  'time-of-use tariff',
  'app',
  'portal',
];

function singularizeToken(token: string) {
  if (token.endsWith('ies') && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.endsWith('s') && token.length > 3) {
    return token.slice(0, -1);
  }

  return token;
}

export function normalizeResearchText(input: string | null | undefined) {
  return (input ?? '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/site:[^\s]+/g, ' ')
    .replace(/filetype:[^\s]+/g, ' ')
    .replace(/[“”‘’"'`]/g, ' ')
    .replace(/[–—]/g, ' ')
    .replace(/[^a-z0-9.%/+-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function deriveTopicSearchPhrase(topic: string) {
  return topic
    .replace(/^gtm strategy for\s+/i, '')
    .replace(/\s+targeting\s+.+$/i, '')
    .replace(/\s+over the next\s+\d+\s+months?$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function deriveTopicAudiencePhrase(topic: string, objective?: string | null) {
  const combined = `${topic} ${objective ?? ''}`;
  const targetingMatch = combined.match(/\btargeting\s+([^.;]+)/i);
  if (targetingMatch?.[1]) {
    return targetingMatch[1].trim();
  }

  const homeownerMatch = combined.match(
    /\b(owner-occupied households|homeowners|households|consumers|buyers|installers|smbs|smes|small businesses|sales teams)\b/i,
  );
  return homeownerMatch?.[1]?.trim() ?? null;
}

export function extractResearchKeywords(input: string, max = 8) {
  const unique = new Set<string>();
  const normalized = normalizeResearchText(input);

  for (const rawToken of normalized.split(' ')) {
    const token = singularizeToken(rawToken);
    if (token.length < 3) {
      continue;
    }
    if (/^\d+$/.test(token)) {
      continue;
    }
    if (RESEARCH_NOISE_TOKENS.has(token)) {
      continue;
    }

    unique.add(token);
    if (unique.size >= max) {
      break;
    }
  }

  return Array.from(unique);
}

export function hasTopicSignal(
  text: string,
  seedText: string,
  vendorTarget?: string | null,
  minimumMatches = 2,
) {
  const normalizedText = normalizeResearchText(text);
  const keywords = [
    ...extractResearchKeywords(seedText, 10),
    ...extractResearchKeywords(vendorTarget ?? '', 4),
  ];

  if (keywords.length === 0) {
    return false;
  }

  const matches = new Set<string>();
  for (const keyword of keywords) {
    if (
      normalizedText.includes(` ${keyword} `) ||
      normalizedText.startsWith(`${keyword} `) ||
      normalizedText.endsWith(` ${keyword}`) ||
      normalizedText === keyword
    ) {
      matches.add(keyword);
    }
  }

  const threshold = Math.min(minimumMatches, keywords.length);
  return matches.size >= Math.max(1, threshold);
}

function uniqueStrings(values: string[]) {
  return values.filter((value, index, allValues) => value && allValues.indexOf(value) === index);
}

function splitFeatureCandidates(input: string) {
  return input
    .split(/,|;|\band\b|\bwith\b/gi)
    .map((segment) => segment.replace(/\s+/g, ' ').trim())
    .filter((segment) => segment.length >= 3 && segment.length <= 80);
}

function canonicalizeCapabilityPhrase(input: string) {
  const normalized = normalizeResearchText(input);

  if (normalized.includes('transcript') || normalized.includes('transcription')) {
    return 'transcription';
  }
  if (normalized.includes('summary') || normalized.includes('recap')) {
    return 'summaries';
  }
  if (normalized.includes('action item') || normalized.includes('follow up') || normalized.includes('next step')) {
    return 'action items';
  }
  if (normalized.includes('meeting note')) {
    return 'meeting notes';
  }
  if (normalized.includes('crm')) {
    return 'CRM sync';
  }
  if (normalized.includes('conversation intelligence') || normalized.includes('call analytics')) {
    return 'conversation intelligence';
  }
  if (normalized.includes('backup')) {
    return 'backup power';
  }
  if (normalized.includes('warranty')) {
    return 'warranty';
  }
  if (normalized.includes('self consumption')) {
    return 'solar self-consumption';
  }
  if (normalized.includes('time of use') || normalized.includes('economy 7') || normalized.includes('tariff')) {
    return 'time-of-use tariff scheduling';
  }
  if (normalized.includes('portal') || normalized.includes('monitoring') || normalized.includes('app')) {
    return 'monitoring portal/app';
  }
  if (/\b\d+(?:\.\d+)?\s*kwh\b/.test(normalized) || normalized.includes('capacity')) {
    return 'battery capacity';
  }
  if (/\b\d+(?:\.\d+)?\s*kw\b/.test(normalized) || normalized.includes('power output')) {
    return 'power output';
  }

  const trimmed = input.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractGenericCapabilityPhrases(text: string, max = 6) {
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  const matches: string[] = [];
  const patterns = [
    /(?:key features?|features?|capabilities|benefits)\s*[:\-]\s*([^.!?\n]{15,180})/gi,
    /(?:supports?|includes?|offers?|provides?|allows?|enables?|designed for)\s+([^.!?\n]{15,180})/gi,
    /(?:compatible with)\s+([^.!?\n]{10,140})/gi,
  ];

  for (const pattern of patterns) {
    for (const match of normalizedText.matchAll(pattern)) {
      const capture = match[1]?.trim();
      if (!capture) {
        continue;
      }

      matches.push(...splitFeatureCandidates(capture));
    }
  }

  const canonicalized = uniqueStrings(
    matches
      .map(canonicalizeCapabilityPhrase)
      .filter((value): value is string => Boolean(value)),
  );

  return canonicalized.slice(0, max);
}

export function extractGenericEcosystemSignals(text: string, max = 5) {
  const normalized = normalizeResearchText(text);
  const explicitSignals = GENERIC_ECOSYSTEM_TERMS.filter((term) =>
    normalized.includes(normalizeResearchText(term)),
  ).map((term) =>
    term === 'solar pv'
      ? 'solar PV'
      : term === 'time-of-use tariff'
        ? 'time-of-use tariffs'
        : term === 'app'
          ? 'mobile/web app'
          : term === 'portal'
            ? 'customer portal'
            : term === 'teams'
              ? 'Microsoft Teams'
              : term === 'zoom'
                ? 'Zoom'
                : term === 'google meet'
                  ? 'Google Meet'
                  : term === 'salesforce'
                    ? 'Salesforce'
                    : term === 'hubspot'
                      ? 'HubSpot'
                      : term === 'pipedrive'
                        ? 'Pipedrive'
                        : term === 'zoho'
                          ? 'Zoho'
                          : term === 'freshsales'
                            ? 'Freshsales'
                            : term === 'dynamics'
                              ? 'Microsoft Dynamics'
                              : term === 'ev charger'
                                ? 'EV charger'
                                : term,
  );

  return uniqueStrings(explicitSignals).slice(0, max);
}

export function compactClaimSentence(input: string, maxLength = 180) {
  const trimmed = input.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  const sentence = trimmed.split(/(?<=[.!?])\s+/)[0]?.trim();
  if (sentence && sentence.length <= maxLength) {
    return sentence;
  }

  return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

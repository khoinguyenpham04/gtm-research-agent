import type { SearchIntent, VendorPageType } from '@/lib/research/schemas';

export interface CanonicalVendorPage {
  url: string;
  title: string;
  vendorPageType: Exclude<VendorPageType, 'unknown'>;
  intents: SearchIntent[];
}

interface CanonicalVendorConfig {
  aliases: string[];
  pages: CanonicalVendorPage[];
}

const canonicalVendorRegistry: Record<string, CanonicalVendorConfig> = {
  otter: {
    aliases: ['otter', 'otter ai', 'otter.ai'],
    pages: [
      {
        url: 'https://otter.ai/sales-agent',
        title: 'AI Sales Notetaker - Otter.ai',
        vendorPageType: 'product',
        intents: ['competitor-features'],
      },
      {
        url: 'https://otter.ai/pricing',
        title: 'Pricing | Otter.ai',
        vendorPageType: 'pricing',
        intents: ['pricing'],
      },
      {
        url: 'https://help.otter.ai/hc/en-us/articles/15671309340183-Otter-ai-Salesforce-Integration-Guide',
        title: 'Otter.ai Salesforce Integration Guide',
        vendorPageType: 'docs',
        intents: ['competitor-features'],
      },
    ],
  },
  fireflies: {
    aliases: ['fireflies', 'fireflies ai', 'fireflies.ai'],
    pages: [
      {
        url: 'https://fireflies.ai',
        title: 'Fireflies.ai AI Note Taker',
        vendorPageType: 'product',
        intents: ['competitor-features'],
      },
      {
        url: 'https://fireflies.ai/pricing',
        title: 'Pricing & Plans | Fireflies.ai',
        vendorPageType: 'pricing',
        intents: ['pricing'],
      },
      {
        url: 'https://fireflies.ai/integrations',
        title: 'Fireflies.ai Integrations',
        vendorPageType: 'docs',
        intents: ['competitor-features'],
      },
    ],
  },
  zoom: {
    aliases: ['zoom', 'zoom ai companion'],
    pages: [
      {
        url: 'https://explore.zoom.us/en/ai-assistant/',
        title: "Zoom's smart AI assistant that empowers you",
        vendorPageType: 'product',
        intents: ['competitor-features'],
      },
      {
        url: 'https://www.zoom.com/en/products/collaboration-tools/zoom-workplace-pro/',
        title: 'Zoom Workplace Pro Pricing',
        vendorPageType: 'pricing',
        intents: ['pricing'],
      },
      {
        url: 'https://news.zoom.us/ai-companion-2-0-launch/',
        title: 'AI Companion 2.0 launches',
        vendorPageType: 'newsroom',
        intents: ['competitor-features'],
      },
    ],
  },
  microsoft: {
    aliases: [
      'microsoft',
      'microsoft teams',
      'microsoft teams premium',
      'microsoft 365 copilot',
      'teams',
    ],
    pages: [
      {
        url: 'https://www.microsoft.com/en-us/microsoft-teams/teams-ai',
        title: 'Boost teamwork with AI in Microsoft Teams',
        vendorPageType: 'product',
        intents: ['competitor-features'],
      },
      {
        url: 'https://www.microsoft.com/en-us/microsoft-teams/compare-microsoft-teams-business-options',
        title: 'Compare Microsoft Teams for Business Pricing',
        vendorPageType: 'pricing',
        intents: ['pricing'],
      },
      {
        url: 'https://learn.microsoft.com/en-us/microsoftteams/copilot-ai-agents-overview',
        title: 'Overview of AI in Microsoft Teams for IT admins',
        vendorPageType: 'docs',
        intents: ['competitor-features'],
      },
    ],
  },
};

function normalizeVendorName(input: string | null | undefined) {
  return (input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function resolveCanonicalVendorPages(
  vendorTarget: string | null | undefined,
  intent: SearchIntent,
) {
  const normalizedTarget = normalizeVendorName(vendorTarget);
  if (!normalizedTarget) {
    return [];
  }

  for (const config of Object.values(canonicalVendorRegistry)) {
    const matched = config.aliases.some((alias) => {
      const normalizedAlias = normalizeVendorName(alias);
      return (
        normalizedTarget === normalizedAlias ||
        normalizedTarget.includes(normalizedAlias) ||
        normalizedAlias.includes(normalizedTarget)
      );
    });

    if (matched) {
      return config.pages.filter((page) => page.intents.includes(intent));
    }
  }

  return [];
}

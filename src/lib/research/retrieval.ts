import type { ResearchGraphState, RetrievalCandidate } from '@/lib/research/schemas';

type SectionKey = RetrievalCandidate['sectionKey'];

interface FuseableCandidate {
  id: string;
  score: number;
}

export function buildSectionQuery(state: ResearchGraphState, sectionKey: SectionKey) {
  const intentQuery = state.plan?.searchQueries
    .filter((query) => query.sectionKey === sectionKey)
    .map((query) => query.query)
    .join(' ');

  return [state.topic, state.objective ?? '', intentQuery ?? '', sectionKey.replaceAll('-', ' ')]
    .filter(Boolean)
    .join(' ')
    .trim();
}

export function buildLexicalQuery(state: ResearchGraphState, sectionKey: SectionKey) {
  const intentQuery = state.plan?.searchQueries
    .filter((query) => query.sectionKey === sectionKey)
    .map((query) => query.query)
    .join(' ');

  const terms = [state.topic, intentQuery ?? '', state.objective ?? '']
    .join(' ')
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 3)
    .slice(0, 12);

  return [...new Set(terms)].join(' ');
}

export function reciprocalRankFuse<T extends FuseableCandidate>(
  lanes: T[][],
  k = 60,
) {
  const fused = new Map<string, { candidate: T; score: number }>();

  for (const lane of lanes) {
    lane.forEach((candidate, index) => {
      const existing = fused.get(candidate.id);
      const score = 1 / (k + index + 1);
      if (existing) {
        existing.score += score;
      } else {
        fused.set(candidate.id, { candidate, score });
      }
    });
  }

  return Array.from(fused.values())
    .map((entry) => ({
      candidate: entry.candidate,
      fusedScore: Number(entry.score.toFixed(6)),
    }))
    .sort((left, right) => right.fusedScore - left.fusedScore);
}

import type { ParsedReference, ReferenceStatus, WorkRecord } from "./types.ts";

export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (s: string) => new Set(normalize(s).split(" ").filter((t) => t.length > 1));

/** Sørensen–Dice on word sets. */
export function dice(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return (2 * shared) / (A.size + B.size);
}

/** Fraction of the candidate's title words that appear in the raw reference string. */
function containment(title: string, raw: string): number {
  const T = tokens(title);
  const R = tokens(raw);
  if (!T.size) return 0;
  let hit = 0;
  for (const t of T) if (R.has(t)) hit++;
  return hit / T.size;
}

export interface Score {
  confidence: number;
  titleSim: number;
  yearMatch: boolean | null;
  authorMatch: boolean | null;
}

export function scoreCandidate(ref: ParsedReference, work: WorkRecord): Score {
  const titleSim = ref.title ? dice(ref.title, work.title) : containment(work.title, ref.raw);

  const yearMatch = ref.year && work.year ? Math.abs(ref.year - work.year) <= 1 : null;
  const yearScore = yearMatch === null ? 0.5 : ref.year === work.year ? 1 : yearMatch ? 0.5 : 0;

  const authorMatch = ref.firstAuthor
    ? work.authors.length
      ? normalize(work.authors[0]) === normalize(ref.firstAuthor)
      : null
    : null;
  const authorScore = authorMatch === null ? 0.5 : authorMatch ? 1 : 0;

  const confidence = 0.7 * titleSim + 0.15 * yearScore + 0.15 * authorScore;
  return { confidence, titleSim, yearMatch, authorMatch };
}

export const statusFor = (confidence: number): ReferenceStatus =>
  confidence >= 0.85 ? "verified" : confidence >= 0.6 ? "likely" : "unverified";

export function bestMatch(ref: ParsedReference, candidates: WorkRecord[]): { work: WorkRecord; score: Score } | null {
  let best: { work: WorkRecord; score: Score } | null = null;
  for (const work of candidates) {
    const score = scoreCandidate(ref, work);
    if (!best || score.confidence > best.score.confidence) best = { work, score };
  }
  return best;
}

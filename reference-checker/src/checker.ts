import { crossrefByDoi, crossrefSearch } from "./crossref.ts";
import { bestMatch, statusFor } from "./match.ts";
import { openalexByDoi, openalexSearch } from "./openalex.ts";
import { parseReference, splitReferences } from "./parse.ts";
import type { CheckerOptions, ParsedReference, ReferenceResult, WorkRecord } from "./types.ts";

async function settled<T>(p: Promise<T>, label: string, issues: string[]): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    issues.push(`${label} lookup failed (${(e as Error).message}); result may be incomplete`);
    return null;
  }
}

/** Check a bibliography (raw text, or an already-split list) against Crossref and OpenAlex. */
export async function checkReferences(
  input: string | string[],
  options: CheckerOptions = {},
): Promise<ReferenceResult[]> {
  const raws = typeof input === "string" ? splitReferences(input) : input.map((r) => r.trim()).filter(Boolean);
  const ctx = {
    fetch: options.fetch ?? fetch,
    timeoutMs: options.timeoutMs ?? 10_000,
    mailto: options.mailto,
  };
  const rows = options.searchRows ?? 3;
  const cache = options.cache ?? new Map<string, unknown>();

  const memo = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    if (cache.has(key)) return cache.get(key) as T;
    const v = await fn();
    cache.set(key, v);
    return v;
  };

  async function checkOne(raw: string, index: number): Promise<ReferenceResult> {
    const parsed: ParsedReference = parseReference(raw);
    const issues: string[] = [];
    let candidates: WorkRecord[] = [];
    let viaDoi = false;

    if (parsed.doi) {
      const doi = parsed.doi;
      const [cr, oa] = await Promise.all([
        settled(memo(`cr:doi:${doi}`, () => crossrefByDoi(doi, ctx)), "Crossref", issues),
        settled(memo(`oa:doi:${doi}`, () => openalexByDoi(doi, ctx)), "OpenAlex", issues),
      ]);
      candidates = [cr, oa].filter((w): w is WorkRecord => w !== null);
      viaDoi = candidates.length > 0;
      if (!viaDoi) issues.push(`DOI ${doi} did not resolve on Crossref or OpenAlex`);
    }

    if (!viaDoi) {
      const q = parsed.title ?? raw;
      const [cr, oa] = await Promise.all([
        settled(memo(`cr:q:${q}`, () => crossrefSearch(q, rows, ctx)), "Crossref", issues),
        settled(memo(`oa:q:${q}`, () => openalexSearch(q, rows, ctx)), "OpenAlex", issues),
      ]);
      candidates = [...(cr ?? []), ...(oa ?? [])];
    }

    const best = bestMatch(parsed, candidates);
    if (!best) {
      issues.push("No matching work found. Books, reports, theses and web sources are often missing from these indexes.");
      return { index, raw, parsed, status: "unverified", confidence: 0, issues };
    }

    const { work, score } = best;
    let { confidence } = score;

    // A DOI that resolves to a *different* paper is a red flag, not a verification.
    if (viaDoi && score.titleSim < 0.5) {
      issues.push(`DOI resolves to a different paper: "${work.title}"`);
      confidence = Math.min(confidence, 0.4);
    }
    if (score.yearMatch === false) issues.push(`Year differs from index (${parsed.year} vs ${work.year})`);
    else if (parsed.year && work.year && parsed.year !== work.year) issues.push(`Year is off by one (${parsed.year} vs ${work.year})`);
    if (score.authorMatch === false) issues.push(`First author differs from index ("${parsed.firstAuthor}" vs "${work.authors[0]}")`);
    if (work.retracted) issues.push("This work is marked as retracted in OpenAlex");
    if (!parsed.doi && work.doi) issues.push(`Suggested DOI: ${work.doi}`);

    // A confident match with a known DOI is stronger evidence than fuzzy search.
    if (viaDoi && score.titleSim >= 0.5) confidence = Math.max(confidence, 0.9);

    return { index, raw, parsed, status: statusFor(confidence), confidence: Number(confidence.toFixed(3)), match: work, issues };
  }

  // Small worker pool: keeps us within the public APIs' rate limits.
  const results: ReferenceResult[] = new Array(raws.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(options.concurrency ?? 4, raws.length) }, async () => {
    while (next < raws.length) {
      const i = next++;
      results[i] = await checkOne(raws[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

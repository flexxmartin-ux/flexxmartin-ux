export interface ParsedReference {
  raw: string;
  doi?: string;
  title?: string;
  year?: number;
  /** Surname of the first author, lower-cased and accent-stripped by the matcher. */
  firstAuthor?: string;
}

/** A work as returned by a scholarly index, normalised across sources. */
export interface WorkRecord {
  source: "crossref" | "openalex";
  doi?: string;
  title: string;
  year?: number;
  /** Author surnames, in order. */
  authors: string[];
  venue?: string;
  url?: string;
  /** Only OpenAlex reports this. */
  retracted?: boolean;
}

/**
 * verified   - strong match on an index (DOI, or title + year/author agree)
 * likely     - plausible match, a human should glance at it
 * unverified - nothing convincing found; NOT proof the reference is fake
 */
export type ReferenceStatus = "verified" | "likely" | "unverified";

export interface ReferenceResult {
  index: number;
  raw: string;
  parsed: ParsedReference;
  status: ReferenceStatus;
  /** 0..1 */
  confidence: number;
  match?: WorkRecord;
  issues: string[];
}

export type FetchLike = typeof fetch;

export interface CheckerOptions {
  /** Contact email; puts you in Crossref's and OpenAlex's "polite pool". Strongly recommended. */
  mailto?: string;
  fetch?: FetchLike;
  /** Parallel references being checked. Default 4. */
  concurrency?: number;
  /** Per-request timeout in ms. Default 10000. */
  timeoutMs?: number;
  /** Candidates requested per search. Default 3. */
  searchRows?: number;
  /** Optional shared cache (e.g. backed by Supabase); defaults to an in-memory Map. */
  cache?: Map<string, unknown>;
}

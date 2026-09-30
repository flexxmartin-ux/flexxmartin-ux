import { getJson } from "./http.ts";
import type { FetchLike, WorkRecord } from "./types.ts";

const BASE = "https://api.openalex.org/works";

interface OpenAlexWork {
  doi?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  is_retracted?: boolean;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: { source?: { display_name?: string } | null } | null;
  id?: string;
}

const surname = (full: string) => full.trim().split(/\s+/).pop() ?? full;

function toRecord(w: OpenAlexWork): WorkRecord | null {
  if (!w.display_name) return null;
  return {
    source: "openalex",
    doi: w.doi?.replace(/^https?:\/\/doi\.org\//i, "").toLowerCase(),
    title: w.display_name,
    year: w.publication_year ?? undefined,
    authors: (w.authorships ?? []).map((a) => surname(a.author?.display_name ?? "")).filter(Boolean),
    venue: w.primary_location?.source?.display_name ?? undefined,
    url: w.doi ?? w.id,
    retracted: w.is_retracted,
  };
}

interface Ctx {
  fetch: FetchLike;
  timeoutMs: number;
  mailto?: string;
}

const mailtoParam = (c: Ctx, sep: "?" | "&") => (c.mailto ? `${sep}mailto=${encodeURIComponent(c.mailto)}` : "");

export async function openalexByDoi(doi: string, c: Ctx): Promise<WorkRecord | null> {
  const body = await getJson<OpenAlexWork>(
    `${BASE}/${encodeURIComponent(`https://doi.org/${doi}`)}${mailtoParam(c, "?")}`,
    c.fetch,
    c.timeoutMs,
  );
  return body ? toRecord(body) : null;
}

export async function openalexSearch(query: string, rows: number, c: Ctx): Promise<WorkRecord[]> {
  const url = `${BASE}?search=${encodeURIComponent(query)}&per-page=${rows}${mailtoParam(c, "&")}`;
  const body = await getJson<{ results: OpenAlexWork[] }>(url, c.fetch, c.timeoutMs);
  return (body?.results ?? []).map(toRecord).filter((r): r is WorkRecord => r !== null);
}

import { getJson } from "./http.ts";
import type { FetchLike, WorkRecord } from "./types.ts";

const BASE = "https://api.crossref.org/works";

interface CrossrefWork {
  DOI?: string;
  title?: string[];
  "container-title"?: string[];
  issued?: { "date-parts"?: (number | null)[][] };
  author?: { family?: string; name?: string }[];
  URL?: string;
}

function toRecord(w: CrossrefWork): WorkRecord | null {
  const title = w.title?.[0];
  if (!title) return null;
  return {
    source: "crossref",
    doi: w.DOI?.toLowerCase(),
    title,
    year: w.issued?.["date-parts"]?.[0]?.[0] ?? undefined,
    authors: (w.author ?? []).map((a) => a.family ?? a.name ?? "").filter(Boolean),
    venue: w["container-title"]?.[0],
    url: w.URL,
  };
}

interface Ctx {
  fetch: FetchLike;
  timeoutMs: number;
  mailto?: string;
}

const headers = (c: Ctx): Record<string, string> => (c.mailto ? { "user-agent": `reference-checker (mailto:${c.mailto})` } : {});
const mailtoParam = (c: Ctx) => (c.mailto ? `&mailto=${encodeURIComponent(c.mailto)}` : "");

export async function crossrefByDoi(doi: string, c: Ctx): Promise<WorkRecord | null> {
  const q = c.mailto ? `?mailto=${encodeURIComponent(c.mailto)}` : "";
  const body = await getJson<{ message: CrossrefWork }>(
    `${BASE}/${encodeURIComponent(doi)}${q}`,
    c.fetch,
    c.timeoutMs,
    headers(c),
  );
  return body ? toRecord(body.message) : null;
}

export async function crossrefSearch(query: string, rows: number, c: Ctx): Promise<WorkRecord[]> {
  const url = `${BASE}?query.bibliographic=${encodeURIComponent(query)}&rows=${rows}${mailtoParam(c)}`;
  const body = await getJson<{ message: { items: CrossrefWork[] } }>(url, c.fetch, c.timeoutMs, headers(c));
  return (body?.message.items ?? []).map(toRecord).filter((r): r is WorkRecord => r !== null);
}

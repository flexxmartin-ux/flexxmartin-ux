import type { ParsedReference } from "./types.ts";

const DOI_RE = /\b10\.\d{4,9}\/[^\s"<>]+/i;

/**
 * Split a pasted bibliography into entries. Handles blank-line separated,
 * "1." / "[1]" numbered, and one-entry-per-line lists; wrapped lines are re-joined.
 */
export function splitReferences(text: string): string[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const entries: string[] = [];
  let current = "";
  const startsEntry = (l: string) => /^\s*(\[\d+\]|\d+[.)])\s+/.test(l);
  const flush = () => {
    const t = current.replace(/\s+/g, " ").trim();
    if (t) entries.push(t);
    current = "";
  };
  const numbered = lines.some(startsEntry);
  const hasBlankSeparators = /\n\s*\n/.test(text);

  for (const line of lines) {
    if (!line.trim()) {
      if (hasBlankSeparators) flush();
      continue;
    }
    if (numbered ? startsEntry(line) : !hasBlankSeparators) flush();
    current += " " + line;
  }
  flush();
  return entries.map((e) => e.replace(/^\s*(\[\d+\]|\d+[.)])\s+/, ""));
}

/** Best-effort field extraction. Anything missing falls back to searching with the raw string. */
export function parseReference(raw: string): ParsedReference {
  const parsed: ParsedReference = { raw };

  const doi = raw.match(DOI_RE)?.[0];
  if (doi) parsed.doi = doi.replace(/[.,;)\]]+$/, "").toLowerCase();

  const yearMatch = raw.match(/\((\d{4})[a-z]?\)/) ?? raw.match(/\b((?:19|20)\d{2})[a-z]?\b/);
  if (yearMatch) parsed.year = Number(yearMatch[1]);

  // "Smith, J." (APA/Harvard/Vancouver-ish) -> Smith
  const author = raw.match(/^([\p{L}'’\- ]+?),\s*(?:[\p{Lu}]\.|\p{Lu}[\p{L}]*)/u);
  if (author) parsed.firstAuthor = author[1].trim();

  // APA: "(2020). Title here. Journal" ; otherwise a quoted title.
  const apa = raw.match(/\(\d{4}[a-z]?\)\.\s*(.+?)\.\s+(?=[A-Z0-9_*])/);
  const quoted = raw.match(/[“"]([^”"]{10,})[”"]/);
  const title = apa?.[1] ?? quoted?.[1];
  if (title) parsed.title = title.replace(/[.,]$/, "").trim();

  return parsed;
}

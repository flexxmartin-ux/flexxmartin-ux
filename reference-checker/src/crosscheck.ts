import { normalize } from "./match.ts";
import { parseReference, splitReferences } from "./parse.ts";

export type CitationStyle = "author-year" | "numeric" | "none";

export interface InTextCitation {
  /** The text as written, e.g. "Smith & Jones, 2020". */
  raw: string;
  /** 1-based line in the body text. */
  line: number;
  /** Author-year: first author's surname and year (+ a/b suffix). */
  surname?: string;
  year?: number;
  suffix?: string;
  /** Numeric: the reference numbers this citation points to. */
  numbers?: number[];
}

export interface CrossCheckIssue {
  type: "missing-reference" | "year-mismatch" | "ambiguous" | "unknown-number";
  message: string;
  citation: InTextCitation;
  /** 1-based reference-list positions involved, when known. */
  referenceIndexes?: number[];
}

export interface CrossCheckResult {
  style: CitationStyle;
  citationCount: number;
  referenceCount: number;
  issues: CrossCheckIssue[];
  /** Reference-list entries never cited in the body (1-based index). */
  uncited: { index: number; raw: string }[];
  warnings: string[];
}

// ---------- splitting ----------

const HEADING_RE = /^[ \t]*(?:#{1,6}[ \t]*)?(?:references?|reference list|bibliography|works cited|literature cited)[ \t]*:?[ \t]*$/gim;

/** Split a manuscript into body and reference-list text at the last "References"-style heading. */
export function splitManuscript(text: string): { body: string; references: string } | null {
  let last: RegExpExecArray | null = null;
  for (const m of text.matchAll(HEADING_RE)) last = m;
  if (!last) return null;
  return { body: text.slice(0, last.index), references: text.slice(last.index! + last[0].length) };
}

// ---------- citation extraction ----------

const PARTICLE = "(?:(?:[Vv]an|[Vv]on|[Dd]e|[Dd]el|[Dd]er|[Dd]en|[Dd]i|[Dd]u|[Ll]a|[Ll]e|[Dd]a|[Dd]os|[Aa]l|[Ee]l|[Bb]in|[Ii]bn|[Tt]er|[Tt]en)\\s+)*";
const NAME = `${PARTICLE}\\p{Lu}[\\p{L}'’\\-]+`;
const YEAR = "(?:1[5-9]\\d{2}|20\\d{2})(?:[a-z](?![a-z]))?";
const YEARS = `${YEAR}(?:\\s*,\\s*${YEAR})*`;
const PAGES = "(?:\\s*,?\\s*(?:pp?\\.|chaps?\\.|ch\\.)\\s*[\\d\\-–, ]+)?";

const PAREN_SEGMENT = new RegExp(
  `^(?:(?:see(?: also)?|e\\.g\\.,?|cf\\.|i\\.e\\.,?|also|compare)\\s+)*` +
    `(?<auth>${NAME}(?:(?:\\s*,\\s*|\\s*,?\\s*(?:&|and)\\s+)${NAME})*(?:\\s+et\\s+al\\.?)?),?\\s+(?<years>${YEARS})${PAGES}`,
  "u",
);
const NARRATIVE = new RegExp(
  `(?<auth>${NAME}(?:\\s+(?:&|and)\\s+${NAME}|\\s+et\\s+al\\.?)?)(?:['’]s)?\\s*\\((?<years>${YEARS})${PAGES}\\)`,
  "gu",
);
const NUMERIC = /\[(\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*)\]/g;

/** Last word of a normalised name: "van der Berg" -> "berg". Works for both sides of the match. */
export const surnameKey = (name: string) => normalize(name).split(" ").pop() ?? "";

const lineAt = (text: string, pos: number) => text.slice(0, pos).split("\n").length;

function yearParts(y: string): { year: number; suffix?: string } {
  const m = y.match(/^(\d{4})([a-z])?$/)!;
  return { year: Number(m[1]), suffix: m[2] };
}

function authorYearCitations(body: string): InTextCitation[] {
  const out: InTextCitation[] = [];
  const push = (raw: string, pos: number, auth: string, years: string) => {
    const first = auth.match(new RegExp(`^${NAME}`, "u"))![0];
    for (const y of years.split(",")) {
      const { year, suffix } = yearParts(y.trim());
      out.push({ raw, line: lineAt(body, pos), surname: surnameKey(first), year, suffix });
    }
  };

  for (const g of body.matchAll(/\(([^()]*\d{4}[^()]*)\)/g)) {
    let offset = g.index! + 1;
    for (const seg of g[1].split(";")) {
      const lead = seg.length - seg.trimStart().length;
      const m = seg.trim().match(PAREN_SEGMENT);
      if (m?.groups) push(m[0], offset + lead, m.groups.auth, m.groups.years);
      offset += seg.length + 1;
    }
  }
  for (const m of body.matchAll(NARRATIVE)) push(m[0], m.index!, m.groups!.auth, m.groups!.years);

  return out.sort((a, b) => a.line - b.line);
}

function numericCitations(body: string): InTextCitation[] {
  const out: InTextCitation[] = [];
  for (const m of body.matchAll(NUMERIC)) {
    const numbers: number[] = [];
    for (const part of m[1].split(",")) {
      const [a, b] = part.split(/[-–]/).map((s) => Number(s.trim()));
      if (b === undefined) numbers.push(a);
      else for (let n = a; n <= Math.min(b, a + 500); n++) numbers.push(n);
    }
    out.push({ raw: m[0], line: lineAt(body, m.index!), numbers });
  }
  return out;
}

// ---------- reference entries ----------

interface RefEntry {
  index: number;
  raw: string;
  key?: string;
  year?: number;
  suffix?: string;
}

function refEntry(raw: string, index: number): RefEntry {
  const p = parseReference(raw);
  const surname = p.firstAuthor ?? raw.match(/^(?:[Vv]an |[Vv]on |[Dd]e )?\p{Lu}[\p{L}'’\-]+/u)?.[0];
  const y = raw.match(/\((\d{4})([a-z])?\)/) ?? raw.match(/\b((?:19|20)\d{2})([a-z])?\b/);
  return { index, raw, key: surname ? surnameKey(surname) : undefined, year: y ? Number(y[1]) : p.year, suffix: y?.[2] };
}

// ---------- the cross-check ----------

export function crossCheck(body: string, referencesText: string): CrossCheckResult {
  const refs = splitReferences(referencesText).map((raw, i) => refEntry(raw, i + 1));
  const ay = authorYearCitations(body);
  const num = numericCitations(body);
  const style: CitationStyle = ay.length === 0 && num.length === 0 ? "none" : num.length > ay.length ? "numeric" : "author-year";
  const citations = style === "numeric" ? num : style === "author-year" ? ay : [];

  const issues: CrossCheckIssue[] = [];
  const warnings: string[] = [];
  const cited = new Set<number>();
  const seen = new Set<string>();
  const report = (dedupe: string, issue: CrossCheckIssue) => {
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    issues.push(issue);
  };

  if (style === "none") warnings.push("No in-text citations detected.");
  if (refs.length === 0) warnings.push("No reference list entries detected.");

  if (style === "numeric") {
    for (const c of citations) {
      for (const n of c.numbers!) {
        if (n >= 1 && n <= refs.length) cited.add(n);
        else report(`n:${n}`, { type: "unknown-number", citation: c, message: `Citation [${n}] has no matching entry (list has ${refs.length}).` });
      }
    }
  } else if (style === "author-year") {
    for (const c of citations) {
      const label = `${c.surname} ${c.year}${c.suffix ?? ""}`;
      const sameAuthor = refs.filter((r) => r.key === c.surname);
      if (!sameAuthor.length) {
        report(`m:${label}`, { type: "missing-reference", citation: c, message: `"${c.raw}" is not in the reference list.` });
        continue;
      }
      const hits = sameAuthor.filter((r) => r.year === c.year && (!c.suffix || !r.suffix || c.suffix === r.suffix));
      if (!hits.length) {
        const years = sameAuthor.map((r) => `${r.year ?? "?"}${r.suffix ?? ""}`).join(", ");
        report(`y:${label}`, {
          type: "year-mismatch",
          citation: c,
          referenceIndexes: sameAuthor.map((r) => r.index),
          message: `"${c.raw}": the list has this author only for ${years}.`,
        });
        continue;
      }
      hits.forEach((r) => cited.add(r.index));
      if (hits.length > 1 && !c.suffix) {
        report(`a:${label}`, {
          type: "ambiguous",
          citation: c,
          referenceIndexes: hits.map((r) => r.index),
          message: `"${c.raw}" matches ${hits.length} list entries; add a/b suffixes to tell them apart.`,
        });
      }
    }
  }

  const uncited = style === "none" ? [] : refs.filter((r) => !cited.has(r.index)).map(({ index, raw }) => ({ index, raw }));
  return { style, citationCount: citations.length, referenceCount: refs.length, issues, uncited, warnings };
}

/** Cross-check a whole manuscript (body + trailing reference list in one string). */
export function crossCheckManuscript(text: string): CrossCheckResult {
  const parts = splitManuscript(text);
  if (!parts) {
    const r = crossCheck(text, "");
    return { ...r, warnings: ['No "References" / "Bibliography" heading found, so the list could not be separated.', ...r.warnings.filter((w) => !w.startsWith("No reference list"))] };
  }
  return crossCheck(parts.body, parts.references);
}

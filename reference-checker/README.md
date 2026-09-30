# reference-checker

Verifies bibliography entries against **Crossref** and **OpenAlex**. Zero runtime dependencies (uses `fetch`), written in TypeScript so it can be dropped into ScholarlyFlow or run as a Supabase Edge Function.

## What it does

For each reference it: parses DOI / year / first author / title → looks up by DOI (or searches by title) on both indexes → scores the best candidate → returns a status and a list of issues.

| Status | Meaning |
|---|---|
| `verified` | Strong match (DOI resolves to the same title, or title + year + author agree) |
| `likely` | Plausible match; worth a human glance |
| `unverified` | Nothing convincing found. **Not proof the reference is fake**: books, theses, reports and web pages are poorly indexed |

Issues surfaced: DOI resolves to a *different* paper, year/first-author mismatch, suggested DOI when missing, retracted works (via OpenAlex), and API failures (reported, never thrown).

## In-text citation cross-check

`crossCheckManuscript(text)` compares the citations in the body with the reference list. It is offline and instant (no API calls).

```ts
import { crossCheckManuscript } from "./src/index.ts";
const { style, issues, uncited } = crossCheckManuscript(fullManuscriptText);
```

- **Styles:** author-year (`(Smith & Jones, 2020)`, `Smith et al. (2020)`, `(Smith, 2018a; Doe, 2015, p. 4)`) and numeric (`[1]`, `[1, 3]`, `[2-5]`). The dominant style in the body is used.
- **Reports:** `missing-reference` (cited, not listed), `year-mismatch` (author listed under other years), `ambiguous` (matches several entries, e.g. needs a/b suffix), `unknown-number` (`[7]` with a 4-entry list), and `uncited` (listed, never cited).
- The reference list is found via the last "References" / "Bibliography" / "Works Cited" heading.

Over HTTP: `POST { "manuscript": "...", "verify": true }` returns `{ crossCheck }`, plus the Crossref/OpenAlex results when `verify` is true.

## Use

```ts
import { checkReferences } from "./src/index.ts";

const results = await checkReferences(pastedBibliography, { mailto: "you@scholarlyflow.app" });
```

Set `mailto` so both APIs put you in their faster "polite pool".

### As an HTTP endpoint

`handleRequest(req)` is a web-standard `Request -> Response` handler:

```ts
// supabase/functions/check-references/index.ts
import { handleRequest } from "./reference-checker/src/index.ts";
Deno.serve((req) => handleRequest(req, { mailto: "you@scholarlyflow.app" }));
```

`POST { "text": "..." }` or `{ "references": ["...", "..."] }` → `{ summary, results }`. Max 200 references per request.

## Develop

```
npm install
npm test          # mocked APIs, no network needed
npm run typecheck
```

## Known limits / next steps

- Parsing is regex-based and tuned for APA/Harvard-style entries. For messy input, swap `parseReference` for GROBID or an LLM structured-output call; the rest of the pipeline is unchanged.
- Cross-check matches on first-author surname + year only: it doesn't compare second authors or "et al." vs. author counts (APA 7 rules).
- Corporate authors ("World Health Organization, 2020") and citations without a listed surname (`n.d.`, `in press`) aren't matched. Superscript numeric citations can't be seen in plain text.
- Sections after the reference list (appendices) are treated as references.
- No style validation (APA/MLA/...); CSL + `citeproc-js` is the natural fit.
- Cache is in-memory per call; pass `cache` (e.g. Supabase-backed) to share across requests.
- Scoring weights/thresholds in `src/match.ts` are untuned; test on real bibliographies.
- Not yet run against the live APIs: the sandbox blocks outbound access to them.

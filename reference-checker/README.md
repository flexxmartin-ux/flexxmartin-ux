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
- No in-text citation cross-check yet (`(Smith, 2020)` ↔ list entries).
- No style validation (APA/MLA/...); CSL + `citeproc-js` is the natural fit.
- Cache is in-memory per call; pass `cache` (e.g. Supabase-backed) to share across requests.
- Scoring weights/thresholds in `src/match.ts` are untuned; test on real bibliographies.
- Not yet run against the live APIs: the sandbox blocks outbound access to them.

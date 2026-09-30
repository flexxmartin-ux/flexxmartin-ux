import assert from "node:assert/strict";
import { test } from "node:test";
import { crossCheck, crossCheckManuscript, splitManuscript } from "../src/crosscheck.ts";

const REFS = `
Smith, J., & Jones, A. (2020). Learning in the cloud. Journal of Education, 1, 1-10.
Smith, J. (2018a). Early work. Journal of Education, 2, 1-5.
Smith, J. (2018b). Later work. Journal of Education, 3, 1-5.
van der Berg, K. (2019). Dutch methods. Methods Quarterly, 4, 1-9.
Doe, R. (2015). Never cited anywhere. Nowhere Press.
`;

test("splitManuscript splits at the last References heading", () => {
  const p = splitManuscript("Intro text.\n\n## References\nSmith, J. (2020). X.");
  assert.equal(p?.body.trim(), "Intro text.");
  assert.match(p!.references, /Smith, J\./);
  assert.equal(splitManuscript("No list here."), null);
});

test("author-year: matches parenthetical and narrative forms", () => {
  const body = `
Cloud learning works (Smith & Jones, 2020). Smith and Jones (2020) agree; see also (e.g., van der Berg, 2019, p. 4).
Earlier (Smith, 2018a; Smith, 2018b).`;
  const r = crossCheck(body, REFS);
  assert.equal(r.style, "author-year");
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.uncited.map((u) => u.index), [5]);
});

test("author-year: flags missing references, wrong years, ambiguity", () => {
  const body = "Claims (Nguyen, 2021), (Smith & Jones, 2019), and (Smith, 2018). Also Smith et al. (2020) and Doe (2015).";
  const r = crossCheck(body, REFS);
  const byType = (t: string) => r.issues.filter((i) => i.type === t);
  assert.equal(byType("missing-reference").length, 1);
  assert.match(byType("missing-reference")[0].message, /Nguyen/);
  assert.equal(byType("year-mismatch").length, 1); // Smith 2019
  assert.equal(byType("ambiguous").length, 1); // Smith 2018 -> 2018a / 2018b
  assert.deepEqual(r.uncited.map((u) => u.index), [4]); // Doe cited, van der Berg not
});

test("author-year: multiple years and multi-citation parentheses", () => {
  const r = crossCheck("Work (Smith, 2018a, 2018b; Doe, 2015).", REFS);
  assert.deepEqual(r.issues, []);
  assert.equal(r.citationCount, 3);
});

test("does not treat ordinary parenthetical years as citations", () => {
  const r = crossCheck("It happened in the year (in 2020) and (see Figure 3, 2020).", REFS);
  assert.equal(r.style, "none");
});

test("numeric: ranges, lists, out-of-range and uncited", () => {
  const refs = "1. A. One (2020). T1.\n2. B. Two (2019). T2.\n3. C. Three (2018). T3.\n4. D. Four (2017). T4.";
  const r = crossCheck("Shown in [1, 3] and [1-2], but also [7].", refs);
  assert.equal(r.style, "numeric");
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].type, "unknown-number");
  assert.deepEqual(r.uncited.map((u) => u.index), [4]);
});

test("crossCheckManuscript warns when there is no reference heading", () => {
  const r = crossCheckManuscript("Text (Smith, 2020).");
  assert.ok(r.warnings.some((w) => w.includes("heading")));
  assert.equal(r.issues[0]?.type, "missing-reference");
});

test("crossCheckManuscript works end to end", () => {
  const r = crossCheckManuscript(`Intro (Doe, 2015).\n\nReferences\nDoe, R. (2015). A title. Press.\nRoe, P. (2014). Another title. Press.`);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.uncited.map((u) => u.index), [2]);
});

test("handler: manuscript cross-check without network", async () => {
  const { handleRequest } = await import("../src/handler.ts");
  const res = await handleRequest(
    new Request("http://x", { method: "POST", body: JSON.stringify({ manuscript: "A (Doe, 2015).\n\nReferences\nRoe, P. (2014). T. Press." }) }),
  );
  const out = (await res.json()) as { crossCheck: { issues: unknown[]; uncited: unknown[] } };
  assert.equal(out.crossCheck.issues.length, 1);
  assert.equal(out.crossCheck.uncited.length, 1);
});

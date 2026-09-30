import assert from "node:assert/strict";
import { test } from "node:test";
import { checkReferences } from "../src/checker.ts";
import { parseReference, splitReferences } from "../src/parse.ts";

const LECUN = {
  DOI: "10.1038/nature14539",
  title: ["Deep learning"],
  "container-title": ["Nature"],
  issued: { "date-parts": [[2015]] },
  author: [{ family: "LeCun" }, { family: "Bengio" }],
};

/** Fake fetch that serves canned Crossref/OpenAlex responses. */
function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [needle, body] of Object.entries(routes)) {
      if (url.includes(needle)) {
        if (body === 404) return new Response("", { status: 404 });
        if (body === 500) return new Response("", { status: 500 });
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

test("splitReferences handles numbered, wrapped and blank-separated lists", () => {
  assert.deepEqual(splitReferences("1. Smith, J. (2020). A.\n   Wrapped line.\n2. Doe, A. (2019). B."), [
    "Smith, J. (2020). A. Wrapped line.",
    "Doe, A. (2019). B.",
  ]);
  assert.equal(splitReferences("Smith (2020). A.\n\nDoe (2019). B.").length, 2);
  assert.equal(splitReferences("Smith (2020). A.\nDoe (2019). B.").length, 2);
});

test("parseReference extracts DOI, year, author and APA title", () => {
  const p = parseReference("LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521, 436. https://doi.org/10.1038/nature14539.");
  assert.equal(p.doi, "10.1038/nature14539");
  assert.equal(p.year, 2015);
  assert.equal(p.firstAuthor, "LeCun");
  assert.equal(p.title, "Deep learning");
});

test("verifies a reference by DOI", async () => {
  const [r] = await checkReferences(
    ["LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521, 436. https://doi.org/10.1038/nature14539"],
    { fetch: fakeFetch({ "api.crossref.org/works/10.1038": { message: LECUN }, "api.openalex.org/works/https": 404 }) },
  );
  assert.equal(r.status, "verified");
  assert.equal(r.match?.source, "crossref");
  assert.deepEqual(r.issues, []);
});

test("flags a DOI that resolves to a different paper", async () => {
  const [r] = await checkReferences(
    ["Smith, J. (2020). Quantum gravity in wet ecosystems. Journal of Nothing, 1, 1. doi:10.1038/nature14539"],
    { fetch: fakeFetch({ "api.crossref.org/works/10.1038": { message: LECUN }, "api.openalex.org/works/https": 404 }) },
  );
  assert.equal(r.status, "unverified");
  assert.ok(r.issues.some((i) => i.includes("different paper")));
});

test("searches by title when there is no DOI and suggests the DOI", async () => {
  const [r] = await checkReferences(["LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521, 436."], {
    fetch: fakeFetch({ "api.crossref.org/works?query": { message: { items: [LECUN] } }, "api.openalex.org/works?search": { results: [] } }),
  });
  assert.equal(r.status, "verified");
  assert.ok(r.issues.some((i) => i.includes("Suggested DOI: 10.1038/nature14539")));
});

test("reports year and author mismatches", async () => {
  const [r] = await checkReferences(["Smith, J. (2010). Deep learning. Nature, 521, 436."], {
    fetch: fakeFetch({ "api.crossref.org/works?query": { message: { items: [LECUN] } }, "api.openalex.org/works?search": { results: [] } }),
  });
  assert.ok(r.issues.some((i) => i.startsWith("Year differs")));
  assert.ok(r.issues.some((i) => i.startsWith("First author differs")));
  assert.notEqual(r.status, "verified");
});

test("unknown reference is unverified, and API failures are reported not thrown", async () => {
  const [r] = await checkReferences(["Nobody, N. (1999). A book that is not indexed anywhere at all."], {
    fetch: fakeFetch({ "api.crossref.org": 500, "api.openalex.org": { results: [] } }),
  });
  assert.equal(r.status, "unverified");
  assert.ok(r.issues.some((i) => i.includes("Crossref lookup failed")));
});

test("OpenAlex retraction flag is surfaced and results keep input order", async () => {
  const oa = {
    doi: "https://doi.org/10.1/x",
    display_name: "Deep learning",
    publication_year: 2015,
    is_retracted: true,
    authorships: [{ author: { display_name: "Yann LeCun" } }],
  };
  const out = await checkReferences(
    ["LeCun, Y. (2015). Deep learning. Nature.", "LeCun, Y. (2015). Deep learning. Nature."],
    { fetch: fakeFetch({ "api.crossref.org": { message: { items: [] } }, "api.openalex.org/works?search": { results: [oa] } }) },
  );
  assert.deepEqual(out.map((r) => r.index), [0, 1]);
  assert.ok(out[0].issues.some((i) => i.includes("retracted")));
});

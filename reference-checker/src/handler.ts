import { checkReferences } from "./checker.ts";
import { crossCheckManuscript, splitManuscript } from "./crosscheck.ts";
import { splitReferences } from "./parse.ts";

const MAX_REFERENCES = 200;

/**
 * Web-standard handler (Request -> Response), so it runs unchanged as a
 * Supabase Edge Function (Deno), Cloudflare Worker, or behind Express/Next.
 *
 * POST { "text": "<pasted bibliography>" }  or  { "references": ["...", "..."] }
 * POST { "manuscript": "<body + References section>", "verify"?: boolean }
 *   -> { crossCheck }, plus { summary, results } when verify is true (default false; it hits the network)
 */
export async function handleRequest(req: Request, opts: { mailto?: string } = {}): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: { text?: unknown; references?: unknown; manuscript?: unknown; verify?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (typeof body.manuscript === "string") {
    const out: Record<string, unknown> = { crossCheck: crossCheckManuscript(body.manuscript) };
    const list = splitManuscript(body.manuscript)?.references;
    if (body.verify === true && list) {
      const refs = splitReferences(list);
      if (refs.length > MAX_REFERENCES) return json({ error: `Max ${MAX_REFERENCES} references per request` }, 413);
      Object.assign(out, await verify(refs, opts.mailto));
    }
    return json(out);
  }

  const input =
    typeof body.text === "string"
      ? body.text
      : Array.isArray(body.references) && body.references.every((r) => typeof r === "string")
        ? (body.references as string[])
        : null;
  if (input === null) return json({ error: "Provide `text` (string) or `references` (string[])" }, 400);

  const references = typeof input === "string" ? splitReferences(input) : input;
  if (references.length > MAX_REFERENCES) return json({ error: `Max ${MAX_REFERENCES} references per request` }, 413);

  return json(await verify(references, opts.mailto));
}

async function verify(references: string[], mailto?: string) {
  const results = await checkReferences(references, { mailto });
  const summary = {
    total: results.length,
    verified: results.filter((r) => r.status === "verified").length,
    likely: results.filter((r) => r.status === "likely").length,
    unverified: results.filter((r) => r.status === "unverified").length,
  };
  return { summary, results };
}

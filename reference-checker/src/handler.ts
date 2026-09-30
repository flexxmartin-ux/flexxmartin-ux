import { checkReferences } from "./checker.ts";
import { splitReferences } from "./parse.ts";

const MAX_REFERENCES = 200;

/**
 * Web-standard handler (Request -> Response), so it runs unchanged as a
 * Supabase Edge Function (Deno), Cloudflare Worker, or behind Express/Next.
 *
 * POST { "text": "<pasted bibliography>" }  or  { "references": ["...", "..."] }
 */
export async function handleRequest(req: Request, opts: { mailto?: string } = {}): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: { text?: unknown; references?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
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

  const results = await checkReferences(references, { mailto: opts.mailto });

  const summary = {
    total: results.length,
    verified: results.filter((r) => r.status === "verified").length,
    likely: results.filter((r) => r.status === "likely").length,
    unverified: results.filter((r) => r.status === "unverified").length,
  };
  return json({ summary, results });
}

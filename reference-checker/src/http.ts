import type { FetchLike } from "./types.ts";

/** GET JSON with a timeout. Returns null on 404; throws on other failures. */
export async function getJson<T>(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<T | null> {
  const res = await fetchImpl(url, {
    headers: { accept: "application/json", ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return (await res.json()) as T;
}

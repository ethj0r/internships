export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const USER_AGENT = "Sietch/1.0 (personal internship search; +https://github.com/ethj0r/sietch)";

export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 25_000, headers, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(res.status, `${new URL(url).host} responded ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Fetches an HTML page with a size cap, for importing a single job posting by URL. */
export async function fetchHtml(url: string, maxBytes = 3_000_000): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    throw new HttpError(res.status, `${new URL(url).host} responded ${res.status}`);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size > maxBytes ? chunks.reduce((n, c) => n + c.byteLength, 0) : size);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

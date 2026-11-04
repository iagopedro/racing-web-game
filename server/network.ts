export const USER_AGENT = 'SantaBrisaGeo/1.0 (+https://github.com/iagopedro/racing-web-game)';
export class HTTPError extends Error {
  readonly status: number;
  constructor(url: string, status: number) {
    super(`${new URL(url).hostname}: HTTP ${status}${status === 429 ? ' (limite de uso; tente mais tarde)' : ''}`);
    this.status = status;
  }
}

export async function remote(url: string, signal: AbortSignal, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...init, signal, redirect: 'error',
    headers: { 'User-Agent': USER_AGENT, ...init.headers },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new HTTPError(url, response.status);
  }
  return response;
}

export async function* chunks(response: Response, maxBytes: number): AsyncGenerator<Uint8Array> {
  if (!response.body) throw new Error('Fonte retornou resposta vazia.');
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('Download excede o limite de dados. Reduza o recorte ou desative a fonte complementar.');
      yield value;
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
}

export async function text(response: Response, maxBytes = 32 * 1024 * 1024): Promise<string> {
  const buffers: Uint8Array[] = [];
  for await (const chunk of chunks(response, maxBytes)) buffers.push(chunk);
  return Buffer.concat(buffers).toString('utf8');
}
export async function json(url: string, signal: AbortSignal, init?: RequestInit): Promise<unknown> {
  return JSON.parse(await text(await remote(url, signal, init)));
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Resposta de dados invalida.');
  return value as Record<string, unknown>;
}
export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Lista ausente na resposta da fonte.');
  return value;
}
export function httpsLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : undefined; }
  catch { return undefined; }
}

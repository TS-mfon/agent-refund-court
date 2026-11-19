import { z } from 'zod';
export class DemoHttpError extends Error {
  readonly serverErrorCode?: string;
  constructor(readonly code: string, serverErrorCode?: unknown) {
    super(code); this.name = 'DemoHttpError';
    this.serverErrorCode = typeof serverErrorCode === 'string' && /^[A-Z0-9_]{1,80}$/.test(serverErrorCode) ? serverErrorCode : undefined;
  }
}
export function demoOrigin(input: string): string {
  const url = new URL(input);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    throw new DemoHttpError('INVALID_SERVICE_ORIGIN');
  return url.origin;
}
export async function apiRequest(origin: string, accessToken: string, path: string, init?: RequestInit, fetcher: typeof fetch = fetch): Promise<Response> {
  const base = demoOrigin(origin);
  if (!path.startsWith('/api/v1/') || path.includes('..') || !accessToken || accessToken.length > 512) throw new DemoHttpError('INVALID_REQUEST');
  const headers = new Headers(init?.headers); headers.set('Authorization', 'Bearer ' + accessToken); headers.set('Accept', 'application/json');
  if (init?.body) headers.set('Content-Type', 'application/json');
  const response = await fetcher(base + path, { ...init, headers, signal: init?.signal ?? AbortSignal.timeout(55000) });
  if (!response.ok && response.status !== 402) {
    let serverErrorCode: unknown;
    try {
      const text = await response.text();
      if (Buffer.byteLength(text) <= 8192) {
        const body = JSON.parse(text) as { error?: { code?: unknown } } | null;
        serverErrorCode = body?.error?.code;
      }
    } catch { /* The HTTP status still reports failure when no safe JSON diagnostic is available. */ }
    throw new DemoHttpError('HTTP_' + response.status, serverErrorCode);
  }
  return response;
}
export async function apiJSON<T>(origin: string, token: string, path: string, schema: z.ZodType<T>, data?: unknown, fetcher?: typeof fetch): Promise<T> {
  const response = await apiRequest(origin, token, path, data === undefined ? undefined : { method: 'POST', body: JSON.stringify(data) }, fetcher);
  return schema.parse(await response.json());
}
export function cliArguments(args: string[]) {
  let result: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!flag?.startsWith('--') || !value || value.startsWith('--') || result[flag.slice(2)]) throw new DemoHttpError('INVALID_ARGUMENTS');
    result = { ...result, [flag.slice(2)]: value };
  }
  return result;
}
export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

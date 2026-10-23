import { ApiProblem } from './models';

const API_PREFIX = '/api/';
export const LOGIN_URL = '/api/v1/auth/token';

export function newCorrelationId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `ui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export type Query = Record<string, string | number | boolean | string[] | null | undefined>;

/** Builds a query string, dropping empty values so filters that are not set never reach the server. */
export function toSearchParams(query: Query): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') {
      continue;
    }
    if (Array.isArray(value)) {
      value.filter((v) => v !== '').forEach((v) => params.append(key, v));
    } else {
      params.set(key, String(value));
    }
  }
  return params;
}

export interface HttpResult<T> {
  data: T;
  status: number;
  headers: Headers;
}

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface HttpDeps {
  /** Current access token (held in memory by the auth provider), or null. */
  getToken: () => string | null;
  /** Called when a protected call is answered with 401 (the session has ended). */
  onUnauthorized: () => void;
  fetchImpl?: typeof fetch;
}

/** Normalises every failure into an {@link ApiProblem}. */
export async function toProblem(res: Response | null, cause?: unknown): Promise<ApiProblem> {
  if (res === null) {
    if (cause instanceof TypeError) {
      return { status: 0, code: 'NETWORK_ERROR', message: 'The server could not be reached. Check your connection and retry.', violations: [], details: {} };
    }
    return { status: -1, code: 'UNEXPECTED', message: 'An unexpected error occurred.', violations: [], details: {} };
  }
  let body: Partial<{
    code: string; message: string; violations: { field: string; message: string }[];
    details: Record<string, unknown>; correlationId: string;
  }> = {};
  try {
    body = (await res.json()) ?? {};
  } catch {
    body = {};
  }
  return {
    status: res.status,
    code: body.code ?? `HTTP_${res.status}`,
    message: body.message ?? (res.statusText || 'Request failed'),
    violations: body.violations ?? [],
    details: body.details ?? {},
    correlationId: body.correlationId ?? res.headers.get('X-Correlation-Id') ?? undefined,
  };
}

/**
 * Thin fetch wrapper with the same behaviour as the Angular interceptors: bearer token on API calls only (never on the
 * login call or third-party URLs), a correlation id on every API call, normalised errors, and session end on 401.
 */
export function createHttp(deps: HttpDeps) {
  const doFetch = (...args: Parameters<typeof fetch>) => (deps.fetchImpl ?? fetch)(...args);

  async function request<T>(method: string, url: string, opts: RequestOptions = {}): Promise<HttpResult<T>> {
    const isApi = url.startsWith(API_PREFIX);
    const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const token = deps.getToken();
    if (isApi && token && url !== LOGIN_URL) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (isApi && !('X-Correlation-Id' in headers)) {
      headers['X-Correlation-Id'] = newCorrelationId();
    }
    const qs = opts.query ? toSearchParams(opts.query).toString() : '';
    let res: Response;
    try {
      res = await doFetch(qs ? `${url}?${qs}` : url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        credentials: 'same-origin',
      });
    } catch (cause) {
      throw await toProblem(null, cause);
    }
    if (!res.ok) {
      const problem = await toProblem(res);
      if (problem.status === 401 && url !== LOGIN_URL) {
        deps.onUnauthorized();
      }
      throw problem;
    }
    const text = res.status === 204 ? '' : await res.text();
    return { data: (text ? JSON.parse(text) : undefined) as T, status: res.status, headers: res.headers };
  }

  return {
    get: <T>(url: string, query?: Query) => request<T>('GET', url, { query }),
    post: <T>(url: string, body: unknown = {}, headers?: Record<string, string>) => request<T>('POST', url, { body, headers }),
  };
}

export type Http = ReturnType<typeof createHttp>;

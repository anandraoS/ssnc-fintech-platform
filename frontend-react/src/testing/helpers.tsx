import { render } from '@testing-library/react';
import { ReactNode, useEffect, useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { App } from '../App';
import { AuthProvider, useAuth } from '../core/auth';
import { Role } from '../core/models';

export interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
  body: Record<string, unknown> | undefined;
}

export interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type Handler = Reply | ((call: Call) => Reply | Promise<Reply>);

/** Scripted backend: a fake fetch that records every call and answers from registered handlers ("GET /api/v1/x"). */
export class FakeApi {
  readonly calls: Call[] = [];
  private readonly handlers = new Map<string, Handler>();

  on(key: string, handler: Handler): this {
    this.handlers.set(key, handler);
    return this;
  }

  callsTo(key: string): Call[] {
    const [method, path] = key.split(' ');
    return this.calls.filter((c) => c.method === method && c.path === path);
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const call: Call = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname,
      query: url.searchParams,
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
    };
    this.calls.push(call);
    const handler = this.handlers.get(`${call.method} ${call.path}`);
    if (handler === undefined) {
      return new Response(JSON.stringify({ code: 'NOT_FOUND', message: `no handler for ${call.method} ${call.path}` }), { status: 404 });
    }
    const reply = typeof handler === 'function' ? await handler(call) : handler;
    const status = reply.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), { status, headers: reply.headers });
  };
}

export function page<T>(items: T[], extra: Partial<{ page: number; size: number; totalElements: number; totalPages: number }> = {}) {
  return { items, page: 0, size: 20, totalElements: items.length, totalPages: 1, ...extra };
}

export const TX = {
  id: '11111111-1111-4111-8111-111111111111', reference: 'TXN-ABC123', type: 'WITHDRAWAL' as const,
  status: 'COMPLETED' as const, sourceAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', amount: '25.00', currency: 'USD',
  submittedBy: 'alice.customer', version: 1, createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T10:00:01Z',
  completedAt: '2026-01-01T10:00:01Z',
};

export const ACCOUNT = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', accountNumber: 'ACC-1000000001', customerId: 'c1', accountType: 'BROKERAGE' as const,
  status: 'ACTIVE' as const, currency: 'USD', balance: '1000.00', availableBalance: '1000.00', minimumBalance: '0.00',
  dailyWithdrawalLimit: '10000.00', version: 1, openedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

export function tokenReply(roles: Role[], username = 'tester', customerId: string | null = null, expiresInSeconds = 1800): Reply {
  return { body: { accessToken: 'test-token', tokenType: 'Bearer', expiresInSeconds, username, roles, customerId } };
}

/** Test-only: signs in through the real login call, then renders the app (so deep links survive the auth guard). */
export function LoginThen({ username, children }: { username: string; children: ReactNode }) {
  const auth = useAuth();
  const [signedInOnce, setSignedInOnce] = useState(false);
  useEffect(() => {
    void auth.login(username, 'x').then(() => setSignedInOnce(true));
    // sign in once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // after the first sign-in the children stay mounted, so tests can observe sign-out redirects
  return signedInOnce || auth.isAuthenticated ? <>{children}</> : null;
}

export function LocationProbe() {
  const l = useLocation();
  return <output data-testid="location">{l.pathname + l.search}</output>;
}

export interface RenderOptions {
  roles?: Role[];
  username?: string;
  customerId?: string | null;
  api?: FakeApi;
}

/** Renders the whole application at `path`, signed in as the given user, against a scripted backend. */
export function renderApp(path: string, { roles = ['ADMIN'], username = 'tester', customerId = null, api = new FakeApi() }: RenderOptions = {}) {
  api.on('POST /api/v1/auth/token', tokenReply(roles, username, customerId));
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider fetchImpl={api.fetch}>
        <LoginThen username={username}>
          <App />
        </LoginThen>
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>,
  );
  return { api, ...utils };
}

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { FakeApi, LocationProbe, LoginThen, page, tokenReply } from '../testing/helpers';
import { Api, createApi } from './api';
import { AuthProvider, AuthState, RequireAuth, RequireRole, useApi, useAuth } from './auth';
import { createHttp, toProblem, toSearchParams } from './http';
import { IdempotencyKeys } from './idempotency';
import { ApiProblem, Role } from './models';

function makeHttp(api: FakeApi, token: string | null = 'test-token', onUnauthorized = vi.fn()) {
  return { http: createHttp({ fetchImpl: api.fetch, getToken: () => token, onUnauthorized }), onUnauthorized };
}

describe('HTTP client', () => {
  it('adds the bearer token and a correlation id to API calls only', async () => {
    const api = new FakeApi().on('GET /api/v1/accounts', { body: {} }).on('GET /data', { body: {} });
    const { http } = makeHttp(api);
    await http.get('/api/v1/accounts');
    const call = api.calls[0];
    expect(call.headers.get('Authorization')).toBe('Bearer test-token');
    expect(call.headers.get('X-Correlation-Id')).toMatch(/.{8,}/);
    await http.get('/data');
    expect(api.calls[1].headers.has('Authorization')).toBe(false);
    expect(api.calls[1].headers.has('X-Correlation-Id')).toBe(false);
  });

  it('never sends the token to the login endpoint', async () => {
    const api = new FakeApi().on('POST /api/v1/auth/token', tokenReply(['ADMIN']));
    await makeHttp(api).http.post('/api/v1/auth/token', {});
    expect(api.calls[0].headers.has('Authorization')).toBe(false);
  });

  it('normalises API errors into ApiProblem', async () => {
    const api = new FakeApi().on('GET /api/v1/x', {
      status: 409, body: { code: 'CONFLICT', message: 'nope', violations: [{ field: 'amount', message: 'bad' }], correlationId: 'corr-1' },
    });
    const p = (await makeHttp(api).http.get('/api/v1/x').catch((e: ApiProblem) => e)) as ApiProblem;
    expect(p.status).toBe(409);
    expect(p.code).toBe('CONFLICT');
    expect(p.violations[0].field).toBe('amount');
    expect(p.correlationId).toBe('corr-1');
  });

  it('turns a network failure into a friendly NETWORK_ERROR', async () => {
    const http = createHttp({ getToken: () => null, onUnauthorized: vi.fn(), fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')) });
    const p = (await http.get('/api/v1/x').catch((e: ApiProblem) => e)) as ApiProblem;
    expect(p.code).toBe('NETWORK_ERROR');
    expect(p.status).toBe(0);
  });

  it('copes with error bodies that are not JSON and with non-HTTP errors', async () => {
    const res = new Response('<html>bad gateway</html>', { status: 502, statusText: 'Bad Gateway' });
    expect(await toProblem(res)).toMatchObject({ status: 502, code: 'HTTP_502', message: 'Bad Gateway' });
    expect((await toProblem(null, new Error('x'))).code).toBe('UNEXPECTED');
  });

  it('ends the session on 401 from a protected call, but not on a failed login', async () => {
    const api = new FakeApi()
      .on('GET /api/v1/x', { status: 401, body: { code: 'INVALID_TOKEN', message: 'x' } })
      .on('POST /api/v1/auth/token', { status: 401, body: { code: 'INVALID_CREDENTIALS', message: 'x' } });
    const { http, onUnauthorized } = makeHttp(api);
    await http.get('/api/v1/x').catch(() => undefined);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await http.post('/api/v1/auth/token', {}).catch(() => undefined);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('toSearchParams drops empty values and repeats array parameters', () => {
    const p = toSearchParams({ a: 'x', b: '', c: null, d: undefined, e: ['1', '2'], f: 0, g: false });
    expect(p.getAll('a')).toEqual(['x']);
    expect(p.has('b')).toBe(false);
    expect(p.has('c')).toBe(false);
    expect(p.has('d')).toBe(false);
    expect(p.getAll('e')).toEqual(['1', '2']);
    expect(p.get('f')).toBe('0');
    expect(p.get('g')).toBe('false');
  });
});

describe('API facade', () => {
  it('submits a transaction with the Idempotency-Key header and returns status and replay flag', async () => {
    const api = new FakeApi().on('POST /api/v1/transactions', { status: 202, body: { id: '1' }, headers: { 'Idempotent-Replayed': 'true' } });
    const result = await createApi(makeHttp(api).http).submit({ type: 'DEPOSIT', targetAccountId: 't', amount: '10.00', currency: 'USD' }, 'key-12345678');
    const call = api.calls[0];
    expect(call.method).toBe('POST');
    expect(call.headers.get('Idempotency-Key')).toBe('key-12345678');
    expect(call.body?.['amount']).toBe('10.00'); // amounts travel as strings
    expect(result.status).toBe(202);
    expect(result.replayed).toBe(true);
  });

  it('builds the expected URLs for searches and actions', async () => {
    const api = new FakeApi()
      .on('GET /api/v1/transactions', { body: page([]) })
      .on('POST /api/v1/accounts/acc/suspend', { body: {} })
      .on('POST /api/v1/ops/reconciliations/rec/resolve', { body: {} });
    const client = createApi(makeHttp(api).http);
    await client.transactions({ status: ['FAILED', 'REJECTED'], type: '', size: 10, minAmount: '5.00' });
    const search = api.calls[0];
    expect(search.query.getAll('status')).toEqual(['FAILED', 'REJECTED']);
    expect(search.query.has('type')).toBe(false);
    expect(search.query.get('minAmount')).toBe('5.00');

    await client.accountAction('acc', 'suspend', 'fraud check');
    expect(api.calls[1].body).toEqual({ reason: 'fraud check' });
    await client.resolveReconciliation('rec', 'CONFIRMED_NOT_EXECUTED', 'n');
    expect(api.calls[2].body).toEqual({ resolution: 'CONFIRMED_NOT_EXECUTED', note: 'n' });
  });
});

describe('IdempotencyKeys', () => {
  it('reuses the key while the payload is unchanged and issues a new one when it changes', () => {
    const keys = new IdempotencyKeys();
    const a = keys.keyFor({ amount: '10.00' });
    expect(keys.keyFor({ amount: '10.00' })).toBe(a);
    const b = keys.keyFor({ amount: '11.00' });
    expect(b).not.toBe(a);
    expect(keys.keyFor({ amount: '11.00' })).toBe(b);
  });

  it('reset() makes the next submission a new logical request', () => {
    const keys = new IdempotencyKeys();
    const a = keys.keyFor({ amount: '10.00' });
    keys.reset();
    expect(keys.keyFor({ amount: '10.00' })).not.toBe(a);
  });
});

/** Exposes the auth state and the API facade to the test through a callback. */
function Probe({ onAuth }: { onAuth: (a: AuthState, api: Api) => void }) {
  onAuth(useAuth(), useApi());
  return null;
}

function mountAuth(api: FakeApi) {
  let auth!: AuthState;
  let client!: Api;
  render(
    <MemoryRouter initialEntries={['/accounts?x=1']}>
      <AuthProvider fetchImpl={api.fetch}>
        <Probe onAuth={(a, c) => { auth = a; client = c; }} />
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>,
  );
  return { auth: () => auth, client: () => client };
}

describe('AuthProvider', () => {
  it('starts signed out and signs in via the token endpoint', async () => {
    const api = new FakeApi().on('POST /api/v1/auth/token', tokenReply(['OPERATIONS_ANALYST'], 'omar.ops'));
    const { auth } = mountAuth(api);
    expect(auth().isAuthenticated).toBe(false);
    await act(() => auth().login('omar.ops', 'x'));
    expect(auth().isAuthenticated).toBe(true);
    expect(auth().user?.username).toBe('omar.ops');
    expect(auth().isStaff).toBe(true);
    expect(auth().isOperator).toBe(true);
    expect(auth().isAdmin).toBe(false);
    expect(auth().isCustomer).toBe(false);
  });

  it('keeps the token in memory only - nothing is written to web storage', async () => {
    localStorage.clear();
    sessionStorage.clear();
    const api = new FakeApi().on('POST /api/v1/auth/token', tokenReply(['CUSTOMER'], 'alice.customer', 'c1'));
    const { auth } = mountAuth(api);
    await act(() => auth().login('alice.customer', 'x'));
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(auth().user?.token).toBe('test-token');
  });

  it('logout clears the session and navigates to the login page with a returnUrl', async () => {
    const api = new FakeApi().on('POST /api/v1/auth/token', tokenReply(['ADMIN']));
    const { auth } = mountAuth(api);
    await act(() => auth().login('u', 'x'));
    act(() => auth().logout('/accounts'));
    expect(auth().isAuthenticated).toBe(false);
    expect(auth().user).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent('/login?returnUrl=%2Faccounts');
  });

  it('treats an expired session as signed out', async () => {
    const api = new FakeApi().on('POST /api/v1/auth/token', tokenReply(['ADMIN'], 'u', null, -1));
    const { auth } = mountAuth(api);
    await act(() => auth().login('u', 'x'));
    expect(auth().isAuthenticated).toBe(false);
  });

  it('sends the in-memory token on API calls and signs the user out when a protected call returns 401', async () => {
    const api = new FakeApi()
      .on('POST /api/v1/auth/token', tokenReply(['ADMIN']))
      .on('GET /api/v1/accounts', { status: 401, body: { code: 'INVALID_TOKEN', message: 'expired' } });
    const { auth, client } = mountAuth(api);
    await act(() => auth().login('u', 'x'));
    expect(auth().isAuthenticated).toBe(true);
    await act(async () => { await client().accounts({}).catch(() => undefined); });
    expect(api.callsTo('GET /api/v1/accounts')[0].headers.get('Authorization')).toBe('Bearer test-token');
    expect(auth().isAuthenticated).toBe(false);
    expect(screen.getByTestId('location')).toHaveTextContent('/login?returnUrl=%2Faccounts%3Fx%3D1');
  });
});

describe('route guards', () => {
  function guarded(roles: Role[], required: Role[], signedIn = true) {
    const api = new FakeApi().on('POST /api/v1/auth/token', tokenReply(roles));
    const routes = (
      <Routes>
        <Route path="/login" element={<p>login page</p>} />
        <Route path="/forbidden" element={<p>forbidden page</p>} />
        <Route path="/accounts" element={<RequireAuth><RequireRole roles={required}><p>secret</p></RequireRole></RequireAuth>} />
      </Routes>
    );
    render(
      <MemoryRouter initialEntries={['/accounts?z=1']}>
        <AuthProvider fetchImpl={api.fetch}>
          {signedIn ? <LoginThen username="u">{routes}</LoginThen> : routes}
          <LocationProbe />
        </AuthProvider>
      </MemoryRouter>,
    );
  }

  it('RequireAuth redirects anonymous users to /login with a returnUrl', () => {
    guarded([], [], false);
    expect(screen.getByText('login page')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/login?returnUrl=%2Faccounts%3Fz%3D1');
  });

  it('RequireAuth lets signed-in users through', async () => {
    guarded(['CUSTOMER'], []);
    expect(await screen.findByText('secret')).toBeInTheDocument();
  });

  it('RequireRole allows matching roles and an empty role list', async () => {
    guarded(['SUPPORT_AGENT'], ['SUPPORT_AGENT', 'ADMIN']);
    expect(await screen.findByText('secret')).toBeInTheDocument();
  });

  it('RequireRole redirects other roles to /forbidden', async () => {
    guarded(['SUPPORT_AGENT'], ['ADMIN']);
    expect(await screen.findByText('forbidden page')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/forbidden');
  });
});

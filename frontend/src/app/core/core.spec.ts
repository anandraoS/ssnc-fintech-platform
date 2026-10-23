import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { loginAs, page } from '../../testing/helpers';
import { ApiService, toParams } from './api.service';
import { AuthService } from './auth.service';
import { authGuard, roleGuard } from './guards';
import { IdempotencyKeys } from './idempotency';
import { authInterceptor, correlationInterceptor, errorInterceptor, toProblem } from './interceptors';
import { ApiProblem } from './models';

function configure(): { http: HttpClient; ctl: HttpTestingController } {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'login', children: [] }]),
      provideHttpClient(withInterceptors([errorInterceptor, authInterceptor, correlationInterceptor])),
      provideHttpClientTesting(),
    ],
  });
  return { http: TestBed.inject(HttpClient), ctl: TestBed.inject(HttpTestingController) };
}

describe('AuthService', () => {
  it('starts signed out and signs in via the token endpoint', () => {
    const { ctl } = configure();
    const auth = TestBed.inject(AuthService);
    expect(auth.isAuthenticated()).toBeFalse();
    loginAs(['OPERATIONS_ANALYST'], 'omar.ops');
    expect(auth.isAuthenticated()).toBeTrue();
    expect(auth.user()?.username).toBe('omar.ops');
    expect(auth.isStaff()).toBeTrue();
    expect(auth.isOperator()).toBeTrue();
    expect(auth.isAdmin()).toBeFalse();
    expect(auth.isCustomer()).toBeFalse();
    ctl.verify();
  });

  it('keeps the token in memory only - nothing is written to web storage', () => {
    configure();
    localStorage.clear();
    sessionStorage.clear();
    loginAs(['CUSTOMER'], 'alice.customer', 'c1');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(TestBed.inject(AuthService).token()).toBe('test-token');
  });

  it('logout clears the session and navigates to the login page', () => {
    configure();
    const router = TestBed.inject(Router);
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    loginAs(['ADMIN']);
    TestBed.inject(AuthService).logout('/accounts');
    expect(TestBed.inject(AuthService).isAuthenticated()).toBeFalse();
    expect(TestBed.inject(AuthService).token()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/accounts' } });
  });

  it('treats an expired session as signed out', () => {
    configure();
    const auth = TestBed.inject(AuthService);
    const http = TestBed.inject(HttpTestingController);
    auth.login('u', 'p').subscribe();
    http.expectOne('/api/v1/auth/token').flush({ accessToken: 't', tokenType: 'Bearer', expiresInSeconds: -1, username: 'u', roles: ['ADMIN'], customerId: null });
    expect(auth.isAuthenticated()).toBeFalse();
  });
});

describe('HTTP interceptors', () => {
  it('adds the bearer token and a correlation id to API calls only', () => {
    const { http, ctl } = configure();
    loginAs(['ADMIN']);
    http.get('/api/v1/accounts').subscribe();
    const api = ctl.expectOne('/api/v1/accounts');
    expect(api.request.headers.get('Authorization')).toBe('Bearer test-token');
    expect(api.request.headers.get('X-Correlation-Id')).toMatch(/.{8,}/);
    api.flush({});
    http.get('https://third-party.example/data').subscribe();
    const other = ctl.expectOne('https://third-party.example/data');
    expect(other.request.headers.has('Authorization')).toBeFalse();
    expect(other.request.headers.has('X-Correlation-Id')).toBeFalse();
    other.flush({});
  });

  it('never sends the token to the login endpoint', () => {
    const { http, ctl } = configure();
    loginAs(['ADMIN']);
    http.post('/api/v1/auth/token', {}).subscribe();
    expect(ctl.expectOne('/api/v1/auth/token').request.headers.has('Authorization')).toBeFalse();
  });

  it('normalises API errors into ApiProblem', (done) => {
    const { http, ctl } = configure();
    loginAs(['ADMIN']);
    http.get('/api/v1/x').subscribe({
      error: (p: ApiProblem) => {
        expect(p.status).toBe(409);
        expect(p.code).toBe('CONFLICT');
        expect(p.violations[0].field).toBe('amount');
        expect(p.correlationId).toBe('corr-1');
        done();
      },
    });
    ctl.expectOne('/api/v1/x').flush({ code: 'CONFLICT', message: 'nope', violations: [{ field: 'amount', message: 'bad' }], correlationId: 'corr-1' }, { status: 409, statusText: 'Conflict' });
  });

  it('turns a network failure into a friendly NETWORK_ERROR', (done) => {
    const { http, ctl } = configure();
    http.get('/api/v1/x').subscribe({ error: (p: ApiProblem) => { expect(p.code).toBe('NETWORK_ERROR'); done(); } });
    ctl.expectOne('/api/v1/x').error(new ProgressEvent('error'), { status: 0 });
  });

  it('signs the user out on 401 from a protected call, but not on a failed login', () => {
    const { http, ctl } = configure();
    const auth = TestBed.inject(AuthService);
    const logout = spyOn(auth, 'logout');
    http.get('/api/v1/x').subscribe({ error: () => undefined });
    ctl.expectOne('/api/v1/x').flush({ code: 'INVALID_TOKEN', message: 'x' }, { status: 401, statusText: 'Unauthorized' });
    expect(logout).toHaveBeenCalledTimes(1);
    http.post('/api/v1/auth/token', {}).subscribe({ error: () => undefined });
    ctl.expectOne('/api/v1/auth/token').flush({ code: 'INVALID_CREDENTIALS', message: 'x' }, { status: 401, statusText: 'Unauthorized' });
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('toProblem copes with non-HTTP errors', () => {
    expect(toProblem(new Error('x')).code).toBe('UNEXPECTED');
  });
});

describe('route guards', () => {
  function run(guard: typeof authGuard | typeof roleGuard, data: Record<string, unknown> = {}) {
    return TestBed.runInInjectionContext(() => guard({ data } as never, { url: '/accounts' } as never));
  }

  it('authGuard redirects anonymous users to /login with a returnUrl', () => {
    configure();
    expect(String(run(authGuard))).toContain('/login?returnUrl=%2Faccounts');
  });

  it('authGuard lets signed-in users through', () => {
    configure();
    loginAs(['CUSTOMER']);
    expect(run(authGuard)).toBeTrue();
  });

  it('roleGuard allows matching roles and redirects others to /forbidden', () => {
    configure();
    loginAs(['SUPPORT_AGENT']);
    expect(run(roleGuard, { roles: ['SUPPORT_AGENT', 'ADMIN'] })).toBeTrue();
    expect(String(run(roleGuard, { roles: ['ADMIN'] }))).toBe('/forbidden');
    expect(run(roleGuard, {})).toBeTrue();
  });
});

describe('ApiService', () => {
  it('toParams drops empty values and repeats array parameters', () => {
    const p = toParams({ a: 'x', b: '', c: null, d: undefined, e: ['1', '2'], f: 0, g: false });
    expect(p.getAll('a')).toEqual(['x']);
    expect(p.has('b')).toBeFalse();
    expect(p.has('c')).toBeFalse();
    expect(p.has('d')).toBeFalse();
    expect(p.getAll('e')).toEqual(['1', '2']);
    expect(p.get('f')).toBe('0');
    expect(p.get('g')).toBe('false');
  });

  it('submits a transaction with the Idempotency-Key header and returns the full response', () => {
    const { ctl } = configure();
    loginAs(['CUSTOMER']);
    let status = 0;
    TestBed.inject(ApiService).submit({ type: 'DEPOSIT', targetAccountId: 't', amount: '10.00', currency: 'USD' }, 'key-12345678')
      .subscribe((r) => (status = r.status));
    const req = ctl.expectOne('/api/v1/transactions');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Idempotency-Key')).toBe('key-12345678');
    expect(req.request.body.amount).toBe('10.00'); // amounts travel as strings
    req.flush({ id: '1' }, { status: 202, statusText: 'Accepted' });
    expect(status).toBe(202);
  });

  it('builds the expected URLs for searches and actions', () => {
    const { ctl } = configure();
    loginAs(['ADMIN']);
    const api = TestBed.inject(ApiService);
    api.transactions({ status: ['FAILED', 'REJECTED'], type: '', size: 10, minAmount: '5.00' }).subscribe();
    const search = ctl.expectOne((r) => r.url === '/api/v1/transactions');
    expect(search.request.params.getAll('status')).toEqual(['FAILED', 'REJECTED']);
    expect(search.request.params.has('type')).toBeFalse();
    expect(search.request.params.get('minAmount')).toBe('5.00');
    search.flush(page([]));

    api.accountAction('acc', 'suspend', 'fraud check').subscribe();
    const suspend = ctl.expectOne('/api/v1/accounts/acc/suspend');
    expect(suspend.request.body).toEqual({ reason: 'fraud check' });
    suspend.flush({});

    api.resolveReconciliation('rec', 'CONFIRMED_NOT_EXECUTED', 'n').subscribe();
    const resolve = ctl.expectOne('/api/v1/ops/reconciliations/rec/resolve');
    expect(resolve.request.body).toEqual({ resolution: 'CONFIRMED_NOT_EXECUTED', note: 'n' });
    resolve.flush({});
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

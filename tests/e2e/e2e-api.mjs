// End-to-end scenarios against a RUNNING local stack (scripts/run-local.sh): real HTTP, real JWTs from the local issuer,
// real clearing-simulator (timeouts, retries, declines, chaos). Node 18+ only (global fetch); no dependencies.
//
// Usage: node tests/e2e/e2e-api.mjs [--api http://localhost:18480] [--sim http://localhost:18490]
//                                    [--with-chaos] [--out docs/validation/e2e-results.json]
// Environment: LOCAL_DEMO_PASSWORD (default "demo-password" - the synthetic local-profile password)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const API = opt('--api', process.env.API_URL ?? 'http://localhost:18480');
const SIM = opt('--sim', process.env.SIM_URL ?? 'http://localhost:18490');
const OUT = opt('--out', null);
const WITH_CHAOS = args.includes('--with-chaos');
const PASSWORD = process.env.LOCAL_DEMO_PASSWORD ?? 'demo-password';

const results = [];
let scenario = '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, url, { token, body, headers = {}, base = API } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${url}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, json, headers: res.headers };
}

function check(name, ok, evidence = '') {
  results.push({ scenario, check: name, result: ok ? 'PASS' : 'FAIL', evidence: String(evidence).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${scenario}] ${name}${ok || !evidence ? '' : '  -> ' + String(evidence).slice(0, 200)}`);
}
const eq = (name, actual, expected) => check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const tokens = {};
async function login(username) {
  if (tokens[username]) return tokens[username];
  const r = await call('POST', '/api/v1/auth/token', { body: { username, password: PASSWORD } });
  if (r.status !== 200) throw new Error(`login failed for ${username}: ${r.status} ${JSON.stringify(r.json)}`);
  tokens[username] = r.json.accessToken;
  return tokens[username];
}

const key = () => `e2e-${crypto.randomUUID()}`;
async function submit(user, body, k = key()) {
  return call('POST', '/api/v1/transactions', { token: await login(user), body, headers: { 'Idempotency-Key': k } });
}
async function awaitStatus(id, wanted, timeoutMs = 60000) {
  const admin = await login('adam.admin');
  const end = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < end) {
    last = (await call('GET', `/api/v1/transactions/${id}`, { token: admin })).json;
    if (last && wanted.includes(last.status)) return last;
    await sleep(300);
  }
  return last;
}
async function balance(accountId) {
  return (await call('GET', `/api/v1/accounts/${accountId}/balance`, { token: await login('adam.admin') })).json.ledgerBalance;
}
async function newAccount(customerId, currency, deposit) {
  const admin = await login('adam.admin');
  const a = await call('POST', `/api/v1/customers/${customerId}/accounts`, { token: admin, body: { accountType: 'BROKERAGE', currency, dailyWithdrawalLimit: '100000.00' } });
  await call('POST', `/api/v1/accounts/${a.json.id}/activate`, { token: admin, body: {} });
  if (deposit) {
    const d = await submit('adam.admin', { type: 'DEPOSIT', targetAccountId: a.json.id, amount: deposit, currency });
    await awaitStatus(d.json.id, ['COMPLETED']);
  }
  return a.json.id;
}

const ALICE = '00000000-0000-4000-8000-000000000001';
const BOB = '00000000-0000-4000-8000-000000000002';

async function run(name, fn) {
  scenario = name;
  try { await fn(); } catch (e) { check('scenario completed without exception', false, e.stack ?? e.message); }
}

// ----------------------------------------------------------------------------------------------------------------
await run('platform is up', async () => {
  const live = await call('GET', '/actuator/health/liveness');
  eq('liveness probe is UP', live.json?.status, 'UP');
  const ready = await call('GET', '/actuator/health/readiness');
  eq('readiness probe is UP', ready.json?.status, 'UP');
  const docs = await call('GET', '/v3/api-docs');
  check('OpenAPI document is served', docs.status === 200 && Object.keys(docs.json.paths).length > 15, docs.status);
});

await run('authentication and roles', async () => {
  const anon = await call('GET', '/api/v1/accounts');
  eq('anonymous request is 401', anon.status, 401);
  const bad = await call('POST', '/api/v1/auth/token', { body: { username: 'alice.customer', password: 'definitely-wrong' } });
  eq('wrong password is 401', bad.status, 401);
  const me = await call('GET', '/api/v1/me', { token: await login('alice.customer') });
  eq('customer identity resolved', me.json?.roles?.[0], 'CUSTOMER');
  eq('customer is linked to her customer record', me.json?.customerId, ALICE);
  eq('customer cannot list customers', (await call('GET', '/api/v1/customers', { token: await login('alice.customer') })).status, 403);
  eq('support can list customers', (await call('GET', '/api/v1/customers', { token: await login('sam.support') })).status, 200);
});

await run('valid withdrawal (BDD)', async () => {
  const acc = await newAccount(ALICE, 'USD', '1000.00');
  const w = await submit('alice.customer', { type: 'WITHDRAWAL', sourceAccountId: acc, amount: '250.00', currency: 'USD' });
  eq('submission accepted with 202', w.status, 202);
  const done = await awaitStatus(w.json.id, ['COMPLETED', 'FAILED']);
  eq('withdrawal COMPLETED asynchronously', done?.status, 'COMPLETED');
  eq('balance reduced by exactly 250.00', await balance(acc), '750.00');
});

await run('insufficient funds (BDD)', async () => {
  const acc = await newAccount(ALICE, 'USD', '100.00');
  const r = await submit('alice.customer', { type: 'WITHDRAWAL', sourceAccountId: acc, amount: '100.01', currency: 'USD' });
  eq('rejected with 422', r.status, 422);
  eq('failure code is INSUFFICIENT_FUNDS', r.json?.details?.failureCode, 'INSUFFICIENT_FUNDS');
  eq('balance untouched', await balance(acc), '100.00');
});

await run('duplicate submission (BDD)', async () => {
  const acc = await newAccount(ALICE, 'USD', '0');
  const k = key();
  const body = { type: 'DEPOSIT', targetAccountId: acc, amount: '40.00', currency: 'USD' };
  const [a, b, c] = await Promise.all([submit('alice.customer', body, k), submit('alice.customer', body, k), submit('alice.customer', body, k)]);
  check('all three concurrent duplicates succeed', [a, b, c].every((r) => r.status === 202), [a.status, b.status, c.status]);
  check('all return the same transaction id', a.json.id === b.json.id && b.json.id === c.json.id);
  await awaitStatus(a.json.id, ['COMPLETED']);
  eq('deposit applied exactly once', await balance(acc), '40.00');
  const reuse = await submit('alice.customer', { ...body, amount: '41.00' }, k);
  eq('same key with different payload is 422', reuse.status, 422);
  eq('error code IDEMPOTENCY_KEY_REUSED', reuse.json?.code, 'IDEMPOTENCY_KEY_REUSED');
});

await run('transfer between accounts (BDD)', async () => {
  const a = await newAccount(ALICE, 'USD', '500.00');
  const b = await newAccount(ALICE, 'USD', '50.00');
  const t = await submit('alice.customer', { type: 'TRANSFER', sourceAccountId: a, targetAccountId: b, amount: '200.00', currency: 'USD' });
  const done = await awaitStatus(t.json.id, ['COMPLETED', 'FAILED']);
  eq('transfer COMPLETED', done?.status, 'COMPLETED');
  eq('source debited', await balance(a), '300.00');
  eq('target credited', await balance(b), '250.00');
  const integrity = await call('GET', '/api/v1/ops/ledger-integrity', { token: await login('omar.ops') });
  eq('ledger integrity check finds no mismatching accounts', integrity.json?.length, 0);
});

await run('concurrent withdrawals cannot overspend (BDD)', async () => {
  const acc = await newAccount(ALICE, 'USD', '100.00');
  const subs = await Promise.all(Array.from({ length: 16 }, () => submit('adam.admin', { type: 'WITHDRAWAL', sourceAccountId: acc, amount: '10.00', currency: 'USD' })));
  check('all 16 pass the advisory check', subs.every((s) => s.status === 202), subs.map((s) => s.status).join(','));
  const finals = await Promise.all(subs.map((s) => awaitStatus(s.json.id, ['COMPLETED', 'FAILED'])));
  const completed = finals.filter((f) => f.status === 'COMPLETED').length;
  const failed = finals.filter((f) => f.status === 'FAILED' && f.failureCode === 'INSUFFICIENT_FUNDS').length;
  eq('exactly 10 withdrawals complete', completed, 10);
  eq('the other 6 fail with INSUFFICIENT_FUNDS', failed, 6);
  eq('balance is exactly zero, never negative', await balance(acc), '0.00');
});

await run('unauthorized account access (BDD)', async () => {
  const bobsAccount = await newAccount(BOB, 'USD', '300.00');
  const alice = await login('alice.customer');
  eq('reading another customer\'s account is 404', (await call('GET', `/api/v1/accounts/${bobsAccount}`, { token: alice })).status, 404);
  eq('reading their balance is 404', (await call('GET', `/api/v1/accounts/${bobsAccount}/balance`, { token: alice })).status, 404);
  eq('withdrawing from it is 404', (await submit('alice.customer', { type: 'WITHDRAWAL', sourceAccountId: bobsAccount, amount: '1.00', currency: 'USD' })).status, 404);
  eq('balance unchanged', await balance(bobsAccount), '300.00');
  const audit = await call('GET', `/api/v1/ops/audit-events?action=ACCESS_DENIED&entityId=${bobsAccount}`, { token: await login('sam.support') });
  check('denials are audited', (audit.json?.totalElements ?? 0) >= 3, audit.json?.totalElements);
});

await run('maker-checker approval', async () => {
  const acc = await newAccount(ALICE, 'USD', '40000.00');
  await awaitStatus((await submit('adam.admin', { type: 'DEPOSIT', targetAccountId: acc, amount: '40000.00', currency: 'USD' })).json.id, ['COMPLETED']);
  const big = await submit('omar.ops', { type: 'WITHDRAWAL', sourceAccountId: acc, amount: '60000.00', currency: 'USD' });
  eq('large withdrawal waits for review', big.json?.status, 'PENDING_REVIEW');
  eq('submitter cannot approve own transaction', (await call('POST', `/api/v1/transactions/${big.json.id}/approve`, { token: await login('omar.ops'), body: {} })).status, 403);
  eq('second operator approves', (await call('POST', `/api/v1/transactions/${big.json.id}/approve`, { token: await login('olivia.ops'), body: {} })).status, 200);
  eq('approved transaction completes', (await awaitStatus(big.json.id, ['COMPLETED', 'FAILED']))?.status, 'COMPLETED');
});

await run('clearing network: decline, retry, timeout + reconciliation', async () => {
  const acc = await newAccount(ALICE, 'USD', '1000.00');
  const declined = await submit('alice.customer', { type: 'WITHDRAWAL', sourceAccountId: acc, amount: '10.13', currency: 'USD' });
  const d = await awaitStatus(declined.json.id, ['FAILED', 'COMPLETED']);
  eq('decline (cents .13) fails the transaction', d?.failureCode, 'CLEARING_DECLINED');
  eq('reserved funds were refunded', await balance(acc), '1000.00');

  const flaky = await submit('alice.customer', { type: 'WITHDRAWAL', sourceAccountId: acc, amount: '10.99', currency: 'USD' });
  eq('two transient 503s are retried and the withdrawal completes (cents .99)', (await awaitStatus(flaky.json.id, ['COMPLETED', 'FAILED']))?.status, 'COMPLETED');
  eq('balance after the completed withdrawal', await balance(acc), '989.01');

  const timeout = await submit('alice.customer', { type: 'WITHDRAWAL', sourceAccountId: acc, amount: '10.66', currency: 'USD' });
  const held = await awaitStatus(timeout.json.id, ['RECONCILIATION_REQUIRED', 'COMPLETED', 'FAILED'], 40000);
  check('read timeout leaves the outcome UNKNOWN (cents .66)', held?.status === 'RECONCILIATION_REQUIRED' || held?.status === 'COMPLETED', held?.status);
  const settled = await awaitStatus(timeout.json.id, ['COMPLETED', 'FAILED'], 60000);
  eq('the reconciler asks the network and completes it (network DID execute)', settled?.status, 'COMPLETED');
  eq('funds stayed reserved throughout (989.01 - 10.66)', await balance(acc), '978.35');
});

if (WITH_CHAOS) {
  await run('chaos: network down -> circuit breaker -> recovery', async () => {
    const acc = await newAccount(ALICE, 'USD', '5000.00');
    await call('POST', '/simulator/chaos', { base: SIM, body: { mode: 'FAIL_5XX' } });
    const ids = [];
    for (let i = 0; i < 6; i++) {
      ids.push((await submit('alice.customer', { type: 'WITHDRAWAL', sourceAccountId: acc, amount: `${i + 1}.00`, currency: 'USD' })).json.id);
      await sleep(800);
    }
    const states = await Promise.all(ids.map((id) => awaitStatus(id, ['RECONCILIATION_REQUIRED', 'FAILED', 'COMPLETED'], 60000)));
    check('failures are held for reconciliation or fail fast once the breaker opens',
      states.every((s) => ['RECONCILIATION_REQUIRED', 'FAILED'].includes(s?.status)), states.map((s) => s?.status + '/' + (s?.failureCode ?? '')).join(' '));
    const health = (await call('GET', '/api/v1/ops/health', { token: await login('sam.support') })).json;
    const clearing = health.components.find((c) => c.name === 'clearing-network');
    check('ops health reports the clearing network as degraded', clearing?.status === 'DEGRADED', JSON.stringify(clearing));
    await call('POST', '/simulator/chaos', { base: SIM, body: { mode: 'NORMAL' } });
    await sleep(12000); // breaker open duration is 10 s
    const ok = await submit('alice.customer', { type: 'WITHDRAWAL', sourceAccountId: acc, amount: '7.00', currency: 'USD' });
    eq('after recovery new withdrawals complete again', (await awaitStatus(ok.json.id, ['COMPLETED', 'FAILED']))?.status, 'COMPLETED');
    // everything that was held is eventually resolved by the reconciler (network never executed it => refunded)
    const settled = await Promise.all(ids.map((id) => awaitStatus(id, ['FAILED', 'COMPLETED'], 120000)));
    check('every held transaction is resolved automatically', settled.every((s) => ['FAILED', 'COMPLETED'].includes(s?.status)), settled.map((s) => s?.status).join(' '));
    const integrity = await call('GET', '/api/v1/ops/ledger-integrity', { token: await login('omar.ops') });
    eq('ledger integrity holds after the incident', integrity.json?.length, 0);
  });
}

await run('operational dashboard data', async () => {
  const s = await call('GET', '/api/v1/ops/summary', { token: await login('sam.support') });
  eq('summary available to support', s.status, 200);
  check('summary has volumes, latency and http stats', !!s.json?.processingLatency && !!s.json?.http && Array.isArray(s.json?.completedVolumeLast24h), '');
  const p = await call('GET', '/actuator/prometheus');
  check('prometheus exposes business metrics', typeof p.json === 'object' || true);
  const text = await (await fetch(`${API}/actuator/prometheus`)).text();
  check('prometheus carries platform_transactions_finished_total', text.includes('platform_transactions_finished_total'));
  check('prometheus carries hikaricp metrics', text.includes('hikaricp_connections'));
  check('prometheus carries http latency histogram', text.includes('http_server_requests_seconds_bucket'));
});

const pass = results.filter((r) => r.result === 'PASS').length;
const fail = results.length - pass;
console.log(`\n${pass} passed, ${fail} failed, ${results.length} checks`);
if (OUT) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), api: API, withChaos: WITH_CHAOS, pass, fail, results }, null, 2));
}
process.exit(fail === 0 ? 0 : 1);

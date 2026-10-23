// Dependency-free load baseline that runs anywhere Node 18+ runs (the k6 scripts in performance/k6 are the "real"
// performance suite; k6 was not installable where this repository was written, so this script produced the only
// MEASURED numbers in the repository).
//
// WHAT THE NUMBERS ARE: one run on one developer machine, one JVM, in-memory H2 (no network, no disk), Node client on the
// same host. They show that the scenarios behave correctly under concurrency and give a relative feel - they are NOT a
// capacity benchmark and must not be quoted as production performance.
//
// Usage: node performance/local-baseline.mjs [--api http://localhost:18480] [--seconds 8] [--out docs/validation/perf-baseline.json]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const API = opt('--api', 'http://localhost:18480');
const SECONDS = Number(opt('--seconds', '8'));
const OUT = opt('--out', null);
const PASSWORD = process.env.LOCAL_DEMO_PASSWORD ?? 'demo-password';
const ALICE = '00000000-0000-4000-8000-000000000001';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function http(method, url, token, body, headers = {}) {
  const t0 = performance.now();
  const res = await fetch(`${API}${url}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, ms: performance.now() - t0, json: text ? JSON.parse(text) : null, headers: res.headers };
}
const login = async (u) => (await http('POST', '/api/v1/auth/token', null, { username: u, password: PASSWORD })).json.accessToken;
const admin = await login('adam.admin');
const alice = await login('alice.customer');

function pct(sorted, p) { return sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] * 10) / 10 : 0; }
function summarize(name, durations, statuses, seconds, extra = {}) {
  const sorted = [...durations].sort((a, b) => a - b);
  const byStatus = {};
  statuses.forEach((s) => (byStatus[s] = (byStatus[s] ?? 0) + 1));
  return { scenario: name, requests: durations.length, seconds: Math.round(seconds * 10) / 10, rps: Math.round(durations.length / seconds), p50_ms: pct(sorted, 50), p95_ms: pct(sorted, 95), p99_ms: pct(sorted, 99), max_ms: pct(sorted, 100), statuses: byStatus, ...extra };
}

/** Runs `worker(i)` in `concurrency` parallel loops for `seconds`. */
async function loadTest(name, concurrency, seconds, worker, extraFn) {
  const durations = [];
  const statuses = [];
  const end = performance.now() + seconds * 1000;
  const start = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async (_, i) => {
    while (performance.now() < end) {
      const r = await worker(i);
      durations.push(r.ms);
      statuses.push(r.status);
    }
  }));
  const extra = extraFn ? await extraFn() : {};
  return summarize(name, durations, statuses, (performance.now() - start) / 1000, extra);
}

async function newAccount(customerId, deposit) {
  const a = await http('POST', `/api/v1/customers/${customerId}/accounts`, admin, { accountType: 'BROKERAGE', currency: 'USD', dailyWithdrawalLimit: '1000000.00' });
  await http('POST', `/api/v1/accounts/${a.json.id}/activate`, admin, {});
  let remaining = Number(deposit);
  while (remaining > 0) { // keep each deposit below the review threshold
    const chunk = Math.min(remaining, 40000);
    await http('POST', '/api/v1/transactions', admin, { type: 'DEPOSIT', targetAccountId: a.json.id, amount: chunk.toFixed(2), currency: 'USD' }, { 'Idempotency-Key': `perf-${crypto.randomUUID()}` });
    remaining -= chunk;
  }
  await waitIdle();
  return a.json.id;
}
async function waitIdle() { // wait until the outbox has been worked off
  for (let i = 0; i < 200; i++) {
    const h = (await http('GET', '/api/v1/ops/health', admin)).json;
    if (/pending=0,/.test(h.components.find((c) => c.name === 'outbox').detail)) return;
    await sleep(250);
  }
}
const balance = async (id) => (await http('GET', `/api/v1/accounts/${id}/balance`, admin)).json.ledgerBalance;
const key = () => `perf-${crypto.randomUUID()}`;
const results = [];
const log = (r) => { results.push(r); console.log(JSON.stringify(r)); };

// 1. concurrent account queries (read path)
const readAcc = await newAccount(ALICE, '1000.00');
log(await loadTest('concurrent account + balance queries (32 clients)', 32, SECONDS, async (i) =>
  http('GET', i % 2 ? `/api/v1/accounts/${readAcc}` : `/api/v1/accounts/${readAcc}/balance`, alice)));

// 2. transaction submission throughput (write path; submission is acknowledged before processing)
const depAcc = await newAccount(ALICE, '0');
let submitted = 0;
const submitStart = performance.now();
const sub = await loadTest('deposit submission throughput (16 clients)', 16, SECONDS, async () => {
  submitted++;
  return http('POST', '/api/v1/transactions', alice, { type: 'DEPOSIT', targetAccountId: depAcc, amount: '1.00', currency: 'USD' }, { 'Idempotency-Key': key() });
});
await waitIdle();
const drainSeconds = (performance.now() - submitStart) / 1000;
const finalBal = await balance(depAcc);
sub.processing = { submitted, balanceAfterDrain: finalBal, balanceMatchesSubmissions: Number(finalBal) === submitted - (sub.statuses['429'] ?? 0), allProcessedWithinSeconds: Math.round(drainSeconds * 10) / 10 };
log(sub);

// 3. concurrent withdrawals against one account (lock contention) - 16 clients draining 300.00 in 1.00 steps
const contAcc = await newAccount(ALICE, '300.00');
const cont = await loadTest('concurrent withdrawals on ONE account (16 clients, balance 300.00)', 16, SECONDS, async () =>
  http('POST', '/api/v1/transactions', alice, { type: 'WITHDRAWAL', sourceAccountId: contAcc, amount: '1.00', currency: 'USD' }, { 'Idempotency-Key': key() }));
await waitIdle();
const contBal = await balance(contAcc);
const txs = (await http('GET', `/api/v1/transactions?accountId=${contAcc}&type=WITHDRAWAL&status=COMPLETED&size=1`, admin)).json.totalElements;
cont.integrity = { finalBalance: contBal, completedWithdrawals: txs, neverNegative: Number(contBal) >= 0, balanceEqualsOpeningMinusCompleted: Number(contBal) === 300 - txs };
log(cont);

// 4. opposing transfers (deadlock avoidance under load)
const tA = await newAccount(ALICE, '5000.00');
const tB = await newAccount(ALICE, '5000.00');
const tr = await loadTest('opposing transfers A<->B (16 clients)', 16, SECONDS, async (i) =>
  http('POST', '/api/v1/transactions', alice, { type: 'TRANSFER', sourceAccountId: i % 2 ? tA : tB, targetAccountId: i % 2 ? tB : tA, amount: '1.00', currency: 'USD' }, { 'Idempotency-Key': key() }));
await waitIdle();
const total = Number(await balance(tA)) + Number(await balance(tB));
tr.integrity = { totalAfter: total, moneyConserved: total === 10000 };
log(tr);

// 5. duplicate submissions (idempotency under load): 8 clients repeat 25 keys
const dupAcc = await newAccount(ALICE, '0');
const keys = Array.from({ length: 25 }, key);
let replays = 0;
const dup = await loadTest('duplicate submissions, 25 distinct keys repeated (8 clients)', 8, Math.max(3, SECONDS / 2), async (i) => {
  const r = await http('POST', '/api/v1/transactions', alice, { type: 'DEPOSIT', targetAccountId: dupAcc, amount: '2.00', currency: 'USD' }, { 'Idempotency-Key': keys[Math.floor(Math.random() * keys.length)] });
  if (r.headers.get('Idempotent-Replayed') === 'true') replays++;
  return r;
});
await waitIdle();
dup.integrity = { replayedResponses: replays, depositsApplied: Number(await balance(dupAcc)) / 2, expectedExactly: 25 };
log(dup);

// 6. large history query: 300 transactions on one account, page through 100 at a time
const histAcc = await newAccount(ALICE, '1000.00');
await Promise.all(Array.from({ length: 300 }, () => http('POST', '/api/v1/transactions', alice, { type: 'DEPOSIT', targetAccountId: histAcc, amount: '1.00', currency: 'USD' }, { 'Idempotency-Key': key() })));
await waitIdle();
let page = 0;
log(await loadTest('transaction history, page size 100 over 300+ rows (8 clients)', 8, SECONDS, async () => {
  const p = page++ % 4;
  return http('GET', `/api/v1/accounts/${histAcc}/transactions?size=100&page=${p}&sort=createdAt,desc`, alice);
}));

// final invariant
const integrity = (await http('GET', '/api/v1/ops/ledger-integrity', admin)).json;
console.log(`ledger integrity after the run: ${integrity.length === 0 ? 'OK (0 mismatching accounts)' : 'VIOLATED ' + JSON.stringify(integrity)}`);
if (OUT) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ measuredAt: new Date().toISOString(), environment: { note: 'developer laptop, single JVM, in-memory H2, Node client on the same host; NOT a benchmark', node: process.version, platform: process.platform, cpus: (await import('node:os')).cpus().length, secondsPerScenario: SECONDS }, ledgerIntegrityViolations: integrity.length, results }, null, 2));
}
process.exit(integrity.length === 0 ? 0 : 1);

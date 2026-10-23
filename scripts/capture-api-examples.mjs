// Captures REAL request/response pairs from the running local stack into docs/api/examples.md (nothing is hand-written:
// regenerate it whenever the API changes). Usage: node scripts/capture-api-examples.mjs [--api http://localhost:18480]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const API = args.includes('--api') ? args[args.indexOf('--api') + 1] : 'http://localhost:18480';
const PASSWORD = process.env.LOCAL_DEMO_PASSWORD ?? 'demo-password';
const ALICE = '00000000-0000-4000-8000-000000000001';
const BOB = '00000000-0000-4000-8000-000000000002';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sections = [];
function redact(obj) {
  return JSON.parse(JSON.stringify(obj, (k, v) => (k === 'accessToken' ? '<jwt omitted>' : k === 'correlationId' ? '7f3c1e52-0000-4000-8000-00000000c0de' : v)));
}
async function call(title, note, method, url, { token, body, headers = {} } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h.Authorization = 'Bearer <jwt>';
  const res = await fetch(`${API}${url}`, { method, headers: { ...h, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  const shownHeaders = Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\n');
  const interesting = ['location', 'idempotent-replayed', 'retry-after', 'x-correlation-id'].filter((n) => res.headers.get(n)).map((n) => `${n}: ${n === 'x-correlation-id' ? '<generated or echoed>' : res.headers.get(n)}`).join('\n');
  sections.push(`### ${title}\n\n${note ? note + '\n\n' : ''}\`\`\`http\n${method} ${url}\n${shownHeaders}\n${body !== undefined ? '\n' + JSON.stringify(body, null, 2) : ''}\n\`\`\`\n\n\`\`\`http\nHTTP/1.1 ${res.status} ${res.statusText}\n${interesting}\n${json ? '\n' + JSON.stringify(redact(json), null, 2) : ''}\n\`\`\`\n`);
  return { status: res.status, json };
}
const login = async (u) => (await (await fetch(`${API}/api/v1/auth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PASSWORD }) })).json()).accessToken;
const admin = await login('adam.admin');
const alice = await login('alice.customer');
const ops = await login('omar.ops');
const ops2 = await login('olivia.ops');
const support = await login('sam.support');
const bob = await login('bob.customer');
const key = () => `docs-${crypto.randomUUID()}`;

const r1 = await call('Customer management: create a customer (operations/admin)', 'Customers are created by staff. `taxIdLast4` is accepted but never returned (`****`).', 'POST', '/api/v1/customers',
  { token: ops, body: { legalName: 'Frida Example', email: `frida-${Date.now()}@example.test`, phone: '+1-555-0199', taxIdLast4: '9999' } });
const cust = r1.json.id;
const acc = await call('Account management: open an account', 'New accounts start as `PENDING_ACTIVATION`; money amounts are JSON **strings**.', 'POST', `/api/v1/customers/${cust}/accounts`,
  { token: ops, body: { accountType: 'BROKERAGE', currency: 'USD', dailyWithdrawalLimit: '5000.00' } });
await call('Account lifecycle: activate', '', 'POST', `/api/v1/accounts/${acc.json.id}/activate`, { token: ops, body: {} });
const dep = await call('Transaction submission: deposit (accepted for asynchronous processing)', '`202 Accepted` + `Location`. The `Idempotency-Key` header is mandatory.', 'POST', '/api/v1/transactions',
  { token: admin, body: { type: 'DEPOSIT', targetAccountId: acc.json.id, amount: '1500.00', currency: 'USD', memo: 'Opening funding' }, headers: { 'Idempotency-Key': key() } });
await sleep(1500);
await call('Transaction status', 'Poll the resource (or watch the dashboard) - processing is asynchronous.', 'GET', `/api/v1/transactions/${dep.json.id}`, { token: admin });
await call('Account balance query', '', 'GET', `/api/v1/accounts/${acc.json.id}/balance`, { token: admin });
await call('Transaction history (paginated, sorted)', 'Page size is capped at 100; only whitelisted sort properties are accepted.', 'GET', `/api/v1/accounts/${acc.json.id}/transactions?page=0&size=5&sort=createdAt,desc`, { token: admin });
await call('Transaction search with filters', '', 'GET', '/api/v1/transactions?status=COMPLETED&type=DEPOSIT&minAmount=1000.00&size=2&sort=amount,desc', { token: admin });

const k = key();
const wbody = { type: 'WITHDRAWAL', sourceAccountId: acc.json.id, amount: '200.00', currency: 'USD' };
await call('Idempotency: first submission', '', 'POST', '/api/v1/transactions', { token: admin, body: wbody, headers: { 'Idempotency-Key': k } });
await call('Idempotency: the same request again returns the original result', 'Note the `idempotent-replayed: true` header - no second withdrawal is created.', 'POST', '/api/v1/transactions', { token: admin, body: wbody, headers: { 'Idempotency-Key': k } });
await call('Conflict: same key, different payload', '', 'POST', '/api/v1/transactions', { token: admin, body: { ...wbody, amount: '201.00' }, headers: { 'Idempotency-Key': k } });
await call('Business rejection: insufficient funds', 'A valid request that violates a business rule is persisted as `REJECTED` and answered with `422` + the transaction id.', 'POST', '/api/v1/transactions',
  { token: admin, body: { ...wbody, amount: '999999.00' }, headers: { 'Idempotency-Key': key() } });
await call('Validation failure: malformed input', 'Every violation is listed with its field.', 'POST', '/api/v1/transactions',
  { token: alice, body: { type: 'DEPOSIT', amount: '-5', currency: 'usd', memo: '<script>' }, headers: { 'Idempotency-Key': key() } });
await call('Validation failure: missing Idempotency-Key', '', 'POST', '/api/v1/transactions', { token: alice, body: { type: 'DEPOSIT', targetAccountId: acc.json.id, amount: '5.00', currency: 'USD' } });
await call('Authentication failure: no token', '', 'GET', '/api/v1/accounts');
await call('Authentication failure: invalid token', '', 'GET', '/api/v1/accounts', { token: 'not-a-jwt' });
await call('Authorization failure: wrong role (403)', 'A customer may not create customers.', 'POST', '/api/v1/customers', { token: alice, body: { legalName: 'X', email: 'x@example.test' } });
await call('Authorization failure: object-level (404, no existence leak)', 'Bob\'s account requested by Alice. The attempt is written to the audit trail.', 'GET', `/api/v1/accounts/10000000-0000-4000-8000-000000000004`, { token: alice });
await call('Maker-checker: an operator cannot approve their own transaction', '', 'POST', `/api/v1/transactions/${(await call('(setup) large withdrawal needing review', 'amounts >= 50,000 wait for an independent approver', 'POST', '/api/v1/transactions', { token: ops, body: { type: 'DEPOSIT', targetAccountId: acc.json.id, amount: '60000.00', currency: 'USD' }, headers: { 'Idempotency-Key': key() } })).json.id}/approve`, { token: ops, body: {} });
await call('Conflict: duplicate e-mail', '', 'POST', '/api/v1/customers', { token: ops, body: { legalName: 'Dup', email: 'alice@example.test' } });
await call('Invalid state transition', 'Cancelling a completed transaction.', 'POST', `/api/v1/transactions/${dep.json.id}/cancel`, { token: admin, body: {} });
await call('Unsupported sort property', '', 'GET', '/api/v1/transactions?sort=submittedBy,asc', { token: alice });
await call('Operations: dashboard summary', 'Staff only (support, operations, admin).', 'GET', '/api/v1/ops/summary', { token: support });
await call('Operations: platform health', '', 'GET', '/api/v1/ops/health', { token: support });
await call('Operations: audit events', '', 'GET', '/api/v1/ops/audit-events?action=TRANSACTION_COMPLETED&size=2', { token: support });
await call('Operations: ledger integrity check', 'Must always return an empty list.', 'GET', '/api/v1/ops/ledger-integrity', { token: ops });
await call('Administration: drain the background loops once (admin only)', '', 'POST', '/api/v1/ops/processing/drain', { token: admin, body: {} });
await call('Administration: dead-lettered outbox events', '', 'GET', '/api/v1/ops/outbox?status=DEAD', { token: admin });

const serverError = fs.existsSync(path.join(root, 'backend', 'platform-service', 'target', 'server-error-example.json'))
  ? fs.readFileSync(path.join(root, 'backend', 'platform-service', 'target', 'server-error-example.json'), 'utf8') : null;
const tail = serverError ? `### Server error (500) - produced by ServerErrorIT through the real handler\n\nA test-only controller throws \`IllegalStateException("secret internal detail: jdbc:postgresql://... password=...")\`; the client sees only this:\n\n\`\`\`http\nHTTP/1.1 500 Internal Server Error\n\n${serverError}\n\`\`\`\n` : '';
const header = `# API examples (captured from the running application)

Generated by \`scripts/capture-api-examples.mjs\` against the local stack - every response below is real output; JWTs and correlation ids
are redacted. Base URL \`${API}\`. Money amounts are strings. See \`specs/openapi.json\` for the full contract.

`;
fs.mkdirSync(path.join(root, 'docs', 'api'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs', 'api', 'examples.md'), header + sections.join('\n') + '\n' + tail);
console.log(`wrote docs/api/examples.md with ${sections.length} examples`);

// Generates tests/api/investment-platform.postman_collection.json (Postman / Newman) with assertions on every request.
// Usage: node tests/api/generate-postman.mjs      Run: newman run tests/api/investment-platform.postman_collection.json --env-var baseUrl=http://localhost:18480 --env-var password=<LOCAL_DEMO_PASSWORD>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const url = (p) => ({ raw: `{{baseUrl}}${p}`, host: ['{{baseUrl}}'], path: p.split('?')[0].replace(/^\//, '').split('/'), query: p.includes('?') ? p.split('?')[1].split('&').map((kv) => ({ key: kv.split('=')[0], value: kv.split('=')[1] })) : undefined });
const test = (lines) => ({ listen: 'test', script: { type: 'text/javascript', exec: lines } });
const bearer = (v) => [{ key: 'Authorization', value: `Bearer {{${v}}}` }];
const req = (name, method, p, { token, body, headers = [], tests = [], pre } = {}) => ({
  name,
  event: [test(tests), ...(pre ? [{ listen: 'prerequest', script: { type: 'text/javascript', exec: pre } }] : [])],
  request: {
    method, header: [...(token ? bearer(token) : []), ...(body ? [{ key: 'Content-Type', value: 'application/json' }] : []), ...headers],
    url: url(p), body: body ? { mode: 'raw', raw: JSON.stringify(body, null, 2) } : undefined,
  },
});
const idem = (suffix) => ({ key: 'Idempotency-Key', value: `postman-{{runId}}-${suffix}` });
const ALICE_ACC = '10000000-0000-4000-8000-000000000001';

const collection = {
  info: { name: 'Investment platform API (synthetic)', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  variable: [{ key: 'baseUrl', value: 'http://localhost:18480' }, { key: 'password', value: '' }],
  event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: ["if (!pm.collectionVariables.get('runId')) pm.collectionVariables.set('runId', Date.now().toString());"] } }],
  item: [
    req('login as operator', 'POST', '/api/v1/auth/token', { body: { username: 'omar.ops', password: '{{password}}' }, tests: ['pm.test("200", () => pm.response.to.have.status(200));', 'pm.collectionVariables.set("opsToken", pm.response.json().accessToken);'] }),
    req('login as customer', 'POST', '/api/v1/auth/token', { body: { username: 'alice.customer', password: '{{password}}' }, tests: ['pm.test("200", () => pm.response.to.have.status(200));', 'pm.collectionVariables.set("aliceToken", pm.response.json().accessToken);'] }),
    req('anonymous request is rejected', 'GET', '/api/v1/accounts', { tests: ['pm.test("401", () => pm.response.to.have.status(401));', 'pm.test("standard error envelope", () => pm.expect(pm.response.json().code).to.eql("UNAUTHENTICATED"));'] }),
    req('own accounts', 'GET', '/api/v1/accounts?size=20', { token: 'aliceToken', tests: ['pm.test("200", () => pm.response.to.have.status(200));', 'pm.test("money is a string", () => pm.expect(pm.response.json().items[0].balance).to.be.a("string"));'] }),
    req('deposit accepted', 'POST', '/api/v1/transactions', { token: 'aliceToken', headers: [idem('deposit')], body: { type: 'DEPOSIT', targetAccountId: ALICE_ACC, amount: '5.00', currency: 'USD' }, tests: ['pm.test("202", () => pm.response.to.have.status(202));', 'pm.test("Location header", () => pm.expect(pm.response.headers.get("Location")).to.include("/api/v1/transactions/"));', 'pm.collectionVariables.set("txId", pm.response.json().id);'] }),
    req('same request again is replayed, not duplicated', 'POST', '/api/v1/transactions', { token: 'aliceToken', headers: [idem('deposit')], body: { type: 'DEPOSIT', targetAccountId: ALICE_ACC, amount: '5.00', currency: 'USD' }, tests: ['pm.test("202", () => pm.response.to.have.status(202));', 'pm.test("replayed", () => pm.expect(pm.response.headers.get("Idempotent-Replayed")).to.eql("true"));', 'pm.test("same transaction", () => pm.expect(pm.response.json().id).to.eql(pm.collectionVariables.get("txId")));'] }),
    req('same key with different payload is refused', 'POST', '/api/v1/transactions', { token: 'aliceToken', headers: [idem('deposit')], body: { type: 'DEPOSIT', targetAccountId: ALICE_ACC, amount: '6.00', currency: 'USD' }, tests: ['pm.test("422", () => pm.response.to.have.status(422));', 'pm.test("code", () => pm.expect(pm.response.json().code).to.eql("IDEMPOTENCY_KEY_REUSED"));'] }),
    req('missing Idempotency-Key', 'POST', '/api/v1/transactions', { token: 'aliceToken', body: { type: 'DEPOSIT', targetAccountId: ALICE_ACC, amount: '5.00', currency: 'USD' }, tests: ['pm.test("400", () => pm.response.to.have.status(400));', 'pm.test("code", () => pm.expect(pm.response.json().code).to.eql("IDEMPOTENCY_KEY_REQUIRED"));'] }),
    req('insufficient funds is a business rejection', 'POST', '/api/v1/transactions', { token: 'aliceToken', headers: [idem('overdraw')], body: { type: 'WITHDRAWAL', sourceAccountId: ALICE_ACC, amount: '99999999.00', currency: 'USD' }, tests: ['pm.test("422", () => pm.response.to.have.status(422));', 'pm.test("reason", () => pm.expect(pm.response.json().details.failureCode).to.eql("INSUFFICIENT_FUNDS"));'] }),
    req('validation errors are itemised', 'POST', '/api/v1/transactions', { token: 'aliceToken', headers: [idem('invalid')], body: { type: 'DEPOSIT', amount: '-1', currency: 'usd' }, tests: ['pm.test("400", () => pm.response.to.have.status(400));', 'pm.test("violations listed", () => pm.expect(pm.response.json().violations.length).to.be.above(1));'] }),
    req('another customer\'s account is invisible (BOLA)', 'GET', '/api/v1/accounts/10000000-0000-4000-8000-000000000004', { token: 'aliceToken', tests: ['pm.test("404, not 403 (no existence leak)", () => pm.response.to.have.status(404));'] }),
    req('customers cannot see operations data', 'GET', '/api/v1/ops/summary', { token: 'aliceToken', tests: ['pm.test("403", () => pm.response.to.have.status(403));'] }),
    req('operations summary', 'GET', '/api/v1/ops/summary', { token: 'opsToken', tests: ['pm.test("200", () => pm.response.to.have.status(200));', 'pm.test("has latency block", () => pm.expect(pm.response.json()).to.have.property("processingLatency"));'] }),
    req('platform health', 'GET', '/api/v1/ops/health', { token: 'opsToken', tests: ['pm.test("200", () => pm.response.to.have.status(200));', 'pm.test("components", () => pm.expect(pm.response.json().components.length).to.be.at.least(4));'] }),
    req('ledger integrity is empty', 'GET', '/api/v1/ops/ledger-integrity', { token: 'opsToken', tests: ['pm.test("no mismatching accounts", () => pm.expect(pm.response.json()).to.eql([]));'] }),
  ],
};
fs.writeFileSync(path.join(dir, 'investment-platform.postman_collection.json'), JSON.stringify(collection, null, 2));
console.log('wrote investment-platform.postman_collection.json with', collection.item.length, 'requests');

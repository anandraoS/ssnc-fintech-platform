// Shared helpers for the k6 scenarios. Run against a LOCAL/TEST stack only (never a shared or production system).
//
//   API=http://localhost:18480 LOCAL_DEMO_PASSWORD=<value> k6 run performance/k6/<scenario>.js
//
// For load tests start the platform with raised rate limits, otherwise the rate limiter (by design) answers 429:
//   RATE_LIMIT_API_CAPACITY=1000000 RATE_LIMIT_API_REFILL=1000000 RATE_LIMIT_AUTH_CAPACITY=1000 scripts/run-local.sh
import http from 'k6/http';
import { check, fail } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

export const API = __ENV.API || 'http://localhost:18480';
const PASSWORD = __ENV.LOCAL_DEMO_PASSWORD || 'demo-password';
export const ALICE = '00000000-0000-4000-8000-000000000001';
export { uuidv4 };

export function login(username) {
  const res = http.post(`${API}/api/v1/auth/token`, JSON.stringify({ username, password: PASSWORD }), { headers: { 'Content-Type': 'application/json' } });
  if (res.status !== 200) fail(`login failed for ${username}: ${res.status}`);
  return res.json('accessToken');
}

export function authHeaders(token, extra = {}) {
  return { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extra } };
}

/** Creates an active account owned by `customerId` and funds it (deposits stay below the 50,000 review threshold). */
export function fundedAccount(adminToken, customerId, amount) {
  const a = http.post(`${API}/api/v1/customers/${customerId}/accounts`, JSON.stringify({ accountType: 'BROKERAGE', currency: 'USD', dailyWithdrawalLimit: '1000000.00' }), authHeaders(adminToken));
  const id = a.json('id');
  http.post(`${API}/api/v1/accounts/${id}/activate`, '{}', authHeaders(adminToken));
  let remaining = amount;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 40000);
    http.post(`${API}/api/v1/transactions`, JSON.stringify({ type: 'DEPOSIT', targetAccountId: id, amount: chunk.toFixed(2), currency: 'USD' }), authHeaders(adminToken, { 'Idempotency-Key': uuidv4() }));
    remaining -= chunk;
  }
  return id;
}

export function submit(token, body, key) {
  return http.post(`${API}/api/v1/transactions`, JSON.stringify(body), authHeaders(token, { 'Idempotency-Key': key || uuidv4() }));
}

export function expectAccepted(res) {
  return check(res, { 'accepted (202)': (r) => r.status === 202, 'no server error': (r) => r.status < 500 });
}

/** Illustrative service-level targets. They are TARGETS to tune against measurements, not measured results. */
export const TARGETS = {
  readP95: 'p(95)<300',      // ms - reads
  writeP95: 'p(95)<500',     // ms - submissions
  errorRate: 'rate<0.01',    // unexpected (5xx / transport) failures
};

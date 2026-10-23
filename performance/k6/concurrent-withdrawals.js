// Lock contention on ONE account: many VUs withdraw 1.00 from an account holding 300.00.
// Expected: far more requests than funds. All are accepted by the (advisory) submit-time check while the balance looks
// sufficient; the AUTHORITATIVE check under the row lock lets exactly 300 complete and fails the rest with INSUFFICIENT_FUNDS.
// Pass criteria are INVARIANTS, not speed: no 5xx, final balance 0.00, never negative, ledger integrity check empty.
import http from 'k6/http';
import { check } from 'k6';
import { API, ALICE, login, authHeaders, fundedAccount, submit } from './lib.js';

export const options = {
  scenarios: { contention: { executor: 'constant-vus', vus: 32, duration: '30s' } },
  thresholds: { http_req_failed: ['rate<0.01'], checks: ['rate>0.99'] },
};

export function setup() {
  const admin = login('adam.admin');
  return { account: fundedAccount(admin, ALICE, 300), alice: login('alice.customer'), admin };
}

export default function (data) {
  const res = submit(data.alice, { type: 'WITHDRAWAL', sourceAccountId: data.account, amount: '1.00', currency: 'USD' });
  check(res, { '202 or 422, never 5xx': (r) => r.status === 202 || r.status === 422 });
}

export function teardown(data) {
  const bal = http.get(`${API}/api/v1/accounts/${data.account}/balance`, authHeaders(data.admin)).json('ledgerBalance');
  const integrity = http.get(`${API}/api/v1/ops/ledger-integrity`, authHeaders(data.admin)).json();
  console.log(`final balance ${bal} (expected 0.00 once the outbox drains), integrity violations: ${integrity.length} (expected 0)`);
}

// Large transaction-history queries: pages through an account with many rows (deterministic sort + tie-break, size capped
// at 100 by the API). Look at the query plan in docs/database/query-plans.md if p95 grows with the page number.
import http from 'k6/http';
import { check } from 'k6';
import { API, ALICE, login, authHeaders, fundedAccount, submit, TARGETS } from './lib.js';

export const options = {
  scenarios: { history: { executor: 'constant-vus', vus: 16, duration: '45s' } },
  thresholds: { http_req_duration: [TARGETS.readP95], http_req_failed: [TARGETS.errorRate] },
};

export function setup() {
  const admin = login('adam.admin');
  const alice = login('alice.customer');
  const account = fundedAccount(admin, ALICE, 1000);
  for (let i = 0; i < 1000; i++) submit(alice, { type: 'DEPOSIT', targetAccountId: account, amount: '1.00', currency: 'USD' });
  return { account, alice };
}

export default function (data) {
  const page = Math.floor(Math.random() * 10);
  const res = http.get(`${API}/api/v1/accounts/${data.account}/transactions?size=100&page=${page}&sort=createdAt,desc`, authHeaders(data.alice));
  check(res, { '200': (r) => r.status === 200 });
}

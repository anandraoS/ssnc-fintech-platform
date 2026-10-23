// Two scenarios in one run: opposing transfers between two accounts (deadlock avoidance under load) and heavy duplicate
// submission (idempotency under load).
import http from 'k6/http';
import { check } from 'k6';
import { API, ALICE, login, authHeaders, fundedAccount, submit, uuidv4 } from './lib.js';

export const options = {
  scenarios: {
    opposing_transfers: { executor: 'constant-vus', vus: 16, duration: '30s', exec: 'transfers' },
    duplicates: { executor: 'constant-vus', vus: 8, duration: '30s', exec: 'duplicates' },
  },
  thresholds: { http_req_failed: ['rate<0.01'], checks: ['rate>0.99'] },
};

export function setup() {
  const admin = login('adam.admin');
  const keys = Array.from({ length: 25 }, () => uuidv4());
  return {
    a: fundedAccount(admin, ALICE, 5000), b: fundedAccount(admin, ALICE, 5000), dup: fundedAccount(admin, ALICE, 0),
    alice: login('alice.customer'), admin, keys,
  };
}

export function transfers(data) {
  const forward = __VU % 2 === 0;
  const res = submit(data.alice, { type: 'TRANSFER', sourceAccountId: forward ? data.a : data.b, targetAccountId: forward ? data.b : data.a, amount: '1.00', currency: 'USD' });
  check(res, { 'transfer accepted': (r) => r.status === 202 });
}

export function duplicates(data) {
  const key = data.keys[Math.floor(Math.random() * data.keys.length)];
  const res = submit(data.alice, { type: 'DEPOSIT', targetAccountId: data.dup, amount: '2.00', currency: 'USD' }, key);
  check(res, { 'duplicate answered with the original (202)': (r) => r.status === 202 });
}

export function teardown(data) {
  const bal = (id) => Number(http.get(`${API}/api/v1/accounts/${id}/balance`, authHeaders(data.admin)).json('ledgerBalance'));
  console.log(`A+B = ${bal(data.a) + bal(data.b)} (expected 10000 - money conserved); duplicate account balance = ${bal(data.dup)} (expected 50 = 25 keys x 2.00)`);
}

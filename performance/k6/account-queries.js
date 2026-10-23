// Concurrent account queries (read path). Constant arrival rate so latency is not hidden by closed-loop "coordinated omission".
import http from 'k6/http';
import { check } from 'k6';
import { API, ALICE, login, authHeaders, fundedAccount, TARGETS } from './lib.js';

export const options = {
  scenarios: {
    reads: { executor: 'constant-arrival-rate', rate: 200, timeUnit: '1s', duration: '60s', preAllocatedVUs: 50, maxVUs: 200 },
  },
  thresholds: {
    http_req_duration: [TARGETS.readP95],
    http_req_failed: [TARGETS.errorRate],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  const admin = login('adam.admin');
  return { account: fundedAccount(admin, ALICE, 1000), alice: login('alice.customer') };
}

export default function (data) {
  const url = Math.random() < 0.5 ? `${API}/api/v1/accounts/${data.account}` : `${API}/api/v1/accounts/${data.account}/balance`;
  const res = http.get(url, authHeaders(data.alice));
  check(res, { '200': (r) => r.status === 200 });
}

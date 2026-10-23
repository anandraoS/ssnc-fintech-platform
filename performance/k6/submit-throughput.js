// Transaction submission throughput: ramps the arrival rate; every request carries its own idempotency key.
// Submission is acknowledged (202) BEFORE processing, so also watch platform_outbox_backlog / processing latency in Grafana.
import { check } from 'k6';
import { ALICE, login, fundedAccount, submit, TARGETS } from './lib.js';

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate', startRate: 20, timeUnit: '1s', preAllocatedVUs: 50, maxVUs: 300,
      stages: [{ target: 100, duration: '30s' }, { target: 200, duration: '60s' }, { target: 0, duration: '15s' }],
    },
  },
  thresholds: { http_req_duration: [TARGETS.writeP95], http_req_failed: [TARGETS.errorRate], checks: ['rate>0.99'] },
};

export function setup() {
  const admin = login('adam.admin');
  return { account: fundedAccount(admin, ALICE, 0), alice: login('alice.customer') };
}

export default function (data) {
  const res = submit(data.alice, { type: 'DEPOSIT', targetAccountId: data.account, amount: '1.00', currency: 'USD' });
  check(res, { 'accepted (202)': (r) => r.status === 202 });
}

export function teardown(data) {
  console.log(`Verify afterwards: the account ${data.account} balance must equal the number of 202 responses (each deposit is 1.00).`);
}

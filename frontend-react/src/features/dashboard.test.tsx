import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FakeApi, Reply, page, renderApp } from '../testing/helpers';

const SUMMARY = {
  generatedAt: '2026-01-01T10:00:00Z',
  transactionsByStatus: { COMPLETED: 8, FAILED: 2, PENDING_REVIEW: 1, RECONCILIATION_REQUIRED: 1 },
  completedVolumeLast24h: [{ type: 'DEPOSIT', currency: 'USD', count: 3, volume: '1500.00' }],
  completedLast24h: 8, failedLast24h: 2, pendingReview: 1, reconciliationRequired: 1, openReconciliationRecords: 1,
  transactionFailureRateLast24h: 0.2,
  processingLatency: { sampleSize: 8, averageMs: 42.4, p50Ms: 30, p95Ms: 120, p99Ms: 150 },
  http: { totalRequests: 100, serverErrors: 1, errorRate: 0.01 },
  accountsByStatus: { ACTIVE: 9, SUSPENDED: 1 },
  totalBalances: [{ currency: 'USD', total: '143900.00' }],
};
const HEALTH = {
  status: 'DEGRADED', checkedAt: '2026-01-01T10:00:00Z',
  components: [{ name: 'database', status: 'UP', detail: 'round trip 2 ms' }, { name: 'outbox', status: 'DEGRADED', detail: 'dead-lettered=1' }],
};
const AUDIT = page([{ id: 1, occurredAt: '2026-01-01T10:00:00Z', actor: 'omar.ops', action: 'TRANSACTION_COMPLETED', entityType: 'TRANSACTION', entityId: 'x' }]);

function dashboardApi(summary: Reply | (() => Reply) = { body: SUMMARY }) {
  return new FakeApi()
    .on('GET /api/v1/ops/summary', summary)
    .on('GET /api/v1/ops/health', { body: HEALTH })
    .on('GET /api/v1/ops/audit-events', { body: AUDIT });
}

const open = (api: FakeApi) => renderApp('/', { roles: ['OPERATIONS_ANALYST'], username: 'omar.ops', api });

describe('Dashboard', () => {
  it('shows a loading state first, then the dashboard', async () => {
    open(dashboardApi());
    expect(await screen.findByText('Completed (24 h)')).toBeInTheDocument();
    expect(screen.getByText('$1,500.00')).toBeInTheDocument(); // volume formatted from a string
    expect(screen.getByText('$143,900.00')).toBeInTheDocument();
    expect(screen.getByText('p50 / p95 / p99')).toBeInTheDocument();
    expect(screen.getByText('30 / 120 / 150 ms')).toBeInTheDocument();
    expect(screen.getByText('20.0 %')).toBeInTheDocument(); // failure rate
    expect(screen.getByText('TRANSACTION_COMPLETED')).toBeInTheDocument();
  });

  it('renders attention queues as links into the investigation tabs', async () => {
    open(dashboardApi());
    await screen.findByText('Completed (24 h)');
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/investigations?tab=review');
    expect(hrefs).toContain('/investigations?tab=reconciliation');
    expect(hrefs).toContain('/investigations?tab=failed');
    expect(hrefs).toContain('/transactions?status=COMPLETED');
  });

  it('shows the degraded component with its detail', async () => {
    open(dashboardApi());
    expect(await screen.findByText('dead-lettered=1')).toBeInTheDocument();
    expect(screen.getAllByText('Degraded').length).toBeGreaterThan(0);
  });

  it('shows an error with retry when the first load fails, and recovers on retry', async () => {
    let fail = true;
    open(dashboardApi(() => (fail ? { status: 503, body: { code: 'INTERNAL_ERROR', message: 'Backend unavailable' } } : { body: SUMMARY })));
    expect(await screen.findByRole('alert')).toHaveTextContent('Backend unavailable');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Completed (24 h)')).toBeInTheDocument();
  });

  it('keeps the last good data and warns when a refresh fails', async () => {
    let fail = false;
    open(dashboardApi(() => (fail ? { status: 504, body: { code: 'X', message: 'timeout' } } : { body: SUMMARY })));
    await screen.findByText('Completed (24 h)');
    fail = true;
    await userEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    expect(await screen.findByText(/Could not refresh: timeout/)).toBeInTheDocument();
    expect(screen.getByText('Completed (24 h)')).toBeInTheDocument(); // old data still visible
  });

  it('shows empty placeholders when there is no volume, latency or audit data yet', async () => {
    const api = new FakeApi()
      .on('GET /api/v1/ops/summary', { body: { ...SUMMARY, completedVolumeLast24h: [], processingLatency: { sampleSize: 0, averageMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 } } })
      .on('GET /api/v1/ops/health', { body: HEALTH })
      .on('GET /api/v1/ops/audit-events', { body: page([]) });
    open(api);
    expect(await screen.findByText('No completed volume in the last 24 hours.')).toBeInTheDocument();
    expect(screen.getByText('No completed transactions yet.')).toBeInTheDocument();
    expect(screen.getByText('No audit events yet.')).toBeInTheDocument();
  });

  it('refreshes on its own timer while the tab is visible', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = dashboardApi();
      open(api);
      await screen.findByText('Completed (24 h)');
      expect(api.callsTo('GET /api/v1/ops/summary')).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(15_100);
      await waitFor(() => expect(api.callsTo('GET /api/v1/ops/summary').length).toBeGreaterThanOrEqual(2));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Customer portfolio', () => {
  const account = { id: 'a1', accountNumber: 'ACC-1000000001', customerId: 'c1', accountType: 'BROKERAGE', status: 'ACTIVE', currency: 'USD', balance: '1000.00', availableBalance: '950.00', minimumBalance: '0.00', dailyWithdrawalLimit: '10000.00', version: 1, openedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };

  it('customers land on their portfolio with balances and recent activity', async () => {
    const api = new FakeApi().on('GET /api/v1/accounts', { body: page([account]) }).on('GET /api/v1/transactions', { body: page([]) });
    renderApp('/', { roles: ['CUSTOMER'], username: 'alice.customer', api });
    expect(await screen.findByText('ACC-1000000001')).toBeInTheDocument();
    expect(screen.getByText('My accounts')).toBeInTheDocument();
    expect(screen.getByText('$1,000.00')).toBeInTheDocument();
    expect(screen.getByText('Available $950.00')).toBeInTheDocument();
    expect(screen.getByText('No transactions yet.')).toBeInTheDocument();
    expect(api.callsTo('GET /api/v1/ops/summary')).toHaveLength(0); // staff-only data is never requested
  });

  it('shows the empty state when the customer has no accounts', async () => {
    const api = new FakeApi().on('GET /api/v1/accounts', { body: page([]) }).on('GET /api/v1/transactions', { body: page([]) });
    renderApp('/', { roles: ['CUSTOMER'], api });
    expect(await screen.findByText('You do not have any accounts yet. Contact support to open one.')).toBeInTheDocument();
  });
});

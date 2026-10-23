import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, useAuth } from '../core/auth';
import { Account, AuditRow, PlatformHealth, Summary, Transaction, isApiProblem } from '../core/models';
import { useAsync, useTitle } from '../core/useAsync';
import { formatDate, formatMoney } from '../shared/format';
import { StateView, StatusChip, TransactionTable, viewStateOf } from '../shared/components';

/** Staff land on the operational dashboard, customers on their portfolio. */
export function Home() {
  useTitle('Home');
  const auth = useAuth();
  return auth.isStaff ? <Dashboard /> : <Portfolio />;
}

/** Customer landing page: own accounts with balances and the most recent activity. */
export function Portfolio() {
  const api = useApi();
  const state = useAsync<{ accounts: Account[]; recent: Transaction[]; loadedAt: Date }>(
    async () => {
      const [accounts, recent] = await Promise.all([
        api.accounts({ size: 50, sort: 'openedAt,asc' }),
        api.transactions({ size: 8, sort: 'createdAt,desc' }),
      ]);
      return { accounts: accounts.items, recent: recent.items, loadedAt: new Date() };
    },
    [api],
    'Your accounts could not be loaded.',
  );
  const accounts = state.data?.accounts ?? [];
  const recent = state.data?.recent ?? [];

  return (
    <section className="page">
      <div className="head">
        <div>
          <h1>My accounts</h1>
          <p className="subtitle">Balances and recent activity for your investment accounts.</p>
        </div>
        <Link className="btn flat" to="/transactions/new">New transaction</Link>
      </div>

      <StateView state={viewStateOf(state.loading, state.error, accounts.length === 0)} message={state.error} onRetry={state.reload}
                 emptyText="You do not have any accounts yet. Contact support to open one.">
        <div className="grid cols-4">
          {accounts.map((a) => (
            <Link key={a.id} className="card acct" to={`/accounts/${a.id}`} aria-label={`Account ${a.accountNumber}`}>
              <span className="mono">{a.accountNumber}</span>
              <span className="muted">{a.accountType} · {a.currency}</span>
              <strong>{formatMoney(a.balance, a.currency)}</strong>
              <span className="muted">Available {formatMoney(a.availableBalance, a.currency)}</span>
              <StatusChip status={a.status} />
            </Link>
          ))}
        </div>

        <h2 className="section">Recent activity</h2>
        {recent.length === 0 ? (
          <p className="muted">No transactions yet.</p>
        ) : (
          <>
            <TransactionTable rows={recent} caption="Recent transactions" />
            <p className="muted">Last updated {formatDate(state.data?.loadedAt.toISOString(), 'time')}. <Link to="/transactions">All transactions</Link></p>
          </>
        )}
      </StateView>
    </section>
  );
}

const REFRESH_MS = 15_000;

interface DashboardData {
  summary: Summary;
  health: PlatformHealth;
  audit: AuditRow[];
}

const pct = (rate: number) => `${(rate * 100).toFixed(1)} %`;

/**
 * Operational dashboard: volumes, statuses, attention queues, latency, error rates, service health, recent audit.
 * Auto-refreshes while visible; a failed refresh keeps the last good data on screen and shows a non-blocking warning.
 */
export function Dashboard() {
  const api = useApi();
  const [data, setData] = useState<DashboardData | null>(null);
  const hasData = useRef(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [refreshError, setRefreshError] = useState('');

  const load = useCallback(() => {
    Promise.all([api.summary(), api.health(), api.auditEvents({ size: 8, sort: 'occurredAt,desc' })]).then(
      ([summary, health, audit]) => {
        hasData.current = true;
        setData({ summary, health, audit: audit.items });
        setLoading(false);
        setErrorMessage('');
        setRefreshError('');
      },
      (e: unknown) => {
        const message = isApiProblem(e) ? e.message : 'The dashboard data could not be loaded.';
        setLoading(false);
        // keep the last good data on screen; only a first-load failure blocks the page
        if (hasData.current) {
          setRefreshError(message);
        } else {
          setErrorMessage(message);
        }
      },
    );
  }, [api]);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        load();
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const s = data?.summary;
  const state = data ? 'ready' : loading ? 'loading' : errorMessage ? 'error' : 'empty';
  const counts = s?.transactionsByStatus ?? {};
  const max = Math.max(1, ...Object.values(counts));

  return (
    <section className="page">
      <div className="head">
        <div>
          <h1>Operations overview</h1>
          <p className="subtitle">{s ? `Updated ${formatDate(s.generatedAt, 'time')} · refreshes every 15 s` : 'Platform health, volumes and exceptions'}</p>
        </div>
        <button type="button" className="btn stroked" onClick={load}>Refresh now</button>
      </div>

      {refreshError && <p className="warn-banner" role="alert">Could not refresh: {refreshError} — showing the last data received.</p>}

      <StateView state={state} message={errorMessage} onRetry={load} emptyText="No data yet.">
        {data && s && (
          <>
            <div className="grid cols-4">
              <Link className="card kpi" to="/transactions?status=COMPLETED"><span className="label">Completed (24 h)</span><strong>{s.completedLast24h}</strong></Link>
              <Link className="card kpi bad" to="/investigations?tab=failed"><span className="label">Failed (24 h)</span><strong>{s.failedLast24h}</strong></Link>
              <Link className="card kpi warn" to="/investigations?tab=review"><span className="label">Pending review</span><strong>{s.pendingReview}</strong></Link>
              <Link className="card kpi warn" to="/investigations?tab=reconciliation"><span className="label">Reconciliation required</span><strong>{s.reconciliationRequired}</strong></Link>
            </div>

            <div className="grid cols-2 row">
              <section className="card" aria-labelledby="h-status">
                <h2 id="h-status">Transactions by status</h2>
                <ul className="bars">
                  {Object.entries(counts).map(([status, count]) => (
                    <li key={status}>
                      <span><StatusChip status={status} /></span>
                      <span className="bar-track" aria-hidden="true"><i style={{ width: `${(count / max) * 100}%` }} /></span>
                      <span className="num">{count}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="card" aria-labelledby="h-health">
                <h2 id="h-health">Service health <StatusChip status={data.health.status} /></h2>
                <ul className="health">
                  {data.health.components.map((c) => (
                    <li key={c.name}><StatusChip status={c.status} /> <strong>{c.name}</strong> <span className="muted">{c.detail}</span></li>
                  ))}
                </ul>
              </section>
            </div>

            <div className="grid cols-2 row">
              <section className="card" aria-labelledby="h-perf">
                <h2 id="h-perf">Processing latency &amp; error rates</h2>
                {s.processingLatency.sampleSize === 0 ? (
                  <p className="muted">No completed transactions yet.</p>
                ) : (
                  <dl className="facts">
                    <dt>Average</dt><dd>{Math.round(s.processingLatency.averageMs).toLocaleString('en-US')} ms</dd>
                    <dt>p50 / p95 / p99</dt><dd>{s.processingLatency.p50Ms} / {s.processingLatency.p95Ms} / {s.processingLatency.p99Ms} ms</dd>
                    <dt>Sample</dt><dd>last {s.processingLatency.sampleSize} completed transactions</dd>
                  </dl>
                )}
                <dl className="facts">
                  <dt>Transaction failure rate (24 h)</dt><dd>{pct(s.transactionFailureRateLast24h)}</dd>
                  <dt>HTTP 5xx rate (since start)</dt><dd>{pct(s.http.errorRate)} <span className="muted">({s.http.serverErrors} of {s.http.totalRequests})</span></dd>
                </dl>
              </section>

              <section className="card" aria-labelledby="h-vol">
                <h2 id="h-vol">Completed volume (24 h)</h2>
                {s.completedVolumeLast24h.length === 0 ? (
                  <p className="muted">No completed volume in the last 24 hours.</p>
                ) : (
                  <table className="plain">
                    <caption className="sr-only">Completed volume by type and currency</caption>
                    <thead><tr><th scope="col">Type</th><th scope="col">Currency</th><th scope="col" className="amount">Count</th><th scope="col" className="amount">Volume</th></tr></thead>
                    <tbody>
                      {s.completedVolumeLast24h.map((v) => (
                        <tr key={v.type + v.currency}><td>{v.type}</td><td>{v.currency}</td><td className="amount">{v.count}</td><td className="amount">{formatMoney(v.volume, v.currency)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <h3>Accounts</h3>
                <p>{Object.entries(s.accountsByStatus).map(([status, count]) => <span key={status} className="pill"><StatusChip status={status} /> {count}</span>)}</p>
                <p className="muted">Total balances: {s.totalBalances.map((b) => <strong key={b.currency} className="pill">{formatMoney(b.total, b.currency)}</strong>)}</p>
              </section>
            </div>

            <section className="card row" aria-labelledby="h-audit">
              <h2 id="h-audit">Recent audit events <Link to="/audit" className="more">View all</Link></h2>
              {data.audit.length === 0 ? (
                <p className="muted">No audit events yet.</p>
              ) : (
                <table className="plain">
                  <caption className="sr-only">Most recent audit events</caption>
                  <thead><tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Entity</th></tr></thead>
                  <tbody>
                    {data.audit.map((e) => (
                      <tr key={e.id}>
                        <td>{formatDate(e.occurredAt, 'short')}</td><td>{e.actor}</td>
                        <td><span className="mono">{e.action}</span></td><td><span className="muted">{e.entityType}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </StateView>
    </section>
  );
}

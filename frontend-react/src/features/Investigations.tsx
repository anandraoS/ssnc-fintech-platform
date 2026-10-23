import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi, useAuth } from '../core/auth';
import { Reconciliation, Transaction, TransactionStatus, isApiProblem } from '../core/models';
import { useAsync, useTitle } from '../core/useAsync';
import { formatDate } from '../shared/format';
import { Field, StateView, StatusChip, TransactionTable, viewStateOf } from '../shared/components';

type Tab = 'review' | 'failed' | 'reconciliation';
const TABS: { id: Tab; label: string }[] = [
  { id: 'review', label: 'Pending review' },
  { id: 'failed', label: 'Failed / rejected' },
  { id: 'reconciliation', label: 'Reconciliation' },
];
const STATUS_FOR: Record<'review' | 'failed', TransactionStatus[]> = { review: ['PENDING_REVIEW'], failed: ['FAILED', 'REJECTED'] };

/** Work queues for staff: pending review, failed/rejected, and reconciliation-required (with operator resolution). */
export function Investigations() {
  useTitle('Investigations');
  const api = useApi();
  const auth = useAuth();
  const [params] = useSearchParams();
  const requested = params.get('tab') as Tab | null; // dashboard links: ?tab=reconciliation
  const [tab, setTab] = useState<Tab>(requested && TABS.some((t) => t.id === requested) ? requested : 'review');
  const [note, setNote] = useState('');
  const [acting, setActing] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  const queue = useAsync<{ txs: Transaction[]; recon: Reconciliation[] }>(
    async () => {
      if (tab === 'reconciliation') {
        return { txs: [], recon: (await api.reconciliations({ status: 'OPEN', size: 50 })).items };
      }
      return { txs: (await api.transactions({ status: STATUS_FOR[tab], size: 50, sort: 'createdAt,desc' })).items, recon: [] };
    },
    [api, tab],
    'The queue could not be loaded.',
  );
  const txs = queue.data?.txs ?? [];
  const recon = queue.data?.recon ?? [];
  // a stale result from the previous tab must never be shown under the new one
  const fresh = queue.data !== null && !queue.loading;

  async function resolve(r: Reconciliation, resolution: 'CONFIRMED_EXECUTED' | 'CONFIRMED_NOT_EXECUTED') {
    setActing(true);
    setMessage('');
    try {
      await api.resolveReconciliation(r.id, resolution, note);
      setIsError(false);
      setMessage(resolution === 'CONFIRMED_EXECUTED' ? 'Marked as executed - transaction completed.' : 'Marked as not executed - funds returned to the customer.');
      setNote('');
      queue.reload();
    } catch (e) {
      setIsError(true);
      setMessage(isApiProblem(e) ? `${e.message} (${e.code})` : 'Resolution failed.');
    } finally {
      setActing(false);
    }
  }

  function selectTab(next: Tab) {
    setTab(next);
    setMessage('');
  }

  return (
    <section className="page">
      <h1>Investigations</h1>
      <p className="subtitle">Transactions that need a human: approvals, failures, and uncertain external outcomes.</p>

      <div className="tabs" role="tablist" aria-label="Investigation queues">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls="queue-panel" onClick={() => selectTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="panel" role="tabpanel" id="queue-panel" aria-labelledby={`tab-${tab}`}>
        {tab !== 'reconciliation' ? (
          <StateView state={viewStateOf(queue.loading, queue.error, fresh && txs.length === 0)} message={queue.error} onRetry={queue.reload}
                     emptyText={tab === 'review' ? 'Nothing is waiting for approval.' : 'No failed or rejected transactions.'}>
            <TransactionTable rows={txs} showSubmitter caption="Investigation queue" />
          </StateView>
        ) : (
          <StateView state={viewStateOf(queue.loading, queue.error, fresh && recon.length === 0 && !message)} message={queue.error} onRetry={queue.reload}
                     emptyText="No open reconciliation records - all external outcomes are known.">
            {message && <p className={`notice${isError ? ' err' : ''}`} role={isError ? 'alert' : 'status'}>{message}</p>}
            <ul className="recon">
              {recon.map((r) => (
                <li key={r.id} className="card">
                  <div className="top">
                    <Link to={`/transactions/${r.transactionId}`} className="mono">{r.transactionId.slice(0, 8)}…</Link>
                    <StatusChip status={r.status} /> <span className="mono">{r.reasonCode}</span>
                    <span className="muted">opened {formatDate(r.openedAt, 'short')}</span>
                  </div>
                  {r.detail && <p className="muted">{r.detail}</p>}
                  {auth.isOperator && r.status === 'OPEN' && (
                    <div className="resolve">
                      <Field id={`note-${r.id}`} label="Resolution note">
                        <input id={`note-${r.id}`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} aria-label={`Resolution note for ${r.transactionId}`} />
                      </Field>
                      <button type="button" className="btn stroked" disabled={acting} onClick={() => void resolve(r, 'CONFIRMED_EXECUTED')}>The network executed it</button>
                      <button type="button" className="btn stroked" disabled={acting} onClick={() => void resolve(r, 'CONFIRMED_NOT_EXECUTED')}>It was NOT executed (refund)</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </StateView>
        )}
      </div>
    </section>
  );
}
